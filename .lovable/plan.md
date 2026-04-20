
## Plan: Gör preview och canvas identiska med editorn

### Grundorsak
Nuvarande preview bygger inte på samma render som editorn. Det finns flera separata approximationer:

1. `generate-print-file` räknar fel storlek:
   - `pxFromSize()` cappar båda sidor till `1280`, vilket gör många stående format till `1280x1280` i stället för korrekt proportion.
   - Det gör att form, textposition och innehåll skalar fel.

2. Kartbilden dubbel-skalar:
   - Static API anropas med `@2x`, men SVG:n ritar sedan bilden som om den också måste förstoras 2x igen.
   - Resultat: fel utsnitt/zoom/lokalisering jämfört med live-editorn.

3. Labels kan inte döljas identiskt med dagens backend-render:
   - I editorn stängs symbol-lager av live.
   - I preview används fortfarande standard-style i static-rendern, så `showLabels=false` kan aldrig bli exakt.

4. Texten renderas två gånger med olika logik:
   - Editorn använder layout från `currentLayout()`.
   - Preview använder hårdkodad storlek och hårdkodad Y-position.
   - Därför blir texten större och felplacerad.

5. Canvas använder rätt 3D-teknik för objektet, men fel källa för innehållet:
   - Textur kommer från print-filen, inte från exakt samma visuella output som editorn visar.

### Lösning
Byt preview-flödet till en enda källa för sanningen: en snapshot av exakt samma poster-render som användaren ser i editorn.

### 1. Skapa en delad poster-render som används av både editor och preview
Bryt ut själva posterinnehållet till en gemensam komponent, t.ex. `PosterArtwork`, som innehåller:

- posterbakgrund
- kartcontainer
- shape-mask (`rect` / `square` / `circle`)
- labels on/off
- textlager med samma layout och samma typografi
- samma proportioner och samma positioner som live-editorn

`MapPreview` ska bara bli ett “viewer-shell” runt denna delade render.

Resultat:
- live-editor och snapshot använder exakt samma DOM/render-struktur
- inga fler separata text-/shape-beräkningar för preview

### 2. Byt mockup-preview från edge function till klient-snapshot
För själva förhandsvisningarna i galleriet:

- rendera `PosterArtwork` offscreen i exakt valt format/orientation
- fånga den till bild med en DOM→image-lösning
- använd den bilden som källa för:
  - poster-mockups i miljöbilder
  - canvas 3D-texturer

Detta löser direkt:
- områdesnamn av/på
- bakgrundsfärg
- form
- text synlig/osynlig
- textstorlek
- textplacering
- faktisk lokalisering/utsnitt

för att allt kommer från samma visuella render som editorn.

### 3. Gör canvas 3D helt beroende av samma snapshot
Behåll Three.js-spåret, men mata `Canvas3DPreview` med snapshot-bilden i stället för `printUrl` från backend.

Implementering:
- front face = snapshot från `PosterArtwork`
- side/top/bottom = croppade edge-strips från samma snapshot
- djup = från vald canvas-variant (2 cm / 4 cm)
- lightbox fortsätter använda riktig rotation

Det gör att canvasens front alltid visar exakt samma innehåll som editorn, inte en separat approximation.

### 4. Fixa `generate-print-file` separat för riktig export
Preview och export ska inte längre vara samma pipeline.

`generate-print-file` behöver ändå rättas för framtida produktionsfiler:
- bevara aspect ratio när maxdimension cap:as
- sluta dubbel-skala static-bilden
- ta emot normaliserad layoutdata i stället för hårdkodad textplacering
- på sikt: egen no-label style-mappning eller annan exportstrategi för helt korrekt label-off även i slutlig tryckfil

Detta är viktigt, men ska inte längre blockera korrekt preview.

### 5. Synka storlek och position från riktiga layoutdata
Inför en liten render-spec som båda sidor använder:

- poster aspect
- map bounds / mask
- text layers
- text font
- text visibility
- background color

Preview ska läsa direkt från samma state/layout som editorn.
Inga magiska tal för fontstorlek eller `baseY`.

### Filer att ändra
- `src/components/editor/MapPreview.tsx` — göra tunnare och dela upp render
- `src/components/editor/MockupGallery.tsx` — sluta använda backend-render som previewkälla
- `src/components/editor/Canvas3DPreview.tsx` — använda snapshot i stället för print-url
- `src/lib/mockup-composite.ts` — ta snapshot som input för poster-mockups
- `supabase/functions/generate-print-file/index.ts` — rätta proportionalitet/exportlogik
- Ny fil, t.ex. `src/components/editor/PosterArtwork.tsx` — gemensam render
- Ny fil, t.ex. `src/lib/editor-snapshot.ts` eller hook — skapa snapshot från offscreen-render

### Tekniska detaljer
```text
Editor state
   -> PosterArtwork (single source of truth)
      -> MapPreview (live)
      -> Snapshot image (offscreen)
         -> Poster mockup composite
         -> Canvas3DPreview texture
```

```text
Nu:
Editor -> Mapbox live
Preview -> generate-print-file -> SVG/static map
Canvas -> printUrl -> 3D

Efter ändring:
Editor -> PosterArtwork
Preview -> PosterArtwork snapshot
Canvas -> PosterArtwork snapshot -> 3D
Export -> generate-print-file (separat ansvar)
```

### Förväntat resultat
- Förhandsvisningen visar exakt samma innehåll som editorn
- Om områdesnamn stängs av i editorn är de också av i preview
- Form (`rect/square/circle`) blir identisk
- Textstorlek och textplacering matchar
- Kartans utsnitt/lokalisering matchar
- Canvas visar exakt samma frontinnehåll som editorn, men i riktig 3D
- Preview blir stabilare eftersom den inte längre bygger på en separat approximativ renderkedja
