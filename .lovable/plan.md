

## Plan: Editorns yta = hela print-filen för canvas (front + wrap synligt i editorn)

### Korrekt mental modell (din)
- **Poster**: editorns yta = beställd storlek = print-fil. Oförändrat.
- **Canvas**: editorns yta = beställd storlek + wrap på alla sidor. Det användaren komponerar i editorn är **hela** den tryckta ytan. När canvasen tillverkas wrappas yttre djup-cm runt ramen och hamnar på sidorna; det som syns på framsidan är den **inre** rektangeln (= beställd storlek).

### Vad som är fel idag
- Editorn renderar med poster-aspect (`W × H`) även för canvas → användaren komponerar bara fronten, och min snapshot-kod försöker "uppfinna" wrap-pixlar genom att sträcka kartan utanför editorns yta. Det blir fel eftersom (a) ingenting säger användaren att kanterna försvinner, och (b) text/motiv kan hamna i fel zon.

### Fix

#### 1. `src/components/editor/MapPreview.tsx` — utöka editorns aspect för canvas
- Lägg till props `wrapCm?: number` (default 0) och `bleedCm?: number` (default 0, används bara visuellt — bleed visas EJ i editorn, bara wrap).
- Beräkna `editorWcm = W + 2·wrapCm`, `editorHcm = H + 2·wrapCm` och bygg `posterAspect` från dessa istället för `sizeCm` direkt när `wrapCm > 0`.
- Beräkna `frontInsetPct = wrapCm / editorWcm` (X) och `wrapCm / editorHcm` (Y).
- Lägg till en **visuell front-indikator** ovanpå editorn: streckad ram (`border-dashed border-2 border-foreground/30`) som ramar in den inre front-rektangeln med liten label "Synlig framsida" så användaren förstår att kanterna wrappas. Stilen: absolut positionerad, `inset: frontInsetPct·100%`.
- **Text-layout**: text-layern måste placeras inom front-zonen, inte hela editorn. Wrappa `left/top`-beräkningen så `l.x` (procent från layout-config) tolkas relativt front-zonen: `left = frontInsetX + l.x · (1 - 2·frontInsetX)`.
- **Map-shape (cirkel/kvadrat)** ska fortsätta att gälla **endast inom front-zonen**. För canvas: rita kartan som rektangel över hela editorytan (wrap-kontinuitet) PLUS clip-overlay som visar formen inom front-zonen (rita bg-färg utanför formen i front-zonen, men låt wrap-zonen behålla kartan). Implementeras som en extra absolut-positionerad mask-div.

#### 2. `src/pages/EditorPage.tsx` — skicka wrap-info till MapPreview
- Beräkna `canvasDepthCm` från `variant` (samma logik som i `MockupGallery`).
- Skicka `wrapCm={isCanvas ? canvasDepthCm : 0}` till `<MapPreview />`.

#### 3. `src/lib/editor-snapshot.ts` — förenkla för canvas
- Editorns yta motsvarar nu `W + 2·wrapCm` (front + wrap). Snapshoten ska producera en print-fil som är `(W + 2·wrapCm + 2·bleedCm) × (H + 2·wrapCm + 2·bleedCm)`.
- Layout:
  - Inre `W × H` (centrerad, offset `wrapCm + bleedCm`) = front (med shape-clip + text + bg).
  - Wrap-strippar `wrapCm` runt om (offset `bleedCm` från ytterkant) = kartan fortsätter rakt utanför front-zonen som rektangel (ingen shape-clip). Bg-färgen fyller områdena i front-zonen som faller utanför ev. cirkel/kvadrat-clip — wrap-zonen är ALLTID rektangulär karta, så hörnen blir naturligt fyllda.
  - Yttersta `bleedCm` = samma karta fortsätter (eller bg-färg) — får aldrig synas på den färdiga produkten.
- Ta bort min tidigare "fyll allt med karta + clip front igen"-logik. Ny ordning:
  1. Fyll hela canvas med `bgColor`.
  2. Rita kartan som rektangel över hela `(W + 2·wrap + 2·bleed)` ytan → ger naturlig wrap- och bleed-kontinuitet.
  3. Om `mapShape !== "rect"`: i front-zonen, fyll bg utanför formen (clip-invert: rita bg-färg som heltäckande rektangel i front-zonen, men hoppa över formen). Wrap-zonen rörs ej.
  4. Rita text inom front-zonen (oförändrad logik mot front-koordinater).

#### 4. `src/components/editor/Canvas3DPreview.tsx` — UV-koordinater oförändrade
- Logiken är redan korrekt mot texturlayouten `[bleed | wrap | FRONT | wrap | bleed]`. Inga ändringar behövs så länge snapshoten håller samma layout.

#### 5. `src/components/editor/MockupGallery.tsx` — oförändrad
- Skickar redan `wrapCm` + `bleedCm` korrekt till snapshot och 3D.

### Filer som ändras
- `src/components/editor/MapPreview.tsx` — ny `wrapCm`-prop, utökad aspect, front-indikator (streckad ram), text- och shape-positionering inom front-zonen.
- `src/pages/EditorPage.tsx` — beräkna och skicka `wrapCm` till `MapPreview`.
- `src/lib/editor-snapshot.ts` — förenkla canvas-grenen så snapshoten matchar editorns nya layout exakt.

### Förväntat resultat
- På canvas-flödet ser användaren i editorn **hela print-arean** med en streckad ram som markerar "synlig framsida". Allt utanför ramen kommer wrappas runt sidorna.
- Det användaren ser som "framsida" i editorn = exakt vad 3D-vyn visar som framsida.
- Sidorna i 3D-vyn = exakt det användaren placerade i wrap-zonen i editorn (sömlös fortsättning, inga uppfunna pixlar).
- Poster-flödet helt orört.

