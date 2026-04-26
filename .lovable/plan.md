## Problem
Shape-lager (ramar: rect, oval, rounded, double, corners + linjer) ligger ofta ovanpå karta/text. `Rnd`-wrappern runt shape-lagret fångar alla klick/drag i hela bounding-boxen — även i den tomma mitten av en ram — vilket gör att man inte kan markera kart- eller textlager innuti ramen.

Margin-lagret är redan löst på samma sätt: `Rnd` får `pointerEvents: "none"` och bara de fyllda kant-stripes har `pointerEvents: "auto"`.

## Lösning
Tillämpa samma mönster på `shape`-lager:

### 1. `src/components/admin/LayerCanvas.tsx`
- Sätt `pointerEvents: "none"` på `Rnd` när `layer.type === "shape"` OCH formen är en RAM-typ (`frame-rect`, `frame-oval`, `frame-rounded`, `frame-double`, `frame-corners`).
- Linjeformer (`line-horizontal`, `line-vertical`) ska behålla normal pointer-events (de är redan smala och har `minHeight/minWidth: 24` som hit-area, precis som `line`-lager).
- Behåll `cursor-move` på den inre wrappern bara där den är klickbar.

### 2. `src/components/editor/layers/ShapeLayerView.tsx`
- För ram-formerna (rect/oval/rounded/double/corners): byt ytterdiven från `pointer-events-none` till `pointer-events: none` på containern och sätt `pointer-events: auto` på själva SVG-strecken / DOM-elementen som ritar ramen. Det gör att admin kan klicka på ramens linjer för att markera den, men inte i den tomma mitten.
- För linje-formerna (`line-horizontal`/`line-vertical`): behåll `pointer-events: auto` på själva linjen (Rnd-wrappern släpper igenom som ovan, men 24px hit-area finns kvar via Rnd's `minHeight/minWidth` — vi behöver också justera så linjeformer inte får `pointerEvents: none` på Rnd).

### 3. Inramnings-konsekvens
- Ringen som visar selection runt en shape (`ring-1 ring-border/60 hover:ring-primary/50`) ritas idag på `Rnd`-elementet. När `Rnd` blir pointer-events:none försvinner `:hover`-effekten. Lösning: behandla shape-ramar som `margin` redan gör — ta bort hover-ringen på ram-shapes (kommentar förklarar varför) och visa istället markering visuellt via stroke-färgen + name-tag när hovrad/vald.

## Filer som ändras
- `src/components/admin/LayerCanvas.tsx` — lägg till `isShapeFrame`-flagga, applicera `pointerEvents: "none"` på Rnd, hoppa över hover-ring för ram-shapes.
- `src/components/editor/layers/ShapeLayerView.tsx` — sätt `pointer-events: auto` på SVG-element / line-divs så att själva ramens streck fortfarande är klickbara; container förblir genomsläpplig.

## Resultat
- Klick i mitten av en ram (där det är tomt) går igenom till lager under (karta, text, foto).
- Klick på själva ramens streck markerar fortfarande shape-lagret.
- Linje-shapes fungerar oförändrat (drag/select via 24px hit-area).
- Margin- och ram-lager beter sig nu konsekvent.
