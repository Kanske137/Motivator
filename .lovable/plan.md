## Problem
När du klickar på en linje förlängs den varje gång med en tjocklek extra. Linjer på höger/nedre kanten slutar därför aldrig snappa korrekt — de växer istället för varje klick.

## Rotorsak
`extendLineToMeetCorners` (i `src/lib/layer-utils.ts`) använder samma tolerans som snap (`EDGE_SNAP_TOLERANCE_PCT = 2%`) för att avgöra "ändpunkten möter en perpendikulär linje". Efter en förlängning hamnar änden vid en NY position som fortfarande ligger inom 2% från samma kandidat-kant — så vid nästa klick triggar villkoret igen och linjen växer en tjocklek till.

Extra tydligt för tunnare linjer: när `pThick < 2%` så uppfyller `myRight = p.xPct + pThick` fortfarande `|myRight − p.xPct| ≤ 2%`, så förlängningen loopar.

Click-handlern i `LayerCanvas.tsx` kör både `snapLineToOtherLines` OCH `extendLineToMeetCorners` vid varje klick (för att fixa gamla mallar) — det exponerar buggen tydligt eftersom du bara klickar utan att flytta.

## Fix

### 1. `src/lib/layer-utils.ts` — `extendLineToMeetCorners`
- Inför separat, mycket strängare tolerans (`EXTEND_TOLERANCE_PCT = 0.3`) istället för 2%. Snap-steget har redan placerat ändarna exakt vid kanten, så extend behöver bara hantera mikrodrift från floats.
- Lägg till skydd: extend triggas bara om änden INTE redan ligger inuti perpendikulärs kropp (dvs mellan `p.xPct + EXTEND_TOLERANCE` och `pRight − EXTEND_TOLERANCE`). Förhindrar att en redan-förlängd linje förlängs igen.

### 2. `src/components/admin/LayerCanvas.tsx` — onClick-handler för linjer
- Behåll snap-on-click (för att fixa gamla mallars drift) men kör INTE `extendLineToMeetCorners` vid bara klick. Extend ska endast köras vid drag/resize-stop, då användaren aktivt placerat linjen.
- Detta gör beteendet idempotent oavsett hur många klick man gör.

## Resultat
- Klicka på en linje = snappar mot grannar men växer ALDRIG.
- Drag/släpp mot perpendikulär linje = hörnet fylls precis en gång.
- Gamla mallar fixas fortfarande vid första klick via snap, utan oändlig tillväxt.

## Filer som ändras
- `src/lib/layer-utils.ts`
- `src/components/admin/LayerCanvas.tsx`