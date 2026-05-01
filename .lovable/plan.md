## Lösning: fyra fotografiska mockup-miljöer + 3D-renderad canvas inkomponerad

Vi skaffar fyra nya bakgrundsfoton av tomma rum, var och en fotograferad från exakt den vinkel vi vill visa canvasen i. Sedan rendrar vi canvasen i Three.js (för korrekt UV-wrap av print-filen och rätt perspektiv) och komponerar in den i fotot. Eftersom fotot redan är taget från samma vinkel som canvasen renderas i kommer perspektiven matcha — canvasen ser ut att hänga på den fotograferade väggen.

### De fyra miljöerna

1. **Framifrån** — vägg fotograferad rakt fram, ögonhöjd. Tom väggyta i mitten.
2. **Från höger** — samma typ av vägg, fotograferad ~20° från höger så att man tittar in mot väggen från sidan. Höger sida av en upphängd canvas skulle synas.
3. **Från vänster** — spegelbild av ovan.
4. **Underifrån** — vägg fotograferad från ~15° underifrån, så att ovansidan av canvasen skulle synas.

Stilen ska vara konsekvent: ljust, stilrent, skandinaviskt/Apple-likt minimalistiskt. Tomma rum, neutralt ljus, inga distraherande möbler i fokusområdet.

### Hur bilderna skaffas

Generera dem via Lovable AI (`google/gemini-3-pro-image-preview` för bästa fotorealism). Fyra prompts, var och en specificerar exakt vinkel + tom vägg + att det INTE ska finnas någon tavla på väggen (vi lägger dit canvasen själva). Spara som JPG i `src/assets/mockups/`:

- `canvas-front.jpg`
- `canvas-right.jpg`
- `canvas-left.jpg`
- `canvas-bottom.jpg`

Granska varje bild visuellt innan vi går vidare. Om någon bild ser konstig ut eller har fel vinkel → regenerera.

### Hur canvasen komponeras in

För varje miljö definierar vi i `mockup-scenes.ts`:
- `viewKey` — vilken kameravinkel i Three.js-snapshotten som matchar (front/right/left/bottom)
- `area` — de fyra hörnen i fotot där canvasen ska placeras (perspektiv-korrekt fyrhörning, inte bara en rektangel)
- `referenceWidthCm` — hur många cm i verkligheten frontens bredd motsvarar
- `shadow` — mjuk drop-shadow under canvasen

Three.js-snapshotten:
- En off-screen renderer med transparent bakgrund
- Bara `CanvasMesh` (samma UV-mappning som dagens `Canvas3DPreview` har för front + 4 wrap-sidor)
- Samma fyra fasta kameravinklar som matchar våra fotograferade miljöer
- Exporterar PNG med transparens

Komposition:
- Ladda foto-bakgrunden
- Rita mjuk skugga på väggen där canvasen ska sitta
- Rita den pre-renderade canvas-PNG:en (med transparens) på exakt rätt plats i `area`
- Klart

Eftersom canvasen är pre-renderad i samma vinkel som fotot är taget i, sitter den naturligt på väggen.

## Tekniska ändringar

### Bildgenerering
- Edge function eller direktanrop till Lovable AI image-API för fyra bilder. Spara via `code--exec` till `src/assets/mockups/`.
- QA varje genererad bild: kontrollera att vinkeln stämmer, väggen är tom där canvasen ska sitta, ljussättningen är konsekvent över de fyra. Regenerera vid behov.

### Ny fil: `src/lib/canvas-3d-snapshot.ts`
- `renderCanvas3DViews(printUrl, widthCm, heightCm, depthCm, bleedCm) → Promise<{ front, right, left, bottom }>`.
- En `THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })` återanvänd för alla fyra vyer.
- Endast `CanvasMesh` i scenen (lyft ut logiken från `Canvas3DPreview.tsx` till denna fil och importera tillbaka i preview-komponenten — eller ta bort previewen helt enligt nedan).
- Belysning: ambient + directional uppifrån-vänster, samma för alla vyer.
- Fyra fördefinierade kameror: `[0, 0, 3.6]` (front), `[1.6, 0, 3.0]` (höger), `[-1.6, 0, 3.0]` (vänster), `[0, -1.4, 3.2]` (underifrån). Alla `lookAt(0,0,0)`.
- Render-storlek 900×900 per vy, exporteras som PNG dataURL.

### `src/lib/mockup-scenes.ts`
- Ersätt `CANVAS_SCENES` med fyra nya entries pekande på de fyra fotona, med `viewKey` + `area`.
- `MockupScene`-typen kompletteras med valfritt `viewKey?: "front" | "right" | "left" | "bottom"`.

### `src/lib/mockup-composite.ts`
- Lägg till canvas-gren som tar in en pre-renderad PNG istället för print-snapshotten.
- För canvas: bara `bg → shadow → drawImage(prerenderedPng, x, y, w, h)`. Ingen 2D-skew, ingen wrap-fake.
- Posters-vägen orörd.

### `src/components/editor/MockupGallery.tsx`
- Ta bort `if (isCanvas) return <Canvas3DPreview …/>`.
- Behåll vanliga thumbnail-galleriet för canvas också.
- Innan slot-rendering: anropa `renderCanvas3DViews(snapshotUrl, …)` en gång, mappa resultatet per `viewKey`, skicka in som extra parameter till `compositeMockup`.

### `src/components/editor/Canvas3DPreview.tsx`
- Tas bort. Den interaktiva 3D-vyn är slopad.

### Beroenden
- `three` finns redan. Inga nya paket.

## Risker / öppna frågor

- **AI-genererade bakgrunder kan se "AI" ut**. Vi väljer en stilren minimalistisk stil (vit/ljus vägg, naturligt fönsterljus, inga komplexa möbler) som AI-modeller är bra på. QA-steget är obligatoriskt — om en bild ser dålig ut, regenerera tills den känns äkta.
- **Vinkel-matchning vägg/canvas** är kritisk. Om en bakgrundsbild visar sig ha fel vinkel mot vad vi specificerade, regenerera den, eller justera Three.js-kamerans position så det matchar vad bilden faktiskt visar.
- **Skuggans riktning** måste matcha fotots ljuskälla. Vi specificerar i prompten "fönsterljus från vänster" så vi vet var skuggan ska falla, och spegelvänder skugg-offset för "från vänster"-vyn.
