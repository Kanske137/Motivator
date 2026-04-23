
## Felsökning: varför bilder fortfarande känns beskurna

Det finns två separata fel i nuvarande implementation:

1. `PhotoLayerView` använder `<img className="w-full h-full object-cover">` och flyttar sedan hela `<img>`-elementet med `transform: translate(...)`.
   - Det betyder att det som flyttas är den redan beskurna viewporten, inte den fulla bilden.
   - Resultat: kunden kan inte nå innehåll som finns utanför den initiala `object-cover`-cropen.

2. Clamp-logiken räknas ut från bildens naturliga storlek, men CSS-rörelsen sker på ett element vars storlek fortfarande är `100% x 100%`.
   - Matematik och faktisk rendering matchar alltså inte helt.
   - Det gör att drag kan kännas fel och inte stanna exakt vid bildens kanter.

---

## Korrigering

### 1. Byt renderingsmodell för foto-lager i editorn

`src/components/editor/MapPreview.tsx`

I `PhotoLayerView`:
- Sluta använda `object-cover` + `translate` på ett fullstort `<img>`.
- Rendera istället bilden som ett absolut-positionerat element med **faktisk skalad storlek**:
  - beräkna `scale = max(boxW / imgW, boxH / imgH)` för `cover`
  - `renderW = imgW * scale`
  - `renderH = imgH * scale`
- Placera bilden centrerat i containern:
  - `left = (boxW - renderW) / 2`
  - `top = (boxH - renderH) / 2`
- Applicera pan som pixel-offset ovanpå denna centrering.
- Containern fortsätter ha `overflow: hidden` + aktuell clip-path/form.

Detta gör att hela originalbilden faktiskt finns “bakom” behållaren, och att drag visar mer av bilden istället för att bara flytta en redan beskuren ruta.

### 2. Ändra pan-state från procent till verkligt användbar modell

Behåll gärna store-fälten som `offsetX` / `offsetY`, men definiera dem tydligt som:
- procent av **max tillåten overflow per axel**, eller
- pixlar i editorcontainern.

Rekommenderat för minst friktion:
- fortsätt lagra dem som procent av container, men beräkna faktisk pixelrörelse från verklig overflow:
  - `overflowX = max(0, renderW - boxW)`
  - `overflowY = max(0, renderH - boxH)`
  - `minLeft = -overflowX`
  - `maxLeft = 0`
  - `minTop = -overflowY`
  - `maxTop = 0`

Alternativt, enklare och robustare:
- lagra `offsetX` / `offsetY` i pixlar i store för foto-lager.
- Då blir editor och snapshot enklare att synka exakt.

### 3. Clamp exakt till bildens kanter

I `MapPreview.tsx`:
- Pan ska bara vara möjlig på axlar där overflow finns.
- Vid drag:
  - bred bild i smal behållare → bara x-led
  - hög bild i bred behållare → bara y-led
- Clamp ska vara:
  - `left` mellan `[-overflowX, 0]`
  - `top` mellan `[-overflowY, 0]`

Detta säkerställer:
- ingen tom yta någonsin visas
- kunden kan dra hela vägen fram till respektive kant
- man kan inte dra bortom bildens innehåll

### 4. Matcha snapshot-/thumbnail-/print-rendering exakt

`src/lib/template-snapshot.ts`

`drawPhotoLayer` ska inte använda nuvarande mellanvariant längre, utan samma modell som editorn:
- beräkna samma `scale`, `renderW`, `renderH`, `overflowX`, `overflowY`
- konvertera sparad pan till källbildens crop-rect exakt
- använd `ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h)`

Formelmässigt ska snapshoten utgå från samma “cover + centered + pan within overflow”-logik som editorn, så att:
- editor
- cart thumbnail
- mockup preview
- slutlig tryckfil

visar identiskt utsnitt.

### 5. Säkerställ att preview inte misstolkas som crop

`src/components/editor/PhotoUploadSection.tsx`

Uppladdningen verkar redan använda originalfilen via `URL.createObjectURL(file)`, så problemet är inte själva filen.

Men det finns en missvisande text som fortfarande säger:
- “Bilden ersätter kartan. Återgå till karta genom att ta bort bilden.”

Den bör uppdateras så den speglar dagens lagerbaserade foto-flöde, annars skapar den förvirring under test.

---

## Filer att ändra

| Fil | Ändring |
|---|---|
| `src/components/editor/MapPreview.tsx` | Byt från `object-cover`-elementförflyttning till explicit skalad bildyta med riktig overflow-pan och exakt clamp |
| `src/lib/template-snapshot.ts` | Spegla samma cover/pan-logik pixelperfekt i snapshot/thumbnail/print |
| `src/stores/editorStore.ts` | Eventuellt justera semantik för foto-offsets om pixelbaserad modell väljs |
| `src/components/editor/PhotoUploadSection.tsx` | Uppdatera hjälptext så den inte längre refererar till gamla “ersätter kartan”-flödet |

---

## Verifiering

1. Ladda upp en stående bild i en bred foto-placeholder:
   - hela bredd-logiken fungerar
   - kunden kan dra upp/ned tills bildens topp/botten precis når kanten

2. Ladda upp en liggande bild i en smal foto-placeholder:
   - kunden kan dra vänster/höger tills sidorna precis når kanten

3. Ingen tom yta ska någonsin kunna visas i foto-lagret.

4. Innehåll som tidigare var “otillgängligt” ska nu kunna nås om det faktiskt finns inom bildens overflow.

5. Cart-thumbnail och tryckfil ska matcha exakt det kunden ser i editorn.

6. Kvadratisk bild i matchande behållare:
   - ingen onödig pan
   - clamp blir 0 på båda axlar

---

## Arbetsordning

1. Refaktorera `PhotoLayerView` i `MapPreview.tsx`
2. Synka samma matematik i `template-snapshot.ts`
3. Justera eventuell store-semantik för offsets
4. Uppdatera missvisande hjälptext i `PhotoUploadSection.tsx`
5. Verifiera editor + cart preview + print snapshot mot samma foto

