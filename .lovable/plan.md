# Justeringar (steg 1, 2, 3 reviderade)

## 1) Admin: Bakgrundsfärg på Designytan
Oförändrat från förra planen — swatch + custom-color-picker ovanför `LayerCanvas` i `DesignerPage.tsx`, sparas på `template.defaultLayout[orientation].background.color`, per orientering, går genom `commitTemplate` (undo). Kundens default `posterBgColor` hydratiseras redan från detta fält.

## 2) Kundeditor: Flytta "Bakgrundsfärg" från Kartstil till Format
Oförändrat — flyttas högst upp i `FormatSection`, ovanför `Produkt`. Tas bort från `Kartstil`-blocket i `ControlPanel`.

## 3) Lås per egenskap — uppdatera betydelse + lägg till "Förflytta"

### Nytt schema
Lägg till **`move`** i `LayerLocks` (`src/lib/template-schema.ts`) — default `true` (låst). Migration i `template-migrate.ts` sätter `move: true` på alla befintliga lager.

Ny tolkning av befintliga lås:

| Lås | Ny innebörd (kund-sidan) |
|---|---|
| **Storlek** | Olåst → kunden kan skala lagret via en slider i lagrets sektion. Bibehåller aspect ratio. Min 20% / max 200% av admin-defaultstorleken, klampt till editorns kanter. |
| **Förflytta** *(ny)* | Olåst → kunden kan dra hela lagret inom editorn. Center-snap-guides (horisontell + vertikal mittlinje på editorn) visas under drag. Klampt till editorns kanter. |
| Position | (Befintlig) Karta: pan/zoom inuti kart-shapen. Oförändrad. |
| Form, Innehåll, Typsnitt, Synlighet, Stil | Som tidigare (se audit i förra planen). |

### Storleks-slider — beteende
- Visas i lagrets respektive sektion i `ControlPanel` när `!locks.size`. För `text`/`map`/`photo`/`aiPhoto` — alla får samma kontroll.
- En `<Slider>` 20–200 % (steg 5), default 100 %.
- Skala = `scale / 100`. Nya `wPct = baseW * scale`, `hPct = baseH * scale`. Centrum bevaras (justera `xPct`/`yPct` så bounding-box-mitten är samma som före). Om resultatet hamnar utanför 0..100 → klamp till kanten (förskjut centrum så lagret precis ryms).
- "Base" = lagrets admin-definierade `wPct`/`hPct` (sparas separat på det kund-overridade lagret som referens — eller härleds från `template` vid varje render, vilket är enklare och stateless).

### Förflytta — beteende
- Visas inte som UI-kontroll i sidopanelen — istället blir lagret drag-bart direkt i `MapPreview` när `!locks.move`.
- I `MapPreview.tsx` får varje wrapper-`<div>` `onPointerDown`/`Move`/`Up`-handlers som uppdaterar `xPct`/`yPct` i ett nytt customer-overlay-state.
- Editor-bounds: `xPct ∈ [0, 100 - wPct]`, `yPct ∈ [0, 100 - hPct]`.
- **Center-alignment-guides**: under drag, om lagrets centrum är inom 1.5 % av editorns horisontella eller vertikala mittlinje → snap till exakt 50 % och visa en streckad guide (återanvänd `AlignmentGuides`-komponenten). Endast center-axlarna, inga edges/andra-lager-snaps på kund-sidan.

### Ny store-yta
Eftersom alla lager-typer nu kan ha kund-overrides på `xPct/yPct/wPct/hPct`, lägger vi till ett gemensamt overlay-fält per lager:
```ts
// editorStore
layerTransforms: Record<string, { xPct?: number; yPct?: number; wPct?: number; hPct?: number }>
setLayerTransform(id, patch): merge + clamp till editorns kanter
resetLayerTransforms(): rensa (vid template-byte/orientation-byte)
```
`MapPreview` (och `template-snapshot`, `MockupGallery`, `editor-snapshot`) läser `transform[id] ?? layer` när de räknar ut wrapper-rect. Det säkerställer att 3D-canvas, mockups, cart-thumbnail och printfilen alla speglar kundens nya storlek/position.

### Editor-kant-respekt
En enda hjälpare `clampLayerRect(xPct, yPct, wPct, hPct)` i `layer-utils.ts` som klampar:
1. `wPct = min(wPct, 100)`, `hPct = min(hPct, 100)`
2. `xPct = clamp(xPct, 0, 100 - wPct)`, samma för y.

Används av både slider-skala och drag.

### Admin-inspector
Lås-listan i `LayerInspector.tsx` får en ny rad **"Förflytta"** mellan Position och Storlek. Etikett-tooltips uppdateras kort så admin förstår vad varje lås gör.

## Filer som kommer ändras
- `src/lib/template-schema.ts` — `move`-fält i `LayerLocks` + `defaultLocks`.
- `src/lib/template-migrate.ts` — sätt `move: true` på legacy-lager.
- `src/lib/layer-utils.ts` — `clampLayerRect`-helper, `defaultLocks`-baserade lager-faktorer får `move: true`.
- `src/stores/editorStore.ts` — `layerTransforms` + setters/reset.
- `src/components/editor/MapPreview.tsx` — drag-handlers, center-guides, läs `layerTransforms`.
- `src/components/editor/ControlPanel.tsx` — storleks-slider per lager-sektion (där `!locks.size`).
- `src/components/editor/MockupGallery.tsx` + `src/lib/template-snapshot.ts` + `src/lib/editor-snapshot.ts` — applicera `layerTransforms` när rect räknas ut.
- `src/components/admin/LayerInspector.tsx` + `LayerList.tsx` — UI för nya `move`-låset.
- `src/pages/admin/DesignerPage.tsx` — admin bg-color-picker (steg 1).
- `src/components/editor/FormatSection.tsx` — bg-color-picker högst upp (steg 2).
