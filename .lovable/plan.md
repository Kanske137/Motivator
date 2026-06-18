## Mål
Subjekt behåller originalfotots riktning, kameravinkel och hamnar i konsekvent storlek i alla object-removal-mallar. Endast `supabase/functions/replicate-face-swap/index.ts` ändras — `product_configs` rörs inte.

## Arkitektur (ny pipeline i `runRemoveBackground` / `callFluxRemoveBg`)

```text
input.jpg
  → [1] EXIF-normalize (decode + re-encode utan EXIF-rotation, behåll pixlar)
  → upload normalized → faceImageUrlN
  → loop attempt = 0..2:
       seed = stableHash(designId, attempt)
       → [Flux Kontext Pro] (input_image=faceImageUrlN, seed)
       → fluxOut.png
       → [3] orientation-detector (input vs fluxOut, gråskala-edge-korrelation)
            kandidater: identity, hflip, rot90, rot180, rot270
            bästa över tröskel → applicera invers transform → break
            ingen över tröskel → retry med ny seed
       om alla 3 misslyckas → använd bästa kandidat (även under tröskel), flagga
  → [851-labs/background-remover] → rgba.png
  → [4] alpha-bbox crop + uniform scale till TARGET_FILL (default 0.90 av längsta sidan av output-canvas), centrerat på transparent canvas med samma aspect ratio som original-flux-output
  → upload → printFileUrl
```

## Steg-för-steg ändringar (alla i `supabase/functions/replicate-face-swap/index.ts`)

### 1. EXIF-normalisering (ny helper, körs först i `callFluxRemoveBg`)
- `fetch(faceImageUrl)` → bytes
- Använd `ImageScript` (`import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts"`) — redan stödd i Deno edge runtime, ingen EXIF-rotation, läser rå pixeldata.
- Re-encoda som PNG (förlustfri, korrekt orientering) och ladda upp via befintlig `uploadCartPreview`-flow (eller direkt till `cart-previews`-bucket med service role).
- Returnera ny URL → används som `input_image` till Flux.
- Logga `[exif-normalize] designId=... origBytes=... outBytes=... w=... h=...`.

### 2. Stabil seed
- `function stableSeed(designId: string, attempt: number): number` — t.ex. FNV-1a 32-bit på `${designId}:${attempt}`, mod 2^31.
- Skicka som `input.seed` i Flux-anropet (rad ~753-762).
- Loggas i `[flux-removebg] start ...`.

### 3. Orientation-detector (ny helper, körs mellan Flux och bg-remover)
- Ladda in både input-normalized och flux-output via ImageScript.
- Downscale båda till 256px längsta sida, konvertera till luminans (Y = 0.299R+0.587G+0.114B).
- Beräkna Sobel-magnitude (enkel 3x3-konvolution i ren TS, ~50ms vid 256px).
- För varje kandidat `t ∈ {identity, hflip, vflip, rot90, rot180, rot270}`: transformera input-edge-mapen, resampla till flux-output-dimensionerna, beräkna normaliserad cross-correlation (NCC) mot flux-edge-mapen.
- Tröskel: `NCC_PASS = 0.55`, `NCC_AMBIGUOUS_DELTA = 0.04` (bästa måste vinna med marginal).
- Beslut:
  - bästa = `identity` & ≥ tröskel → behåll fluxOut oförändrad.
  - bästa = annan transform & ≥ tröskel → applicera INVERS transform på fluxOut (hflip⁻¹=hflip, rot90⁻¹=rot270 etc.) och fortsätt.
  - ingen över tröskel → markera attempt som "needs retry".
- Returnera `{ accepted: boolean, bestScore: number, bestTransform: string, correctedBytes: Uint8Array }`.

### 4. Retry-loop runt Flux + detector
- I `callFluxRemoveBg`: 3 attempts. Behåll det första `accepted=true`-resultatet. Om alla 3 misslyckas, använd attempt med högst `bestScore` och logga `[orientation] fallback-best score=...`.
- Mellan attempts: byt seed (`stableSeed(designId, attempt+1)`).
- Total tid worst-case: 3× Flux (~3×15s=45s). OK eftersom progress redan visar ~18s — höj `expectedSeconds` i `AiPhotoSection` till `30` (frontend-ändring, en rad).

### 5. Storleksnormalisering (efter bg-remover, på RGBA-output)
- ImageScript på bg-remover-outputens PNG-bytes.
- Skanna alfakanalen → bbox `(x0,y0,x1,y1)` av pixlar med `alpha > 8`.
- Crop till bbox.
- Beräkna `targetLong = Math.round(TARGET_FILL * Math.max(origW, origH))` där `origW/H` = flux-output-dimensionerna, `TARGET_FILL = 0.90`.
- Uniform scale (behåll proportioner) så längsta sidan av motivet = `targetLong`.
- Skapa ny RGBA-canvas i originaldimensionerna (`origW × origH`), fyll helt transparent, paste centrerat.
- Encoda PNG (RGBA bevarad) → ladda upp som tidigare.
- Tunable: läs `params.targetFillRatio` om satt i framtiden, annars `0.90`.

### 6. Prompt-städning (`runRemoveBackground`, rad ~623-633 + 615-616)
- `fluxBase`: ta bort de upprepade mirror/flip/rotate/facing-meningarna (rad 626-629). Behåll: motiv-identifikation, "preserve structure/proportions/composition", `#7f7f7f`-isolering, NO-listan, "single solid flat #7f7f7f".
- Återställ stil-medveten line-art-bridge (commit `aba32b6`): för line-art + vehicle-subject, lägg in den vehicle-specifika bridge-meningen ("car's body panels, window frames, door seams, wheel rims, spokes, headlights and grille…") — punkt 3-4 garanterar geometri, bridgen får fokusera på stil.
- `fluxStyleTail`-meningen "must not change the subject's orientation, facing direction, position or scale" → kortas till "The style is a SURFACE TREATMENT only."

### 7. Loggning för `face-swap-diag`
Lägg till per attempt:
```
[orientation] designId=... attempt=N seed=... bestTransform=identity|hflip|rot90|... score=0.62 accepted=true|false
[size-normalize] designId=... bbox=(x,y,w,h) scale=0.83 targetLong=921 final=(W,H)
```
Och vid fallback: `[orientation] FALLBACK designId=... bestScore=...` så face-swap-diag-fliken visar fall som behöver justering.

## Verifiering (manuellt, efter deploy)
1. Bil-mall (Bilposter): bil i 3/4 vänster → kör Olja + Vintage 3× var. Förvänta: alla 6 outputs vänstervända, samma storlek, tydlig stil.
2. Bil i 3/4 höger → samma test. Riktning ska bevaras.
3. "Sidovridnings-fall" (bil rakt framifrån) → om detector inte hittar match över tröskel, fallback ska accepteras tyst, riktning ändå rimlig.
4. Regress: husposter (`removeBackground` med `fluxStylePrompt` aktiv) → orientation-detector ska ge `identity` (hus är symmetriska, edges matchar). Storlek konsekvent.
5. Regress: AI-foto utan `removeBackground` (human/pet face-swap) → opåverkat, kör fortfarande Nano-Banana-grenen.
6. `supabase/functions/face-swap-diag` ska visa `[orientation]` och `[size-normalize]`-rader i logs.

## Frontend (minimal)
- `src/components/editor/AiPhotoSection.tsx` rad ~158: `expectedSeconds = 18` → `30` (matchar worst-case 3-attempt-tid).

## Inga ändringar i
- `product_configs` / template-schema
- Andra edge functions
- `AiStyleSection` (det är separata stil-passet, inte bg-removal)
- Andra layer-typer

## Bibliotek
- `imagescript` (Deno x): pure-TS, ingen native dep, fungerar i Supabase edge runtime. ~200KB. Användning: `Image.decode`, `.bitmap` (Uint8Array RGBA), `.encode()`, `.resize()`, `.rotate()`, `.flip()`. Sobel + NCC skrivs som korta loopar över `.bitmap`.