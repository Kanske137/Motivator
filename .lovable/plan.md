## Mål
Tillåt scroll-zoom på fotolager (vanliga `photo` + `aiPhoto`) i kund-editorn — på samma sätt som kartor zoomar med scroll. Själva lagrets ram/position ändras inte; endast bilden inuti zoomas, och kan fortfarande pannas. Zoomen sparas med designen så print/cart-preview blir identiska.

## Datamodell

Lägg till `zoom: number` (1.0 = "cover", max ~5.0) i båda lagervärdena i `src/stores/editorStore.ts`:

```ts
PhotoLayerValue   { kind, shape, offsetX, offsetY, zoom }
AiPhotoLayerValue { kind, shape, offsetX, offsetY, zoom }
```

- Default `1`, clamp `[1, 5]`.
- Initieras till `1` överallt där `offsetX/Y: 0` redan sätts (defaults + reset-platser, rad 335/342/930/1316/847/853).
- `zoom < 1` tillåts inte (skulle ge "contain"-luft inom layern).
- Ny setter: `setLayerPhotoZoom(id, zoom)` som anropar `updatePhoto(...)` precis som `setLayerPhotoOffset`. Vid zoom-ändring re-clampas också offset mot den nya overflow-rangen.

## Render-matte (en formel överallt)

Nuvarande cover-skala:
`scale = max(box.w/nat.w, box.h/nat.h)`

Ny:
`scale = max(box.w/nat.w, box.h/nat.h) * zoom`

Det ger automatiskt större `renderW/H`, större overflow och därmed större `maxX/maxY` för pan. Befintlig pan-logik fungerar då oförändrat även när man zoomat in.

## Filer & ändringar

### 1. `src/stores/editorStore.ts`
- Utöka `PhotoLayerValue` + `AiPhotoLayerValue` med `zoom: number`.
- Lägg till default `zoom: 1` i alla initialisering- och reset-block.
- Lägg till `setLayerPhotoZoom: (id, zoom) => void` i interface + implementation. Implementation clamp:ar 1–5 och re-clampar `offsetX/Y` med ny `maxX/Y` (beräknad utan att känna till `natural`, så vi använder samma trick som idag — vyn re-clampar via befintlig `useEffect`).

### 2. `src/components/editor/MapPreview.tsx` (`PhotoLayerView`)
- Lägg till prop `zoom: number` och skicka in från `MapPreview`-mappingen för både `photo` (rad 538-558) och `aiPhoto` (rad 598-625).
- Multiplicera `scale` med `zoom` i:
  - render-block raderna 871-881
  - `applyImagePosition` rad 904
  - `measureBoundsNow` rad 955
- Lägg till `onWheel`-handler på containern:
  - Endast aktiv när `fit === "cover"` och `draggable`.
  - `e.preventDefault()` + `e.stopPropagation()`.
  - `nextZoom = clamp(currentZoom * exp(-deltaY * 0.0015), 1, 5)`.
  - Anropa `setLayerPhotoZoom(layerId, nextZoom)`.
- Sätt `touchAction: "none"` på containern oavsett pan-behov när zoom är möjlig så att vertikal scroll inte sidescrollar sidan när musen är över bilden vid wheel.
- (Ingen pinch-gest i denna iteration — användaren bad bara om scroll-wheel.)

### 3. `src/lib/template-snapshot.ts` (`drawPhotoLayer`)
- Lägg till `zoom: number` (default 1) i signaturen.
- Ändra `scale = Math.max(rect.w/img.width, rect.h/img.height) * zoom`.
- Resten av cover-matten (`sw, sh, overflow, clamp, sx, sy`) använder samma `scale` så de blir automatiskt korrekta för zoom + pan.
- Anropssidan (rad 699-738) skickar `pv?.zoom ?? 1` resp. `av?.zoom ?? 1`.

### 4. Print/cart-preview
- Inga ytterligare ändringar — `getPrintFileUrl` använder `template-snapshot`, så zoom propagerar automatiskt till både cart-thumbnail och Gelato print file. WYSIWYG bevaras.

## Vad jag INTE ändrar
- Admin-designer, layout-positioner, ramar, mockup-galleri, text, kartlogik, pricing, locales, Shopify-variantresolver, Gelato-SKU.
- Inga nya översättningsnycklar (ingen ny UI-text).

## Verifiering
1. `/editor?handle=personlig-fototavla&type=poster` (med foto laddat): scroll upp → bild zoomar in, scroll ner → ut. Pan fungerar i båda zoom-nivåer. Släpp musen → ingen snap-back.
2. `/editor?handle=brollopskarta&type=poster`: kartzoom oförändrad.
3. AI-fotolager: samma zoom-beteende.
4. Lägg i varukorg och inspektera `_preview_image` — bilden i thumbnailen ska matcha editorns zoom+pan.

## Avgränsning
Endast `src/stores/editorStore.ts`, `src/components/editor/MapPreview.tsx`, `src/lib/template-snapshot.ts`.