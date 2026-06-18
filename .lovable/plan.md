# Plan: simpleStyleMode via Flux Kontext Pro + städning av övergivna styling-grenar

Två sammanhängande delar. Del 1 är additiv och gated bakom en ny flagga — befintliga mallar är opåverkade tills någon slår på flaggan. Del 2 rensar bort canny/depth/SDXL-LoRA-koden som inte längre används.

## Del 1 — Nytt läge `simpleStyleMode`

### Schema (`src/lib/template-schema.ts`)

På `aiPhotoLayerSchema.defaults` (samma block där `structuralConditioning` ligger):

- Lägg till `simpleStyleMode: z.boolean().optional()` (default = false / undefined).
  Doc-kommentar: "removeBackground only. När true: skippa hela den långa Nano-Banana/Flux-prompten och kör enbart `flux-kontext-pro` med `preset.styleInstruction` som prompt. Bakgrundsborttagning körs sedan på resultatet. Alla övriga prompt-fält (fluxStylePrompt, preset.prompt, preserveSubjectColors, fillFrame, backdropColor, swapPrompt) ignoreras av edge-funktionen i detta läge."

På `aiStylePresetSchema`:

- Lägg till `styleInstruction: z.string().optional()`.
  Doc: "Kort Kontext-Pro-instruktion, t.ex. 'make this in oil styling'. Används BARA när lagrets `simpleStyleMode === true`. Tom/saknad ⇒ fallback till `preset.prompt`."

### Defaults (`src/lib/ai-style-defaults.ts`)

Lägg till `styleInstruction` på varje preset enligt spec:

| id | styleInstruction |
| --- | --- |
| watercolor | `make this in watercolor styling` |
| oil | `make this in oil styling` |
| sketch | `make this in sketch styling` |
| pop-art | `make this in pop-art styling` |
| lineart | `make this in line art styling` |
| vintage-poster | `make this in vintage art styling` |

Befintliga mallar i DB påverkas inte (defaults gäller bara nya mallar). Granskaren patchar bilposter/mc separat via SQL.

### Edge function (`supabase/functions/replicate-face-swap/index.ts`)

1. Body-validering (~rad 1737): läs ut `simpleStyleMode: boolean` och `styleInstruction: string|null` från payload.
2. I `runRemoveBackground`: NY FÖRSTA gren — om `subjectKind === "removeBackground" && simpleStyleMode === true && hasNonEmptyStyleInstruction`, kör en ny funktion `callKontextSimpleStyle({ faceImageUrl, instruction, designId })`:
   - Steg A: `flux-kontext-pro` på kundens uppladdade bild med `prompt: instruction` som ENDA textinput. Inget annat — ingen base-prompt, ingen `fluxBase`, ingen `fluxStylePrompt`, ingen `bridge`, inget negative.
   - Steg B: kör befintlig `851-labs/background-remover` (samma `BG_REMOVER_VERSION`) på Kontext-outputen och returnera RGBA-PNG-bytena raw — exakt samma envelope som `callFluxRemoveBg` så uppladdnings-/dim-check-pipelinen efteråt är oförändrad.
   - Logga `[kontext-simple] start designId=… instruction="…"` och `[kontext-simple] done …` i samma stil som övriga grenar.
3. Routing-loggen (rad 1700-1709): lägg till `"remove-bg-simple"` som ny route när simple-grenen valdes; `modelUsed = "black-forest-labs/flux-kontext-pro+851-labs/background-remover"`.
4. När `simpleStyleMode !== true` ⇒ INGEN ändring i existerande gren (Nano-Banana/Flux/struktur). Allt bakåtkompatibelt.
5. Fallback: om `simpleStyleMode === true` men `styleInstruction` saknas/är tom på vald preset ⇒ försök `preset.prompt`; om även det saknas ⇒ loga warning och fall tillbaka till befintlig Nano-Banana-väg (ingen "skicka tom prompt").

### Klient (`src/components/editor/AiPhotoSection.tsx`)

- Skicka `simpleStyleMode: layer.defaults.simpleStyleMode === true` och `styleInstruction: selectedPreset?.styleInstruction ?? null` i `body` till edge-funktionen.
- Cache-nyckel: lägg till `::simple:1` (eller `::si:<hash>` av instruktionen) i `refSlotFor` när simpleStyleMode är aktivt, så simple-resultat inte krockar med tidigare Nano-Banana-cache för samma stil-id.
- Ingen UI-ändring för kunden — stilrutorna ser likadana ut.

### Admin-UI

**`src/components/admin/LayerInspector.tsx`** (i `isRemoveBg`-blocket nära `fillFrame`/`preserveSubjectColors`, rad ~820):

- Lägg till en Switch "Enkelt stil-läge (Kontext)" som styr `simpleStyleMode`. Hjälptext: "På = kör flux-kontext-pro direkt med stilens korta instruktion. Av = befintligt flöde."

**`src/components/admin/ProductOptionsSection.tsx`** (i `AiStyleRow`, rad ~628 efter `prompt`-textarean):

- Lägg till ett kort `Input` för `styleInstruction` med placeholder "Kontext-instruktion (t.ex. make this in oil styling)". Bara visuellt; värdet sparas på presetet oavsett om simpleStyleMode är aktivt på lagret.

## Del 2 — Städning av övergivna grenar

Endast efter att Del 1 verifierats funka i preview (förslag: kör Olja på bilposter med `simpleStyleMode=true` + `styleInstruction="make this in oil styling"`).

### Edge function

- Ta bort hela `callFluxStructural` (BFL canny/depth) inkl. `FLUX_DEPTH_MODEL`/`FLUX_CANNY_MODEL`-konstanter.
- Ta bort hela `callSdxlControlnetLora` och `SDXL_CN_LORA_MODEL`/`SDXL_CN_LORA_VERSION`-konstanter.
- Ta bort `prepareControlImage` om den inte används någon annanstans (greppa först).
- Ta bort `useStructural`-grenen, `structuralPromptText`, `structuralStyleHead`, `bridge`, `fluxBaseStructural` ur `runRemoveBackground`.
- Ta bort `structuralConditioning`-blocket från body-validering (rad 1742-1793) och från handler-loggen.
- Behåll `callFluxRemoveBg` + `useFlux`-grenen tills vidare (separat, äldre Kontext-väg som fortfarande funkar för icke-fordon).

### Schema (`src/lib/template-schema.ts`)

- Ta bort hela `structuralConditioning`-fältet från `aiPhotoLayerSchema.defaults`.
- Ta bort `loraUrl`/`loraScale`/`loraTrigger` från `aiStylePresetSchema`.
- Migrationsstrategi: zod-fälten är optional ⇒ existerande DB-rader som råkar ha dessa fält kvar parseas fortfarande utan fel (extra-fält strippas tyst av zod). Ingen DB-migration krävs från Lovables sida.

### Klient

- `src/components/editor/AiPhotoSection.tsx`: ta bort `structural`/`engineForCache`/`loraTagForCache`-blocket och `loraTagOf`-helpern. `refSlotFor`-signaturen förenklas till `(subjectKind, refUrl, styleId, simpleTag?)`.
- `src/components/admin/ProductOptionsSection.tsx`: ta bort hela "SDXL style-LoRA"-blocket i `AiStyleRow` (rad ~635-675).
- `src/components/admin/LayerInspector.tsx`: ta bort eventuella structuralConditioning-fält (grep visar inga — bara `fillFrame`/`preserveSubjectColors`/`backdropColor` påverkas inte).

### Vad som INTE rörs

- `runHumanSwap`, `runPetSwap`, `callNanoBanana`, `cdingram/face-swap`-flödet — orört.
- `multi-face-swap` edge-funktion — orörd.
- `replicate-style` edge-funktion — orörd (används av AiStyleSection för foto-till-konst-lager utan removeBackground).
- `851-labs/background-remover`-anropet och `BG_REMOVER_VERSION` — orörda; återanvänds av simple-grenen.
- Typografi-/karta-/text-lager — orörda.

## Rapport tillbaka efter implementering

- Fältet för kontext-instruktionen heter **`styleInstruction`** på `aiStylePresetSchema` och `simpleStyleMode` (boolean) på `aiPhotoLayer.defaults`.
- `simpleStyleMode` är helt gated — när false/saknas är beteendet bit-identiskt med idag.
- Bg-borttagningen i enkelt läge körs på output från `flux-kontext-pro` (samma `851-labs/background-remover`-version som befintlig flux-väg).
- Granskaren behöver SQL för att slå på `simpleStyleMode=true` på `bilposter`/`mc` aiPhoto-lagrets defaults och fylla i `styleInstruction` på respektive preset (defaults gäller bara nya mallar).

## Implementation-ordning

1. Del 1 schema + defaults + edge function (kontext-simple-grenen) + klient-payload + admin-UI.
2. Verifiera i preview med en testkörning på Olja/bilposter (granskaren patchar SQL).
3. Del 2 städning när Del 1 är bekräftad.

Båda delarna kan shippas i samma turn om vi är säkra; jag rekommenderar att göra Del 1 + Del 2 i en svit eftersom de övergivna grenarna ändå är döda när simpleStyleMode är den nya vägen framåt.
