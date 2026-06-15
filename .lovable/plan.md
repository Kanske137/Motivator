# Felsökning: tom sida i Appen + enbart Format-flik i Shopify

## Vad jag hittade

1. **Root cause — infinite render loop i `LayersSection`.** Konsolen visar:
   > Warning: The result of getSnapshot should be cached to avoid an infinite loop … at LayersSection (LayersSection.tsx:86)

   Felet kommer från rad 73:
   ```ts
   const layers = useEditorStore((s) => s.templateLayers());
   ```
   `templateLayers()` returnerar en **ny array** varje gång selectorn körs → Zustand tror att state ändras varje render → React varnar och komponenten remountar i loop → editorn kraschar (vit sida) så fort `LayersSection` monteras.

   Detta förklarar **båda symptomen**:
   - **"Tom sida från Appen"** (`/editor?handle=skapa-sjalv`): Lager-fliken är default-aktiv (första tillgängliga section), monteras direkt, kraschar → blank skärm.
   - **"Bara Format-fliken i Shopify-iframen"**: den publicerade builden i Shopify-temat är äldre än freeform-koden, så `is_freeform`-grenen finns inte → bara Format syns. När du publicerar om kommer Lager-fliken med, men då måste loop-buggen vara fixad annars kraschar den där också.

2. **DB-raden är OK.** `skapa-sjalv` har `is_freeform=true`, `is_consolidated=true`, `enabled_product_types=[posters,canvas,aluminum,acrylic]` och ett giltigt template med tomma `layers[]` i båda orienteringarna. Editorn expanderar raden korrekt via `expandConsolidatedConfig`.

3. **Tomt canvas är dock fortfarande förvirrande för kunden** — när Lager-fliken fungerar landar kunden på en helt blank yta utan vägledning.

## Plan

### Steg 1 — Fixa loopen i `LayersSection.tsx` (kritiskt)
Hämta funktionsreferensen i selectorn (stabil) och anropa den i render, precis som `ControlPanel` redan gör:

```ts
const templateLayers = useEditorStore((s) => s.templateLayers);
const layers = templateLayers();
```

Inget annat behöver röras i komponenten. Detta tar bort loopen → den vita sidan försvinner.

### Steg 2 — Onboarding/tom-läge i `LayersSection`
När `layers.length === 0`:
- Visa en tydlig hint överst i preview-ytan via en ny prop på `MapPreview` (eller via `EditorShell`): "Börja med att lägga till ett lager →" som pekar mot "Lägg till"-knappen.
- I `LayersSection`s tom-tillstånd: byt ut den nuvarande korta texten mot en kort guide med de tre vanligaste startpunkterna som direktknappar (Bild · Karta · Text) — samma `addCustomLayer`-anrop som "Lägg till"-arket använder.

### Steg 3 — Skydd mot framtida snapshot-bugs
Lägg en kort kommentar ovanför `templateLayers`-användningar i editor-komponenter:
> Selectorn returnerar FUNKTIONEN, inte resultatet — annars triggas Zustands "getSnapshot should be cached"-loop.

### Steg 4 — Verifiera och publicera
1. Öppna `/editor?handle=skapa-sjalv` i preview → sidan ska rendera, Lager-fliken ska visas i NavRail tillsammans med Format.
2. Klicka Lager → lägg till Bild/Karta/Text → bekräfta att lager visas i preview.
3. Publicera (så att Shopify-iframen får ny build) — då försvinner symptomet "bara Format" där också.

## Tekniska detaljer

Filer som ändras:
- `src/components/editor/LayersSection.tsx` — fix selector + tomt-läge med snabbknappar.
- (ev.) `src/components/editor/MapPreview.tsx` eller `EditorShell.tsx` — overlay-hint vid 0 lager för freeform.

Inga DB-migrationer, inga ändringar i `editorStore`, `freeform-layers.ts`, print-pipeline eller Shopify-sync. Befintliga mallar påverkas inte (de har `is_freeform=false` och får ändå inte Lager-fliken).
