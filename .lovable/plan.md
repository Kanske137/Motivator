# Transparent-PNG removeBackground via Flux Kontext + dedikerad bg-removal

Generisk, config-driven. Flux som primär för removeBackground-lager när nytt fält är ifyllt. Husposter är första valideringsmål. Ingen mall-specifik kod.

## Trigger-princip (avgörande)

- **Produktions-trigger = fältets närvaro i config.** Ett `aiPhoto`-lager med `subjectKind === "removeBackground"` OCH `defaults.fluxStylePrompt` ifyllt → Flux-pipeline. Saknas fältet → Gemini, exakt som idag. Aldrig villkor på mall-id.
- **Flux är PRIMÄR** för dessa lager — inte "Gemini först, Flux retry". Gemini används som fallback ENDAST om Flux/bg-removal själva felar tekniskt (ej safety).
- **Env-flagga `FLUX_REMOVEBG_ENABLED`** (default `false` under validering). När `false`: fält-triggern är vilande (Gemini körs även om fältet är satt), men `?engine=flux` query-override funkar för manuella tester. När vi flippar till `true` styr fältet live.
- `?engine=` kvar ENBART som test-override.

## FAS 0 — Verifiera komposition (ingen modell, ingen Flux)

**0a. Nuläge (redan utrett):** transparent alfa flödar redan korrekt genom editor-preview (`MapPreview.tsx` → `PhotoLayerView` via `<img>`) och print-snapshot (`template-snapshot.ts` rad 677–678 fyller `livePosterBgColor || "#ffffff"` och ritar lager via `drawImage`). **Lucka:** per-lager `defaults.backdropColor` komposiras INTE bakom aiPhoto-lagret — vi förlitar oss på att modellen bakat in färgen. Måste fixas för transparent-flödet.

**0b. Komposit-fix (generisk, bara removeBackground):**
- `src/lib/template-snapshot.ts` rad ~789, aiPhoto-grenen, FÖRE `drawPhotoLayer`: om `layer.defaults.subjectKind === "removeBackground"` och `layer.defaults.backdropColor` finns → `ctx.save() / clipForShape(layer.defaults.shape) / fillStyle = backdropColor / fillRect(rect) / restore()`.
- `src/components/editor/MapPreview.tsx` rad ~657: spegla med inline `backgroundColor` på lagrets wrap (respektera shape-clip-path).
- Ingen ändring för andra subjectKinds.

**0c. Test-PNG-stub (utan modeller):** i `replicate-face-swap/index.ts`, när `URL.searchParams.get("engine")==="flux"` OCH `searchParams.get("stub")==="1"` OCH `subjectKind==="removeBackground"`: hoppa över alla modeller, läs transparent test-PNG från `?stubUrl=` eller `FACE_SWAP_DIAG_TRANSPARENT_PNG_URL`, ladda upp oförändrad till `print-files/<designId>.png`, returnera vanlig svar-shape. Test-PNG hostas i `cart-previews`-bucket, ska innehålla både hård och feathrad alfa-kant. Default-flödet rörs inte.

**0d. Verifiera (klistra in skärmar) — husposter:**
- Stubbed transparent PNG genom `getPrintFileUrl` med:
  - `backdropColor = #FFFFFF`, portrait 3:4
  - `backdropColor = #6B8E5A`, portrait 3:4
  - Samma två i en annan aspect ratio (landscape eller square via testlayout)
- Acceptans:
  - Editor-preview: motiv över vald färg, alfa respekteras (hård + feathrad), ingen vit/svart ruta.
  - Print-fil: motiv komposerat över EXAKT `backdropColor`, rena kanter (ingen halo/fringe från komposit), transparenta ytor fyllda av bakgrundslagret.
  - Format/DPI/färg matchar dagens spec (`PX_PER_CM`, `MAX_PX`, `renderHiresTemplateSnapshotSafe`).

**Gå vidare till Fas 1 endast om Fas 0 passerar.**

## FAS 1 — Pipelinen (generisk, config-driven, default oförändrad)

**1. Schema-fält** i `src/lib/template-schema.ts`, `aiPhotoDefaultsSchema`, direkt under `swapPrompt` (rad ~145):

```ts
/** removeBackground only: bas-stilinstruktion till Flux Kontext-steget.
 *  Fältets närvaro aktiverar Flux-pipelinen för lagret (när
 *  FLUX_REMOVEBG_ENABLED=true). Utelämnas (undefined) när tomt — aldrig "". */
fluxStylePrompt: z.string().min(1).optional(),
```

**2. Routing** i `supabase/functions/replicate-face-swap/index.ts`:
- Läs `engineParam = new URL(req.url).searchParams.get("engine")` och `fluxStylePrompt = typeof body?.fluxStylePrompt === "string" ? body.fluxStylePrompt.trim() : ""`.
- `FLUX_REMOVEBG_ENABLED = Deno.env.get("FLUX_REMOVEBG_ENABLED") === "true"`.
- `useFlux = subjectKind === "removeBackground" && (engineParam === "flux" || (FLUX_REMOVEBG_ENABLED && fluxStylePrompt.length > 0))`.
- När `useFlux`:
  - **Steg A — Flux Kontext** via Replicate connector (`black-forest-labs/flux-kontext-pro`, samma anropsmönster som `supabase/functions/replicate-style/index.ts`):
    - `input_image = faceImageUrl`
    - `prompt` = fast bas (`"Restyle the subject. Replace the background with a single plain, uniform, neutral light backdrop. No text, no border, no vignette, no decorative edge effects."`) + `fluxStylePrompt` + (om finns) `removeBackgroundStylePrompt`.
    - `safety_tolerance: 5`, `aspect_ratio` matchad mot `targetAspectRatio` (närmast bland Flux-stödda värden).
    - Polla till `succeeded`, hämta output-URL.
  - **Steg B — dedikerad bg-removal** via Replicate, samma gateway-mönster. Förslag på modell: `lucataco/remove-bg` eller `cjwbw/rembg` (BiRefNet) — exakt slug bekräftas vid implementering, kriteriet: returnerar transparent PNG med äkta alfa.
  - Ladda upp transparent PNG → `print-files/<designId>.png` (samma upload-kod som befintlig). Returnera samma svar-shape som idag.
  - **Ingen retry.** Båda stegen deterministiska och träffar inte safety-filtret.
  - **Fallback ENDAST om Flux/bg-removal själva felar (ej safety):** kör Gemini-vägen som idag. Logga `[removeBackground] engine=flux failed, falling back to gemini` med felorsak.
- När `!useFlux`: Gemini-vägen exakt som idag. Ingen ändring.

**3. Klient** i `src/components/editor/AiPhotoSection.tsx`:
- Skicka alltid `fluxStylePrompt: layer.defaults.fluxStylePrompt ?? ""` i `invoke`-body. Motorval sker server-side. Default-flow oförändrad.
- `?engine=` är test-override (hanteras via URL i edge, inget UI).

## Vad som rapporteras tillbaka efter bygget (för SQL)

- **Fältnamn:** `fluxStylePrompt`. Zod: `z.string().min(1).optional()`.
- **DB-kolumn:** `product_configs.template` (jsonb).
- **JSON-sökväg (husposter):** `template.canvasLayout.portrait.layers[<index av id="house">].defaults.fluxStylePrompt`. Husposter har bara `portrait` — ingen landscape/square/`extraLayouts`. Andra mallars `extraLayouts` ska inventeras separat innan SQL skrivs för dem.
- **Mål-laget identifieras generiskt:** `type === "aiPhoto"` AND `defaults.subjectKind === "removeBackground"`.
- **Routing läser:** `body.fluxStylePrompt` (string) + env `FLUX_REMOVEBG_ENABLED` + query `?engine=flux` (test).
- **Husposterns nuvarande aiPhoto-layer (ordagrant, för referens):**
  ```json
  {"id":"house","type":"aiPhoto","xPct":4,"yPct":11,"wPct":92,"hPct":60,"zIndex":1,
   "defaults":{"fit":"contain","shape":"rect","subjectKind":"removeBackground",
     "swapPrompt":"Architectural illustration of the house, isolated on solid warm off white background hex f5f1ea, clean watercolor style with soft pencil line work, front facade view, no people, no cars, no surroundings, house centered with subtle shadow at base, editorial magazine illustration aesthetic, full color but muted palette.",
     "referenceImages":[]}}
  ```

## Beroenden / secrets

- `FLUX_REMOVEBG_ENABLED` — ny env-flagga (sätts via `add_secret`, default lämnas osatt = false).
- `FACE_SWAP_DIAG_TRANSPARENT_PNG_URL` — ny env för Fas 0-stub (kan också skickas som `?stubUrl=` query och då behövs ingen secret).
- Replicate-anrop: använder befintlig `REPLICATE_API_TOKEN` (samma som `replicate-style`).

## Vad som INTE rörs

`swapPrompt`-värden, Gemini-grenen i `runRemoveBackground`, default-modell, `verify_jwt`, frontend för andra subjectKinds, andra edge-funktioner, `multi-face-swap`, `face-swap-diag` (behålls). Ingen mall-specifik kod.

## Acceptans

- **Fas 0:** print-fil komposerar transparent motiv över EXAKT `backdropColor`, rätt format/DPI; skärmar inklistrade.
- **Fas 1:** med `FLUX_REMOVEBG_ENABLED=true` ger ett removeBackground-lager med `fluxStylePrompt` ifyllt en transparent PNG via Flux → bg-removal, komposerad över `backdropColor`. Lager UTAN fältet kör Gemini oförändrat. Ingen mall-specifik kod. `?engine=` bara test-override. Strukturen rapporterad så SQL kan skrivas direkt.
