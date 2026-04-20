

## Plan: Rena väggar + ramar i mockups + klickbar lightbox

### 1. Återgenerera 6 mockup-bilder med tomma väggar
Ersätt alla bilder i `src/assets/mockups/` så väggytan är **helt tom** (inga befintliga tavlor/ramar). Möbler behålls för skala.

- `poster-livingroom.jpg` — soffa nedtill, tom vägg ovan
- `poster-bedroom.jpg` — säng nedtill, tom vägg ovan
- `poster-office.jpg` — skrivbord nedtill, tom vägg ovan
- `poster-wall.jpg` — närbild ren vägg med golvlist
- `canvas-livingroom.jpg` — soffa, tom vägg, lätt vinkel för djup
- `canvas-side.jpg` — diagonal vy mot tom vägg så wrap syns tydligt

### 2. Justera scen-koordinater
Uppdatera `area` + `referenceWidthCm` i `src/lib/mockup-scenes.ts` så postern hamnar exakt på den tomma väggytan i rätt skala (30x40 ska se litet ut, 100x140 stort).

### 3. Rendera ram i compositen om vald
Idag ritar `mockup-composite.ts` bara postern. Lägg till ram-rendering när `frameColor` är satt:

- Acceptera `frameColor` + `frameWidthCm` som inputs
- Rita en rektangel runt postern i vald färg (vit/svart/ek/valnöt)
- Bredden skalas mot `referenceWidthCm` precis som postern → liten poster får tunn ram, stor får tjockare
- Lägg lätt skugga/inner-shadow så det ser ut som riktigt trä/metall, inte platt
- Canvas-scener får ingen ram (de wrappas redan)

`MockupGallery.tsx` skickar in `variant`/`frameColor` från store så varje ruta visar exakt det användaren valt.

### 4. Klickbar lightbox-preview
Gör varje mockup-kort i `MockupGallery.tsx` klickbart. Vid klick öppnas en `Dialog` (shadcn) med:

- Stor version av mockupen (max 90vw / 90vh)
- Scen-label som titel
- Stäng-knapp
- Pil-navigering mellan scenerna (◀ ▶) så man kan bläddra utan att stänga
- Mörk bakdrop, klick utanför stänger

### Filer som ändras
- `src/assets/mockups/*.jpg` (6 bilder ersätts)
- `src/lib/mockup-scenes.ts` (nya area-koordinater)
- `src/lib/mockup-composite.ts` (ram-rendering)
- `src/components/editor/MockupGallery.tsx` (skicka frame-props + lightbox-dialog)

### Förväntat resultat
- Postern ser ut att hänga direkt på väggen — ingen "tavla i tavla"
- Vald ram (vit/svart/ek/valnöt) syns runt postern i miljön
- Storleksskillnader är trovärdiga mot möblerna
- Klick på en ruta öppnar stor preview i dialog med bläddring

