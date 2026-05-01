## Problem
På canvas-3D:n ser höger sida (från ditt perspektiv) ut att inte följa motivet i editorn — den verkar speglad jämfört med vänster sida och toppen/botten.

## Orsak
I `src/components/editor/Canvas3DPreview.tsx`, `CanvasMesh`-materialen, har höger sida (+X) `flipX = true`, medan vänster (-X), topp (+Y) och botten (-Y) inte flippas. Kommentaren resonerar fel om Three.js BoxGeometry's UV-orientering för +X-facet.

I praktiken: BoxGeometry +X-facet har U=0 vid bakkanten och U=1 vid framkanten (motsatt det som står i koden). Default-mappningen utan flip skulle då redan landa wrap-strippens "närmast-fronten"-pixelkolumn vid framkanten — precis som vänster sida fungerar. Det extra flippet vänder strippen och skapar den speglade effekten du ser.

Vänster, topp och botten ser korrekta ut just för att de använder default-mappning utan flip — så symmetriskt borde +X också göra det.

## Åtgärd
Endast en rad ändras i `src/components/editor/Canvas3DPreview.tsx`:

- I `right`-materialet (rad ~128-132): ta bort `flipX` (sätt `true` → `false`, eller släpp argumentet helt så det defaultar till `false`). Uppdatera kommentaren så den beskriver det faktiska beteendet.

Inget annat behöver ändras: front, vänster, topp, botten och bak förblir som de är. Print-filen (snapshot med wrap+bleed) påverkas inte. Editorn påverkas inte. Mockup-galleriets 2D-composit påverkas inte.

## Verifiering
Efter ändringen ska:
- Höger wrap-strip vara en direkt fortsättning av motivets högerkant (inte speglad).
- Pixlarna närmast framkanten matcha exakt mot frontens högerkant — sömlöst hörn precis som vänster sida redan är.
- Topp/botten/vänster fortsätta se identiska ut som idag.

Test: ladda en bild med tydlig text eller ansikte nära högerkanten i editorn, byt till canvas, rotera 3D:n åt höger och bekräfta att texten/ansiktet fortsätter naturligt runt kanten utan spegling.
