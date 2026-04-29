## Bakgrund

Efter att canvasLayout (separat layout-block för canvas med full-area koordinater + wrap-zoner) införts i admin-designern är centrala pipelines redan korrekt uppdaterade — men flera ytor läser fortfarande från `defaultLayout` eller skickar inte med `productType`, vilket gör att canvas-mallar visas/printas fel utanför admin-designern.

## Status — vad funkar redan

- `template-snapshot.ts` (`renderTemplateSnapshot`) använder `getActiveLayoutBlock()` + `layersIncludeWrap`-logik
- `print-pipeline.ts` plockar layers via `getActiveLayoutBlock()`
- `MapPreview.tsx` (kund-editor) tar emot `layersIncludeWrap`
- `EditorPage.tsx` skickar `layersIncludeWrap` till `MapPreview` och `productType` till `getPrintFileUrl`

## Vad som måste fixas

### 1. `MockupGallery.tsx` — saknar `productType`
Anropet till `renderTemplateSnapshot` på rad 62 utelämnar `productType`, så canvas-mallar med `canvasLayout` får layern ritad mot fel anchorzone i den snapshot som används som textur i 3D-previewn.
**Fix:** lägg till `productType: config.product_type` i input-objektet.

### 2. `EditorPage.tsx` — hårdkodat wrap-djup
`wrapCm: isCanvas ? 2 : 0` ignorerar kundens valda djup (variantens "2 cm"/"3 cm"/"4 cm"). Ska läsa djupet från `variant` på samma sätt som `MockupGallery` redan gör (`variant.match(/(\d+)/)`). Detta påverkar både print-fil och cart-thumbnail.
**Fix:** beräkna `canvasDepthCm` från variant och använd istället för hårdkodad 2.

### 3. `TemplateThumbnail.tsx` — admin-thumbnails på AdminConfigs
Använder `template.defaultLayout.portrait`, så canvas-mallar visar poster-layouten i thumbnailen istället för canvasLayout med wrap-zoner.
**Fix:** välj layout via `getActiveLayoutBlock(template, productType)`. Komponenten saknar idag `productType`, så ny prop läggs till och `AdminConfigs.tsx` skickar `c.product_type`. För canvas-thumbnails ritas dessutom en streckad ram som markerar synlig framsida (motsvarande `LayerCanvas`-overlayen, men i miniatyr).

### 4. `AdminConfigs.tsx` — lager-räkning per kort
Visar "X lager (stående)" från `defaultLayout.portrait.layers.length`. För canvas-konfigs ska den räkna `canvasLayout.portrait.layers.length`.
**Fix:** välj rätt block via `getActiveLayoutBlock`.

### 5. `FormatSection.tsx` — margin-detektering
`hasMarginLayer` läser `template.defaultLayout?.[orientation]`. För canvas-produkter blir detektionen fel.
**Fix:** använd `getActiveLayoutBlock(template, config.product_type)[orientation]`.

## Filer som ändras

- `src/components/editor/MockupGallery.tsx` — lägg till `productType` i snapshot-input
- `src/pages/EditorPage.tsx` — använd kundvalt canvas-djup i `wrapCm`
- `src/components/admin/TemplateThumbnail.tsx` — välj layout via helper, ny `productType`-prop, rita front-zon-markör för canvas
- `src/pages/AdminConfigs.tsx` — skicka `product_type` till TemplateThumbnail + använd helper för lager-räkning
- `src/components/editor/FormatSection.tsx` — använd helper för margin-detektering

## Resultat

Efter denna pass går samma `canvasLayout` (med wrap-anchored koordinater och proportionell skalning vid djup-ändring) hela vägen från admin-designern → admin-thumbnail → kund-editor (2D-preview) → 3D-mockup → cart-thumbnail → print-fil. Inga ytor läser längre `defaultLayout` när produkten är canvas.
