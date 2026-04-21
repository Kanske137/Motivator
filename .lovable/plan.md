

## Plan: Wrap-zonen visar bakgrundsfärg istället för karta + uppdaterad label

### Ändringar

**1. `src/components/editor/MapPreview.tsx`**
- Ändra `mapWrapperStyle` så att kartan i canvas-läge (`wrapCm > 0`) endast renderas inom **front-zonen**, inte hela editorytan. Wrap-zonen runt om får då naturligt `posterBgColor` (från `frameStyle.background`).
- Konkret: när `isWrap` är true, byt `mapWrapperStyle` från `inset: 0` till samma `frontZoneStyle` (left/top/right/bottom = frontInset%). Shape-clip (cirkel/kvadrat) appliceras fortfarande inom front-zonen som idag.
- Uppdatera labeln på front-indikatorn från `"Synlig framsida · kanterna wrappas"` till `"Synlig framsida · innehållet här viks om på sidorna"`.

**2. `src/lib/editor-snapshot.ts`**
- I wrap-grenen (`extraCm > 0`): rita inte längre kartan över hela `w × h`. Istället:
  1. Fyll hela ytan med `posterBgColor` (redan gjort).
  2. Rita kartan **endast** inom front-zonen (`frontPxX, frontPxY, frontPxW, frontPxH`), med samma shape-clip-logik som poster-läget (rect/square/circle).
  3. Wrap- och bleed-zonerna förblir bakgrundsfärg → 3D-vyns sidor visar bakgrundsfärg, exakt som editorn.
- Ta bort `evenodd`-clip-inverten (behövs inte längre eftersom kartan aldrig ritas i wrap-zonen).
- Text-overlay oförändrad (renderas inom front-zonen).

### Förväntat resultat
- Editorn visar kartan endast inom den streckade front-ramen; runt om syns bakgrundsfärgen.
- Labeln säger "Synlig framsida · innehållet här viks om på sidorna".
- 3D-canvas-mockupens sidor visar bakgrundsfärgen istället för fortsatt karta — 100 % matchning mellan editor, snapshot och 3D-vy.
- Poster-flödet helt orört.

### Filer som ändras
- `src/components/editor/MapPreview.tsx`
- `src/lib/editor-snapshot.ts`

