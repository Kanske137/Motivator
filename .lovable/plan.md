## Vad jag ser i koden

I `brollopskarta`-mallens layout **Karta & Foto** ser fotolagret ut så här:

```
photo  xPct=5  yPct=6  wPct=90  hPct=34
defaults: { fit: "cover", shape: "rect" }
locks: { move:true, position:true, content:false, ... }
```

Layoutytan är bred (90%) och låg (34%). När man laddar upp en porträttbild (524×744) blir cover-skalningen drivs av bredden → bilden får stor överhöjd → `maxY` borde bli ~90 % och vertikal pan borde fungera.

Det gör den inte. Två konkreta misstänkta orsaker finns redan i koden:

1. **`updatePhoto` returnerar tyst** om `state.layerValues[id]` inte är ett `photo`-värde — så alla `setLayerPhotoOffset` blir no-ops om värdet inte hann hydreras för den nya layouten (`editorStore.ts:1303–1310`).
2. **Layout-byte slänger fotopan** — i `setLayoutId` är överlevnaden av `offsetX/offsetY` gated på `!locks.move` (`editorStore.ts:847`). I `karta-och-foto` är `locks.move = true`, så kund-pan resetas till 0 vid varje layout-byte. Semantiskt fel: `move` styr själva lagerflytt-handtaget, inte pan av bilden inuti lagret.

Det finns också en tredje möjlighet jag inte kan utesluta utan att se runtime-värdena: att `box.h` mäts som 0 för fotolagret i just denna layout (t.ex. om `effectiveLayerRect` påverkas av margin-insets), vilket också skulle ge `maxY = 0` och därmed tyst blockerad pan.

## Plan

1. **Lägg till lättviktiga diagnos-loggar** i `PhotoLayerView` (`MapPreview.tsx`):
   - Logga `{ layerId, src, fit, draggable, box, natural, maxX, maxY, canPan, offsetX, offsetY }` när värdena ändras.
   - Logga vid `onPointerDown` om handlern returnerar tidigt (varför: `!draggable`, `fit==="contain"`, eller `maxX===0 && maxY===0`).
   - Detta gör det möjligt att i nästa loop (med console-logs) direkt avgöra om problemet är mätning, store-skrivning eller pointer-blockering.

2. **Fixa store-svälja**: i `updatePhoto` (`editorStore.ts`):
   - Om `cur` saknas eller har fel kind, hydrera ett tomt `photo`-värde i stället för att returnera tyst. Annars förlorar vi alla offset-uppdateringar i racet mellan layout-byte → upload → första drag.

3. **Fixa layout-byte-carryover**: i `setLayoutId` (`editorStore.ts:842–848`):
   - Bär över `offsetX/offsetY` så länge fotolagret faktiskt är pan-bart (`fit === "cover"`), oavsett `locks.move`. `move` ska bara styra lagerflytt-handtaget, inte foto-pan.
   - Bär även över `photoSources[layerId]` / `photoAiResults[layerId]` när motsvarande nya lager finns — annars försvinner den uppladdade bilden vid layout-byte.

4. **Förtydliga semantik i admin** (liten justering, ingen funktionsändring):
   - I `LayerInspector` (eller motsvarande) för `photo`-lager: ändra tooltip/hjälptext för `move`-låset till "Lås lagerflytt (kundens fyrkant-handtag)" så det inte blandas ihop med pan inuti bilden. Pan styrs av `fit: cover` + att en uppladdad bild är större än ytan, inget separat lås.

5. **Validering** (i build-läget, efter koden är ändrad):
   - Öppna `/editor?handle=brollopskarta`, växla till **Karta & Foto**, ladda upp den bifogade porträttbilden.
   - Bekräfta i console-loggarna att `maxY > 0` och att pointer-down inte bailar ut.
   - Dra bilden i höjdled och bekräfta att `offsetY` uppdateras + att bilden faktiskt rör sig.
   - Byt layout fram och tillbaka och bekräfta att den uppladdade bilden + dess pan-offset överlever.
   - Snabbtest på `husposter` (annan layout med fotolager) för att verifiera att fixen inte är mall-specifik.
   - När orsaken är bekräftad: ta bort/lämna kvar diagnos-loggarna bakom en `if (import.meta.env.DEV)`-flagga så de inte spammar i produktion.

## Tekniska detaljer

- Filer som kommer att ändras:
  - `src/components/editor/MapPreview.tsx` — diagnos-loggar i `PhotoLayerView`.
  - `src/stores/editorStore.ts` — `updatePhoto` no-op-fix + `setLayoutId` carryover-gating.
  - Ev. `src/components/admin/LayerInspector.tsx` — tooltiptext för `move`-låset på `photo`.
- Inga DB-migrationer.
- Inga ändringar i print-pipeline eller mockup-composite — den läser `offsetX/offsetY` från samma store och kommer automatiskt få rätt värden när pan fungerar.

## Svar på din andra fråga

Det är troligen mall-specifikt just nu: layouten **Karta & Foto** har `locks.move = true` på fotolagret, vilket triggar carryover-buggen ovan. Mallar där fotolagret har `locks.move = false` (eller där man aldrig byter layout efter upload) påverkas inte på samma sätt — men `updatePhoto`-no-op:en är generell och kan slå överallt under race conditions, så vi fixar båda.
