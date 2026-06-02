## Mål
Fixa fotopan i kundens editor (`/editor`) så att uppladdade foton går att dra/panna inuti fotolagret när bilden beskärs av `cover`, utan att påverka admin, kartor, textlager, uppladdning, AI-flöde, priser eller print/cart-pipeline.

## Rotorsak jag vill åtgärda
Nuvarande implementation väntar på att `naturalWidth/naturalHeight` + container-mått ska ge `maxX/maxY > 0`. Om dessa bounds blir `0`, om bilden först renderas via `object-cover`, eller om drag startar innan måtten är stabila, startas inget pan-drag alls. Det matchar symptomet: preview reagerar/uppdateras, men bilden står still.

## Plan
1. **Gör fotopan oberoende av förhandsberäknade bounds vid pointer-down**
   - Starta drag för uppladdade foton i `cover`-läge även om `maxX/maxY` ännu är `0`.
   - Mät container och bild direkt i drag-start och/eller använd en säker fallback från den renderade bilden.
   - Behåll regeln att axlar utan faktisk crop låses, men låt inte ett temporärt `0` blockera hela draget.

2. **Flytta pan-matematiken till en liten, testbar helper**
   - Skapa/uppdatera minimal helper som räknar cover-renderstorlek, overflow och clamp från:
     - layer-boxens pixelstorlek
     - bildens natural size
     - offset i procent
   - Använd samma helper i `PhotoLayerView` och snapshot-rendering om befintlig snapshot-matematik behöver matchas.
   - Ingen ändring i hur `offsetX/offsetY` lagras: procent av fotolagrets storlek.

3. **Säkra event-hanteringen**
   - Behåll `preventDefault()` och `stopPropagation()` på fotodrag.
   - Använd `window`-baserade `pointermove/pointerup/pointercancel` med pointer-id och cleanup vid unmount/blur.
   - Lägg `touch-action: none` när fotot är dragbart så mobil/iframe-scroll inte tar över.

4. **Ta bort “nollställande” under aktiv dragning**
   - Re-clamp-effekten ska inte skriva tillbaka `0,0` medan användaren drar om bounds tillfälligt rapporteras som `0`.
   - Clamp ska ske när bild och container faktiskt är mätta, och per axel.

5. **Verifiera snävt**
   - Bred bild i stående fotolager: horisontell pan fungerar.
   - Stående bild i brett fotolager: vertikal pan fungerar.
   - Bild med samma aspekt: ingen falsk pan/inga tomma ytor.
   - Kontrollera att preview använder lagrat `offsetX/offsetY` och att foton inte laddas om i loop under drag.

## Filer som berörs
- `src/components/editor/MapPreview.tsx` — huvudfix för kundens fotopan.
- Eventuellt en liten helper i `src/lib/...` om det behövs för att undvika duplicerad matte.
- Eventuellt `src/lib/template-snapshot.ts` endast om jag hittar faktisk mismatch i snapshot-matematiken.

## Avgränsning
Jag kommer inte ändra admin-designern, ramrendering, textlager, kartlager, AI-generering, Shopify/Gelato-flöde eller språk/valuta.