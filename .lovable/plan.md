
# Fix: marginal stjäl klick + linjer går inte att flytta

Två separata buggar i admin-canvasen, båda orsakade av hur Rnd-wrappers och layer-renderare hanterar pointer-events.

## Problem 1 — Marginal blockerar klick på kartan

**Orsak**: Marginal-lagret har `xPct/yPct/wPct/hPct = 0,0,100,100` och dess Rnd-wrapper ligger överst (högst zIndex). Hela ytan — inklusive den **transparenta mitten** mellan de fyra vita kanterna — fångar pointer-events. När admin (eller kund) försöker dra/zooma kartan under hamnar klicken på marginal-lagret istället.

**Lösning** (admin + kund):

1. **Kund-vy (`StaticLayers.tsx` → `MarginLayerView`)**: Sätt `pointer-events: none` på hela container-diven. Marginalen är ren visuell dekor för kunden och ska aldrig ta emot klick.

2. **Admin-vy (`LayerCanvas.tsx`)**: När `layer.type === "margin"` ska Rnd-wrappern bara fånga events på de fyra vita kantremsorna, inte i mitten. Två rimliga vägar:
   - **A (enklast)**: Wrappa `Rnd` i logik som sätter `style={{ pointerEvents: "none" }}` på själva Rnd-elementet för margin-lager, men `pointer-events: auto` på de fyra inre kantremsorna. Selection sker då genom att klicka på själva kanten (vilket är intuitivt — det är ju där marginalen ligger).
   - **B (alternativ)**: Behåll Rnd som vanligt men lägg en separat "selection hit-area" bara på kanterna. Mer kod, ingen tydlig vinst.
   
   → Går på **A**.

3. **`renderLayerContent` för margin**: De fyra fyllda div:arna inuti `MarginLayerView` får `pointer-events: auto` så att admin fortfarande kan klicka för att selecta marginalen via dess synliga kant.

## Problem 2 — Linjer går bara att resiza, inte flytta

**Orsak**: En horisontell linje med `hPct ≈ 1` blir bara ~5–8px hög i admin-canvasen. Hela den ytan täcks av Rnd:s resize-handles (top/bottom edges + corners), så det finns ingen "mitt" kvar att greppa för drag.

**Lösning** (`LayerCanvas.tsx`):

1. **Osynlig hit-area runt linjen**: För `layer.type === "line"`, rendera en transparent "padding-zon" på ~10–12px runt själva linjen inuti Rnd-boxen. Själva Rnd-boxen får en minsta interaktiv höjd/bredd (`minHeight: 24px` för horisontell, `minWidth: 24px` för vertikal) **men endast visuellt för admin** — det sparade `hPct/wPct`-värdet ändras inte.

   Konkret: ge Rnd en `style={{ minHeight: layer.type === "line" && layer.defaults.orientation === "horizontal" ? 24 : undefined, minWidth: layer.type === "line" && layer.defaults.orientation === "vertical" ? 24 : undefined }}`. Linjen själv (`LineLayerView`) renderas centrerat inuti, och resten är transparent drag-yta.

2. **Begränsa resize-handles för linjer**: 
   - Horisontell linje → bara `left` + `right` handles (tjocklek styrs via `thicknessMm` i Inspector, inte via drag).
   - Vertikal linje → bara `top` + `bottom` handles.
   - Sätts via Rnd:s `enableResizing={{ left: true, right: true, top: false, ... }}`-prop.
   
   Det här gör att resten av hit-arean (mitten + de inaktiva sidorna) reserveras för **drag**, vilket är exakt det användaren vill.

3. **Cursor-feedback**: `cursor: move` på drag-zonen, `cursor: ew-resize`/`ns-resize` på de aktiva handles (Rnd sköter det redan men värt att verifiera).

## Sammanfattning av ändringar

| Fil | Ändring |
|---|---|
| `src/components/editor/layers/StaticLayers.tsx` | `MarginLayerView`: `pointer-events: none` på containern. |
| `src/components/admin/LayerCanvas.tsx` | För `margin`: Rnd får `pointerEvents: none`, kanterna `pointerEvents: auto`. För `line`: minsta hit-area 24px + begränsade resize-handles (bara längd-axeln). |

Inget i print-pipelinen, schemat eller kund-editorns kontrollpanel påverkas. Kunden kan ändå inte interagera med marginal/linje (locks är `true`) — fixen för marginalen i kund-vyn handlar bara om att inte blockera klick på kartan under.

## Frågor

Inga — beteendet är entydigt utifrån din beskrivning. Säg **kör** så implementerar jag.
