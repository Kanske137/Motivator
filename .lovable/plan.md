

## Korrigering: Cirkelform ska alltid vara en perfekt cirkel

### Problemet

`shapeClipPath("circle")` returnerar `circle(50% at 50% 50%)` som CSS-clip-path. När lagrets behållare inte är kvadratisk (t.ex. 200×300px) blir 50% beräknat som 50% av den **kortaste** sidan i CSS-spec — men formen visas inom hela rektangeln, vilket gör att cirkeln visuellt blir en ellips eller beskärs i den långa riktningen beroende på `clipPathUnits`. Resultat: cirkeln ser oval/avhuggen ut på icke-kvadratiska kart- och bildlager.

### Lösningen

Cirkeln ska:
- Alltid vara en **perfekt geometrisk cirkel** (1:1 aspekt).
- Ha en diameter som motsvarar **kortaste sidan** av lagrets behållare.
- Vara **centrerad** i behållaren.
- Inget innehåll (karta/bild) ska beskäras utanför cirkeln, men den oanvända ytan utanför cirkeln (på den långa axeln) lämnas synligt clippad bort.

CSS-syntaxen `circle(R at Cx Cy)` med pixelvärden ger en perfekt cirkel. Alternativ (mer robust): använd procent baserat på `min(width, height)` via `circle(min(50%, 50%))` — men CSS stödjer inte `min()` direkt i clip-path-radius på alla webbläsare. Säkraste lösningen är att räkna ut radien i pixlar från uppmätt container-storlek.

### Implementation

**`src/components/editor/MapPreview.tsx`**

I huvud-render-loopen där varje lager renderas:
- Mät varje cirkel-clippad behållares verkliga pixelstorlek (ResizeObserver, samma mönster som redan används i `PhotoLayerView`).
- Beräkna `radius = Math.min(width, height) / 2`.
- Skicka in en pixel-baserad clip-path: `circle(${radius}px at 50% 50%)` istället för dagens `circle(50% at 50% 50%)`.

För att undvika att duplicera ResizeObserver-logik i två grenar (map + photo), introducera en liten hjälpkomponent eller hook `useCircleClip(enabled)` som returnerar `{ ref, clipPath }` där `clipPath` är `undefined` när `enabled === false`.

Använd den i:
- Map-grenen: när `effectiveShape === "circle"` → använd `useCircleClip(true).clipPath` istället för det statiska värdet från `shapeClipPath`.
- Photo-grenen: samma sak. (`PhotoLayerView` mäter redan `box.w/h` — exponera radien därifrån istället för att räkna ut det igen.)

Heart/star fortsätter använda SVG-clipPath som idag (de är `objectBoundingBox` och tål icke-kvadratiska behållare bättre eftersom de avsiktligt får skalas, men om det visar sig att även dessa känns "dragna ut" kan vi addera samma kvadratiserings-trick i ett senare steg — för nu håller vi oss till cirkeln som du explicit nämnde).

**`src/lib/template-snapshot.ts`** (`drawMapLayer`, `drawPhotoLayer`)

Snapshot-pipelinen klipper också till form. När `shape === "circle"`:
- Använd `ctx.save() → ctx.beginPath() → ctx.arc(cx, cy, min(rect.w, rect.h)/2, 0, 2*Math.PI) → ctx.clip()` istället för en elliptisk path.
- Detta säkerställer att cart-thumbnail och tryckfilen visar exakt samma perfekta cirkel som editorn.

**`src/components/admin/MapLayerPreview.tsx`**

Admin-tile-previewen använder också `circle(50% at 50% 50%)`. Samma fix där: mät tile-storlek (eller använd `min(width, height) / 2` baserat på de `width`/`height`-props som redan skickas in) → pixel-radie.

### Filer

| Fil | Ändring |
|---|---|
| `src/components/editor/MapPreview.tsx` | Ny `useCircleClip` hook; map- och photo-grenarna använder pixel-radie för cirkel |
| `src/lib/template-snapshot.ts` | `drawMapLayer` + `drawPhotoLayer` clippar med `ctx.arc(min(w,h)/2)` när `shape === "circle"` |
| `src/components/admin/MapLayerPreview.tsx` | Pixel-baserad radie från `width`/`height`-props |

### Verifiering

1. Mall med ett **stående** kartlager (cirkel-form): cirkeln är perfekt rund, centrerad, med tomma marginaler ovan/under.
2. Mall med ett **liggande** fotolager (cirkel-form): cirkeln är perfekt rund, centrerad, tomma marginaler vänster/höger.
3. Kvadratiskt lager: cirkeln fyller hela rutan precis som idag (ingen regression).
4. Cart-thumbnail och Gelato-tryckfil visar identisk perfekt cirkel.
5. Admin-designer LayerCanvas-tile visar perfekt cirkel oavsett tile-aspekt.
6. Heart/star-formerna är oförändrade.

