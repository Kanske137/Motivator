## Mål
Byt fordonsspåret (bilposter, mc) från `flux-canny-pro` till `flux-depth-pro` så stilen får utrymme medan vinkel/skala fortfarande hålls. Övriga mallar är opåverkade.

Live-schema verifierat via Replicate: `flux-depth-pro` tar `prompt` + `control_image` (krav), `guidance` 1–100 (default 30), `steps` 15–50, `seed` (valfri), `output_format` jpg/png, `safety_tolerance` 1–6. Ingen `negative_prompt`, ingen `control_strength` — exakt samma yta som canny-pro, så drop-in.

## Ändringar

### 1. `src/lib/template-schema.ts` — `structuralConditioning`
Lägg till `engine` (default `"bfl-canny"`). `controlType` finns redan.

```ts
engine: z.enum(["bfl-canny", "bfl-depth"]).default("bfl-canny"),
controlType: z.enum(["canny", "depth"]).default("canny"),
```

Inget annat fält ändras. Backwards-compatible: gamla rader utan `engine` defaultar till canny-spåret.

### 2. `supabase/functions/replicate-face-swap/index.ts`

**a) Body-validering (~rad 1425–1441):** läs `sc.engine`, validera mot `"bfl-canny" | "bfl-depth"`, default `"bfl-canny"`. Skicka vidare i `structuralConditioning`-objektet och i `callFluxStructural`-params.

**b) `prepareControlImage(rgbaPngBytes, hex, controlType)`:** Förgrena.
- `canny`: nuvarande flöde (downsample 768 + box-blur + posterize + flatten) — oförändrat.
- `depth`: downsample till max(w,h)=1024 (depth gillar lite mer pixlar), **inget** blur, **ingen** posterize. Flatten över `#7f7f7f` (behåll — kontrollbilden måste vara JPG/PNG utan alfa enligt schema).

**c) Modellval i `callFluxStructural`:** välj `model` på `engine` istället för bara `controlType`.
```
bfl-depth → black-forest-labs/flux-depth-pro
bfl-canny → black-forest-labs/flux-canny-pro
```
`FLUX_DEPTH_MODEL` finns redan som konstant — återanvänd. Tappa det gamla `controlType==="depth"`-villkoret på modellnamn.

**d) Stil-bridges (i `runRemoveBackground`, rad ~621–635):** uppdatera till versionerna med inbakad "not a photo":
- Olja: `oil painting, impasto, brush strokes, canvas texture, not a photo`
- Skiss: `pencil drawing, graphite strokes, paper grain, cross hatching, not a photo`
- Linjekonst: `black ink line drawing, minimal fill, white paper, not a photo`
- Pop-art: `flat comic poster, halftone, hard outlines, saturated color blocks, not a photo`
- Vintage: `screen printed 1950s poster illustration, flat shapes, limited palette, grain, not a photo`
- Akvarell: `soft watercolor painting, wet-on-wet washes, pigment bleed, visible paper grain, not a photo`
- Fallback: `artistic illustration, painterly surface, not a photo`

Den vid akvarell-spåret tidigare tomma `bridge` får alltså nu en explicit text (depth-pro behöver det, eftersom det är så stilen tävlar mot motivet).

**e) Promptordning för structural:** behåll redan etablerad ordning `[bridge] → [stylePrompt] → [fluxBaseStructural + motif]` — den är redan implementerad.

**f) Loggning i `[flux-structural]`:** addera `engine` (och behåll `controlType`, `model`, `guidance`, `steps`, `controlImageBytes`, `controlImageDims`, `styleLabel`).

**g) Default guidance för depth:** schemat behåller `guidance` per rad (granskaren sätter SQL). Vi rör inte default i `aiPhotoDefaultsSchema` (ligger på 50). Granskarens SQL får sätta 15–25 på bilposter+mc tillsammans med `engine="bfl-depth"`, `controlType="depth"`.

### 3. `src/components/editor/AiPhotoSection.tsx` — cache
`refSlotFor` tar redan `controlType`. Utöka till att även ta `engine`:

```ts
no-ref::style:<id>::ctrl:<canny|depth>::eng:<bfl-canny|bfl-depth>
```

Anropssidan (`runSwap`, rad ~247) skickar med `structural.engine` när structural är aktivt. Detta isolerar depth-resultaten från äldre canny-cache utan att invalidera "ingen structural"-cache.

Skicka även `engine` i `structuralConditioning`-bodyn till edge-funktionen.

## Det vi medvetet INTE gör nu
- Ingen SQL-patch från Lovable. Granskaren kör SQL för att sätta `engine="bfl-depth"`, `controlType="depth"`, och justerar `guidance` (~15–25) på bilposter + mc.
- Tvåstegspipan (depth → kontext-pro) byggs inte förrän depth-test är gjort.
- Inga ändringar på husposter / fodelsetavla / produktposter.

## Tekniskt — filer som rörs
- `src/lib/template-schema.ts` (lägg till `engine`-fält)
- `src/components/editor/AiPhotoSection.tsx` (cache-nyckel + body-payload)
- `supabase/functions/replicate-face-swap/index.ts` (engine-routing, `prepareControlImage` per typ, stil-bridges, loggning, body-validering)

## Valideringsplan efter SQL-patch
Per fordonsmall (bil 3/4 vänster + höger, MC), samma uppladdade bild, en körning per stil:
Olja / Vintage / Skiss / Pop-art / Linjekonst / Akvarell.

Pass:
1. Stilarna tydligt olika varandra och tydligt inte ett foto med färgton.
2. Vinkel/rotation/skala oförändrad mot original.
3. Tid ≤ dagens canny-flöde.

Logga `engine=bfl-depth model=black-forest-labs/flux-depth-pro` ska synas i `[flux-structural]`-raderna.