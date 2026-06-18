## Mål
Subjektet ska behålla originalfotots riktning/orientering i ALLA removeBackground-mallar. Ändringen sitter globalt i `fluxBase` + `callFluxRemoveBg` — inget product_configs-arbete behövs.

## Ändringar (endast `supabase/functions/replicate-face-swap/index.ts`)

### 1. Skärp `fluxBase` (rad ~623–629)
Lägg in orientering/spegling-spärr inuti samma stycke som motivblocket och bakgrundsspärren:

```
The subject is the main object in the input photo. Preserve its structure,
proportions and overall composition so it stays recognizable as the same subject.
Keep the subject at the EXACT same orientation, facing direction, angle and
position as in the input photo. NEVER mirror, flip, rotate or re-angle it.
Do not output a mirror image. If the subject faces left in the input it must
face left in the output; if it faces right it must face right.
Completely isolate the subject on a perfectly flat mid-grey (#7f7f7f) studio backdrop.
ABSOLUTELY NO landscape, NO sky, NO trees, NO foliage, NO bushes, NO grass, NO ground,
NO shadow, NO surroundings, NO people, NO vehicles, NO text, NO watermark.
The area outside the subject silhouette must be a single solid flat #7f7f7f, nothing else.
```

### 2. Slå ihop motivblock med fluxBase till ett stycke (rad ~639–643)
Mallens `fluxStylePrompt` (motiv) limmas in i samma paragraf som `fluxBase`, inte som separat stycke. Style-tail ligger kvar i egen paragraf så stilen vinner visuellt men inte geometriskt.

```ts
const fluxMotifLine = params.fluxStylePrompt?.trim() ?? "";
const fluxPromptText = [
  fluxMotifLine ? `${fluxBase} ${fluxMotifLine}` : fluxBase,
  fluxStyleTail,
].filter(Boolean).join("\n\n");
```

### 3. Förstärk style-tail-instruktionen (rad ~631–637)
Lägg till en explicit "style is a surface treatment only" så stilbeskrivningen inte tolkas som tillstånd att rotera/omkomponera:

```
Render the subject in the following art style. Apply it fully to the subject
while keeping its structure and identity recognizable. The style is a SURFACE
TREATMENT only — it must not change the subject's orientation, facing direction,
position or scale:
```

### 4. `callFluxRemoveBg` (rad ~747–755)
`prompt_upsampling` är redan `false` — bekräftat, ingen ändring.
`aspect_ratio: "match_input_image"` och `input_image` behålls.
Flux Kontext Pro exponerar ingen offentlig fidelity/structure-parameter — inget mer att skruva på där.

## Verifiering
1. Deploya `replicate-face-swap` och kör bilposter med **Olja** och **Vintage** på tre bilder (vänstervänd, högervänd, trekvartsvinkel). Kolla `[runRemoveBackground] fluxPromptText` i loggen att de nya raderna finns med och att riktningen matchar originalet i output.
2. Regress: kör en husposter och en födelseposter — ska visuellt vara identiska med tidigare lyckade resultat.
3. Om spegling fortfarande sker på fordon: gå vidare till steg 5 nedan (detect-and-correct), annars klart.

## Steg 5 — endast om steg 1–4 inte räcker (separat plan)
Bygg en post-Flux mirror-detektor: jämför Flux-utdatat mot input (t.ex. via perceptuell hash på horisontellt flippad version) och spegla tillbaka innan bg-removern. Det är en ny ~80-rads modul och bör behandlas som en egen iteration efter att vi sett om prompt-skärpningen räcker.

## Risk
Mycket låg. Alla tillägg är skärpningar inom redan etablerade direktiv (preserve identity / no background / surface treatment). Påverkar inte Nano Banana-grenen, klientkoden, cache-nycklar eller mallar.
