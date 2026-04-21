

## Plan: Synka editorns aspect ratio med vald storlek + fixa form-uppdatering

### Grundorsak

**1. Editorns aspect ratio ändras inte med storleksval**
`MapPreview` beräknar `posterAspect` korrekt från `size` + `orientation`, men `frameStyle` har `maxWidth: "min(100%, 70vh)"` OCH `maxHeight: "78vh"` samtidigt. Kombinationen gör att postern alltid fyller samma visuella box oavsett ratio — browsern väljer den dimension som "passar först" och då dominerar viewport-cappen, inte `aspectRatio`. Resultatet: editorn ser nästan likadan ut för 30×40 (0.75) och 50×70 (0.714), och cirkel/kvadrat-clipen hamnar mot fel referensram.

**2. Cirkel/kvadrat ser stretchad ut i förhandsvisningen**
Snapshoten (`editor-snapshot.ts`) beräknar `posterAspect` från `size` korrekt och renderar en sann kvadratisk Mapbox-canvas för `square`/`circle`. MEN editorns visuella ram följer inte samma aspect (pga problem 1), så användaren upplever förhandsvisning ≠ editor. När editorns aspect synkas korrekt försvinner den upplevda mismatchen.

**3. Form uppdateras inte direkt**
`MockupGallery` debouncar snapshot-rendern men sätter inte `reqIdRef` synkront vid `mapShape`-ändring → en pågående render från föregående form kan skriva över den nya.

### Lösning

**A. `src/components/editor/MapPreview.tsx` — låt aspect styra layouten**
- Ta bort `maxWidth: "min(100%, 70vh)"`. Behåll bara `maxHeight: 78vh` som säkerhet mot att postern blir högre än viewporten.
- Sätt `width: "auto"` när `posterAspect < 1` (portrait) så att höjden (begränsad av `maxHeight`) styr och bredden följer aspect.
- Sätt `height: "auto"` + `width: "min(100%, 70vh)"` när `posterAspect >= 1` (landscape).
- Behåll `aspectRatio: ${posterAspect}` så browsern räknar rätt.

Resultat: editorns ram ändrar form direkt när användaren byter storlek (30×40 vs 50×70 vs 70×100 ger synligt olika ratio), och förhandsvisningens snapshot matchar exakt eftersom båda läser samma `size`/`orientation`.

**B. `src/lib/editor-snapshot.ts` — säkerställ stabil render per anrop**
- Slopa den delade `snapshotContainer`-diven. Skapa ny wrapper + `mapDiv` per anrop, ta bort i `finally`.
- Vänta på två `idle`-events efter `setLayoutProperty` (label-toggle) för att garantera att tiles är ritade innan `getCanvas()` läses.

**C. `src/components/editor/MockupGallery.tsx` — invalidera direkt vid form-byte**
- Bumpa `reqIdRef` synkront i början av `useEffect` som lyssnar på `mapShape`, så stale render från tidigare form aldrig kan sätta resultat efter att användaren bytt.

### Filer som ändras
- `src/components/editor/MapPreview.tsx` — ny `frameStyle`-logik baserat på `posterAspect`.
- `src/lib/editor-snapshot.ts` — unik container per render, dubbel `idle`-väntan.
- `src/components/editor/MockupGallery.tsx` — synkron `reqIdRef`-bump på `mapShape`-byte.

### Förväntat resultat
- Editorns ram ändrar aspect ratio direkt vid storleksval (synlig skillnad mellan 30×40, 50×70, 70×100, kvadratiska format).
- Förhandsvisningens form matchar editorns exakt — ingen upplevd "stretchad cirkel" eftersom båda har samma ratio-källa.
- Form-byte (rect/square/circle) uppdaterar förhandsvisningen omedelbart utan stale render.

