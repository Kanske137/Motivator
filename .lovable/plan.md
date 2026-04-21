

## Plan: Respektera mapShape (cirkel/kvadrat) på canvas-fronten i 3D-förhandsvisningen

### Diagnos
I `src/lib/editor-snapshot.ts` när `extraCm > 0` (canvas-läge med wrap+bleed) ritas kartan ut över hela print-arean som en rektangel — `mapShape` ignoreras helt. Kommentaren i koden säger uttryckligen "for canvas we always use rect shape". Det stämmer inte: editorns front kan vara cirkel eller kvadrat även för canvas, och 3D-vyns front-UV samplar exakt den front-zonen → kunden ser hela den fyllda rektangeln på 3D-canvasen även när cirkel är vald.

Wrap-zonen runt fronten ska däremot fortfarande visa kartan i sin helhet (eftersom kanten på canvasen wrappas runt och visar bakgrunden + kartan som fortsätter utanför formen — i praktiken: bakgrundsfärgen syns på sidorna utanför formen, kartan syns där den når ut i wrap-zonen).

### Fix

I `src/lib/editor-snapshot.ts`, ersätt nuvarande `if (extraCm > 0) { ... }`-gren så att:

1. **Wrap-zonen** (utanför front-rektangeln): rita kartan som rektangel över hela `w × h` — wrap fortsätter alltid kartan oavsett form, eftersom det är bakgrundens fortsättning som wrappas runt sidan.

2. **Front-zonen** (inre `frontPxX/Y/W/H`): applicera samma shape-clip som poster-läget:
   - `rect` → rita kartan i hela front-rektangeln.
   - `square` → klipp till en centrerad kvadrat (sida = min(frontW, frontH)) och rita kartan i den; resten av front-zonen får bakgrundsfärgen.
   - `circle` → klipp till en centrerad cirkel (radie = min(frontW, frontH)/2) och rita kartan i den; resten av front-zonen får bakgrundsfärgen.

3. Innan front-zonen ritas: fyll front-rektangeln med `posterBgColor` så att områden utanför cirkel/kvadrat får rätt bakgrund (inte kartan som redan ritades för wrap-zonen).

Konceptuellt:
```
1. fyll hela w×h med bgColor
2. rita karta över hela w×h  (wrap-fortsättning)
3. fyll front-rektangeln (frontPxX,Y,W,H) med bgColor (skriver över kartan i front)
4. clip(shape inom front-zonen) → rita kartan igen, men endast inom shape-clippet
5. text-overlay (oförändrad)
```

### Filer som ändras
- `src/lib/editor-snapshot.ts` — uppdatera wrap-grenen (rad ~170–197) enligt ovan så `mapShape` respekteras inom front-zonen även för canvas. Inga ändringar i `Canvas3DPreview` eller `MockupGallery` behövs — UV-samplingen är redan korrekt och kommer automatiskt att visa cirkeln/kvadraten på fronten så fort snapshoten innehåller den.

### Förväntat resultat
- Väljer kunden cirkel på canvas → 3D-vyns front visar kartan i cirkel mot bakgrundsfärg, exakt som editorn. Wrap-zonen runt sidorna visar bakgrundsfärg + ev. kartan där den sträcker sig utanför formen — fortfarande sömlöst.
- Kvadrat fungerar på samma sätt.
- Rektangel (default) oförändrad.
- Poster-flödet helt opåverkat.

