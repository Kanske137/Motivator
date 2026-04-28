## Problem

När AI-bilden (ta bort bakgrund) genereras har den samma aspect ratio som kundens uppladdade originalfoto (bred bil → bred bild). Men lagret i mallen kan ha annan aspect ratio (mer kvadratiskt eller stående). Eftersom `PhotoLayerView` renderar i "cover"-läge skärs bildens kanter bort så att den fyller lagret — vilket klipper av motivet (t.ex. bilens fram-/bakparti) trots att vi precis instruerat modellen att lämna whitespace runt motivet. Hela soft-fade-effekten på alla fyra kanter går förlorad.

## Viktig kontext

Vi använder **Nano Banana 2** (`google/gemini-3.1-flash-image-preview`) via Lovable AI Gateway för removeBackground — INTE ett dedikerat API där vi kan sätta exakt output-aspect som parameter. Modellen styrs enbart via prompttext, och respekterar inte alltid aspect-instruktioner perfekt. Därför är frontend-fallbacken (Steg 2 & 3) det egentliga skyddsnätet — prompten i Steg 1 är "best effort".

## Lösning

Tvådelad fix — be Nano Banana att leverera bild i lagrets aspect ratio (mjuk styrning), men **frontend renderar alltid i contain-läge för AI-resultat** så hela motivet syns även om modellen levererar fel aspect.

### Steg 1 — Skicka lagrets aspect ratio till edge-funktionen (best effort)

I `src/components/editor/AiPhotoSection.tsx` (där `replicate-face-swap` anropas i removeBackground-läget): inkludera lagrets aspect ratio i request-bodyn, t.ex. `targetAspectRatio: layer.box.w / layer.box.h` (komponenten har redan tillgång till layer-objektet).

I `supabase/functions/replicate-face-swap/index.ts`:
- Läs `targetAspectRatio` (number, valfri) från body i `Deno.serve`-handlern.
- Skicka vidare till `runRemoveBackground`.
- I prompten i `runRemoveBackground` (sista raden, rad 433): ersätt "Return ONE single edited image with the same aspect ratio as the input." med en variant som — när `targetAspectRatio` finns — instruerar Nano Banana att producera bild med ungefär den angivna aspect-ration (formatera som närmaste vanliga ratio, t.ex. "3:4", "4:5", "1:1", "16:9"), och att placera motivet centrerat med rikligt med vit padding så att inget av motivet skärs eller töms ut till någon kant. Behåll fade-instruktionerna.
- Justera sanity-checken på rad 529 (`ratio > 2.2 || ratio < 0.45`) så den inte avvisar legitima format som motsvarar lagrets aspect — utöka spannet eller hoppa över checken när `targetAspectRatio` är satt och utfallet ligger nära det målet.

Notera: Nano Banana 2 är ökänd för att inte alltid hålla en strikt aspect — så detta är "best effort"; det riktiga skyddsnätet är Steg 2 & 3.

### Steg 2 — Skyddsnätet: tvinga `contain` för AI-resultat i editor-previewen

I `src/components/editor/MapPreview.tsx` (raderna 384-397, där `aiPhoto`-lagret renderas via `PhotoLayerView`):
- När källbilden är ett `aiPhotoResults[l.id]`-värde (dvs. en genererad ta-bort-bakgrund-bild, inte adminens referens), tvinga `fit="contain"` istället för att använda `l.defaults.fit`.
- Detta säkerställer att även om Nano Banana mot förmodan returnerar fel aspect, så visas HELA bilden inom lagret med eventuell vit padding på sidorna — vilket smälter sömlöst in i lagrets bakgrund eftersom AI-bilden alltid har ren #FFFFFF.
- Adminens originalreferens (när inget face-swap-resultat finns ännu) får fortsatt använda `l.defaults.fit`.

### Steg 3 — Samma fix i tryckfilsgenereringen

I `src/lib/template-snapshot.ts` (raderna 604-615, aiPhoto-grenen): samma villkorliga override — när en `aiPhotoResults`-URL används, rendera med "contain"-beteende istället för layerns `fit`-default, så tryckfilen matchar editor-previewen exakt och hela motivet kommer med på affischen/canvasen.

## Filer som ändras

- `src/components/editor/AiPhotoSection.tsx` — skicka `targetAspectRatio` i edge-anropet
- `supabase/functions/replicate-face-swap/index.ts` — ta emot aspect, förstärk Nano Banana-prompten, justera sanity-check
- `src/components/editor/MapPreview.tsx` — tvinga contain för AI-resultat
- `src/lib/template-snapshot.ts` — tvinga contain för AI-resultat i tryckfilen

Inga schema- eller UI-ändringar utöver intern fit-logik.
