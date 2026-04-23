

## Korrigering: Foto laddas i nativ aspekt + smart pan-beteende

### Problemet

Idag använder både editor-förhandsvisning och snapshot-pipeline `object-fit: cover`. Det betyder att bilden tvingas täcka hela lager-rektangeln genom att skala upp till **längsta** sidan och beskära den korta — kunden ser bara en hårt beskuren del från start och kan aldrig se eller välja från hela bilden.

### Önskat beteende

Bilden visas alltid i sitt **nativa aspektförhållande** (ingen sträckning) och placeras enligt en "**fit**"-regel som behåller hela bilden när det är möjligt:

- Om bilden är bredare än formen → hela höjden syns, sidor sticker ut → kunden panar i x-led för att välja utsnitt.
- Om bilden är högre än formen → hela bredden syns, topp/botten sticker ut → kunden panar i y-led.
- Om bilden har samma aspekt som formen → fyller perfekt, ingen pan behövs.

Det här är `object-fit: cover` matematiskt — **men startpositionen är centrerad och kunden behåller alltid kontroll över utsnittet**. Skillnaden mot idag är inte koden för cover, utan att vi måste **se till att fotot inte komprimeras eller beskärs vid uppladdning** och att vår clamp-logik tillåter att bilden pannas tills dess kanter når formens kanter (inte bara ±50%).

### Vad är faktiskt fel just nu

Två separata buggar:

1. **`PhotoUploadSection.tsx`** anropar inte `preparePhotoSource` (som har downscaling) — men jag måste verifiera att inget annat ställe ändå downscalar. Dock: `object-fit: cover` på en bild *bevarar* aspekten, den beskär bara visuellt. Så den verkliga frågan är pan-clamp:
2. **Pan-clamp [-50, 50]** är fel — den bygger på antagandet att överskottet alltid är 50% av layer-storleken, men det stämmer bara när bildens aspekt skiljer sig oändligt mycket från formens. Korrekt clamp är `±((scaledImgEdge - layerEdge) / layerEdge / 2 * 100)%` per axel, beräknat från bildens nativa dimensioner och formens dimensioner. På den axel där bilden täcker exakt → clamp = 0.

### Lösning

#### 1. Editor-rendering — visa bilden i nativ aspekt + korrekt clamp

`MapPreview.tsx` (`PhotoLayerView`):

- Behåll `object-fit: cover` på `<img>` (det är rätt CSS-beteende: behåller aspekt, fyller container, beskär överskott).
- Ladda in `naturalWidth`/`naturalHeight` när bilden laddas (`onLoad`) → spara i lokalt state.
- Mät containerns `clientWidth`/`clientHeight` via ref + ResizeObserver.
- Beräkna **överskottet i procent** per axel:
  ```
  scale = max(layerW/imgW, layerH/imgH)   // cover-skala
  scaledImgW = imgW * scale
  scaledImgH = imgH * scale
  overflowX% = (scaledImgW - layerW) / layerW * 100
  overflowY% = (scaledImgH - layerH) / layerH * 100
  maxOffsetX = overflowX / 2     // procent av layerW
  maxOffsetY = overflowY / 2
  ```
- Drag-handlers clampar mot `[-maxOffsetX, +maxOffsetX]` och `[-maxOffsetY, +maxOffsetY]` istället för konstanten ±50.
- Om en axel har överskott = 0 → ingen pan i den axeln (cursor blir default i den riktningen, men vi kan behålla en gemensam grab-cursor).

#### 2. Snapshot-rendering — matcha exakt

`template-snapshot.ts` (`drawPhotoLayer`):

- Beräkna samma cover-scale + overflow där.
- Konvertera `offsetX/offsetY` (som är procent av layer-bredd/höjd, samma som editorn) till källbild-pixel-offset:
  ```
  srcOffsetX_px = -(offsetX / 100) * layerW / scale
  srcOffsetY_px = -(offsetY / 100) * layerH / scale
  sx = (img.width - layerW/scale) / 2 + srcOffsetX_px
  sy = (img.height - layerH/scale) / 2 + srcOffsetY_px
  sw = layerW / scale
  sh = layerH / scale
  ```
- `ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h)` — beskär källbilden i nativa pixlar precis där editorn visar utsnittet.
- Detta säkerställer att tryckfilen och cart-thumbnail visar **exakt** samma utsnitt som kunden ser.

#### 3. Reset-pan vid byte av aspekt

När kunden ändrar form (rect → cirkel etc.) så ändras inte lager-aspekten (formen är en clip ovanpå rektangeln) → ingen reset behövs. Men när nytt foto laddas upp → nollställ offset (gjort redan).

#### 4. Verifiera att uppladdning är native

`PhotoUploadSection.tsx`: filen sparas direkt i `photoFile` utan komprimering — detta är redan korrekt. `URL.createObjectURL(file)` ger en blob-URL till originalbilden. Bekräftat: ingen pre-upload downscaling sker. (`preparePhotoSource` används bara av äldre flöde — irrelevant här.)

---

### Filer

| Fil | Ändring |
|---|---|
| `src/components/editor/MapPreview.tsx` | Mät `naturalSize` + container, dynamisk pan-clamp baserad på cover-overflow |
| `src/lib/template-snapshot.ts` | `drawPhotoLayer` använder samma overflow-matematik för pixel-perfekt utsnitt |

### Verifiering

1. Ladda upp ett **liggande** foto i ett **stående** lager → hela höjden syns, sidor sticker ut → kunden kan panna i x-led tills kanten av bilden når formens kant.
2. Ladda upp ett **stående** foto i ett **liggande** lager → omvänt.
3. Ladda upp ett **kvadratiskt** foto i en **kvadratisk** form → ingen pan möjlig (clamp = 0), bilden fyller perfekt.
4. Pan-klamp respekteras: bilden går aldrig att dra utanför formens kant (ingen tom yta).
5. Cart-thumbnail och tryckfilen visar **exakt** samma utsnitt som editorn (pixel-perfekt match).
6. Form-byte (cirkel ↔ rektangel) påverkar inte panningen — bara clip-shape ovanpå.

