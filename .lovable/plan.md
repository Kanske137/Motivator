# Sömlösa linje-möten: auto-snap, auto-extend och pixel-perfekt rendering

## Mål
När två linjer ligger an mot varandra i admin-designern ska de mötas helt sömlöst — inga glapp, inga överlappningar, inga rundade hörn. Linjer ska kunna användas för att bygga ramar och rutnät där varje hörn är skarpt och vinkelrätt.

## Problem idag
1. **Linjer ritas centrerat** i sin hit-box med `transform: translate(-50%)` → subpixel-suddighet, svårt att få två linjer att möta varandra exakt.
2. **Snap är 5%-rutnät** — alldeles för grovt för att tunna linjer ska kunna möta varandras kanter.
3. **Tjocklek anges i `px`** medan position är i `%` → vid olika canvasstorlekar hamnar kanterna olika.
4. **Inga hörn-fyllningar**: där en horisontell och vertikal linje möts uppstår en tom kvadrat i hörnet på den ena linjens tjocklek.

## Lösning

### 1. Pixel-perfekt rendering (`StaticLayers.tsx` → `LineLayerView`)
Ta bort `top: 50% / transform: translateY(-50%)`-centreringen. Linjen ritas direkt på en kant av sin hit-box med exakt höjd/bredd = tjocklek, och `borderRadius: 0` explicit för vinkelräta hörn. Hit-area för drag löses fortfarande via `minHeight/minWidth: 24` på Rnd (redan på plats).

### 2. Edge-snap mot andra linjer (`LayerCanvas.tsx`)
När en linje dras eller resizas:
- Bygg snap-kandidater från andra linjers start-/slut-kant och tvärs-axel-position.
- Om den dragna kanten ligger inom **2%-tolerans** av en kandidat, snappa exakt mot kandidaten istället för mot 5%-rutnätet.
- 5%-rutnätet behålls som fallback när ingen edge-kandidat är nära.

### 3. Auto-extend i hörn (efter commit)
Vid `onDragStop`/`onResizeStop` på en linje:
- Hitta linjer på motsatt orientering vars kropp överlappar linjens ände.
- Förläng linjen med tvär-linjens tjocklek så hörnet fylls helt.
- Implementeras som `extendLineToMeetCorners(line, allLayers)` i `src/lib/layer-utils.ts`.

### 4. Tjocklek i container-query-enheter
Behåll `thicknessMm` i datamodellen, men rendera den med `min(Xcqw, Xcqh)` (samma teknik som margin) så att två linjer med samma tjocklek alltid renderar exakt lika tjockt oavsett canvasstorlek — förutsättning för att auto-extend ska bli pixel-perfekt.

## Filer som ändras
- `src/components/editor/layers/StaticLayers.tsx` — `LineLayerView`: ta bort centrering, container-query-tjocklek, `borderRadius: 0`.
- `src/lib/layer-utils.ts` — nya `snapLineToOtherLines()` och `extendLineToMeetCorners()`.
- `src/components/admin/LayerCanvas.tsx` — anropa de nya hjälparna i `onDrag`/`onDragStop`/`onResize`/`onResizeStop` för line-typer; 5%-snap som fallback.

## Inte i scope
- Datamodell/migrationer — `thicknessMm` förblir enda tjocklek-fältet.
- Kund-editorn är fortsatt admin-låst för linjer; den nya renderingen slår dock igenom så även kunden ser sömlösa hörn.