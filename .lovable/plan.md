## Problemet jag ser

Du har rätt: karta-pan och foto-pan använder helt olika teknik.

- **Kartan fungerar** eftersom Mapbox sköter drag direkt i sin egen canvas och skriver tillbaka till app-state först efter `moveend`.
- **Fotot fungerar inte stabilt** eftersom draget skriver `setLayerPhotoOffset(...)` på varje `pointermove`, vilket triggar React/store-uppdateringar, mockup/preview-omrenderingar och ny layoutmätning medan fingret/musen fortfarande drar.
- I tidigare kod fanns dessutom en viktig skyddsmekanism: låsta/icke-interaktiva lager fick `pointerEvents: none`, så de inte kunde ligga ovanpå och stjäla drag från fotot. Den spärren är borta i nuvarande fil.

## Plan

1. **Återställ pointer-event-skyddet runt lager**
   - I `MapPreview.tsx` ska bara verkligt interaktiva lager få fånga pointer events:
     - `photo` / `aiPhoto` när de har bild och får pannas
     - `map` när position inte är låst
     - move-handle om lagerflytt är upplåst
   - Låsta text-, bild-, dekor-, marginal- och form-lager ska inte kunna blockera foto-pan.

2. **Gör foto-pan imperativ under själva draget, som kartan**
   - Vid `pointerdown`: mät box + bild, starta drag och stoppa propagation.
   - Under `pointermove`: uppdatera endast bildens DOM-position direkt via `style.transform/left/top`, utan att skriva till Zustand/store varje pixel.
   - Vid `pointerup`: skriv slutlig `offsetX/offsetY` till store en gång.
   - Detta ska stoppa att mockup-galleriet/förhandsgranskningsbilder laddas om mitt i draget.

3. **Behåll exakt samma datamodell och print-output**
   - `offsetX/offsetY` fortsätter lagras som procent av fotolagret.
   - `template-snapshot.ts`, cart, Gelato/print och admin-designern lämnas orörda om ingen faktisk mismatch hittas.

4. **Lägg in tillfälliga diagnostik-loggar endast om första fixen inte kan verifieras direkt**
   - Logga `pointerdown`, `maxX/maxY`, aktivt lager och slut-offset.
   - Ta bort loggarna när orsaken är bekräftad.

5. **Verifiering i preview**
   - Öppna `/editor?handle=personlig-fototavla&type=poster`.
   - Ladda/testa med ett foto i annan aspekt än fotolagret.
   - Dra i fotot och kontrollera att bilden faktiskt rör sig utan att mockup-previewn laddar om under själva draget.
   - Kontrollera att karta-pan fortfarande fungerar på `/editor?handle=brollopskarta&type=poster`.

## Filer att ändra

- `src/components/editor/MapPreview.tsx` — huvudfixen.

## Avgränsning

Jag ändrar inte admin-designern, textlagerlogik, kartlogik, uploadflöde, AI, mockups, priser eller print/cart-pipeline.