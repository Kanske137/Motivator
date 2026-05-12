## Problem

`aiPhotoResults[layerId]` lagrar bara *ett* swap-resultat per lager. När kunden växlar referensbild via "Välj motiv" uppdateras `aiPhotoSelectedRefUrl`, men `aiPhotoResults` ligger kvar — så `MapPreview` fortsätter visa det gamla face-swap-resultatet (eftersom `aiResultUrl ?? selectedRefUrl ?? defaultRef`). Cache finns redan per `refSlot` i `face-swap-cache` men läses bara när användaren klickar "Skapa".

## Fix (endast frontend i `AiPhotoSection.tsx`)

Lägg till en `useEffect` som triggar när `selectedRef?.url` ändras (och inte i `removeBackground`-läge):

1. Om `source?.hash` finns:
   - Slå upp `getCachedFaceSwap(layer.id, source.hash, refSlotFor(subjectKind, refUrl, null))`.
   - Om träff → `setAiPhotoResult(layer.id, cachedUrl)` (visas direkt i editorn, inga AI-anrop).
   - Om miss → `setAiPhotoResult(layer.id, "")` via en liten "clear"-väg, eller bättre: lägg till en setter `clearAiPhotoResult(layerId)` i `editorStore` som tar bort nyckeln ur `aiPhotoResults`. Då faller `MapPreview` tillbaka på `selectedRefUrl` (det nya motivet).
2. Om `source?.hash` inte finns (kund har inte laddat upp ansikte än) → ingen åtgärd; `aiPhotoResults` är ändå tomt.

`runSwap` cachar redan per `refSlot`, så att växla tillbaka till ett tidigare motiv hittar träff direkt — inga onödiga Replicate-anrop.

## Filer
- `src/stores/editorStore.ts`: lägg till `clearAiPhotoResult(layerId: string)` (tar bort nyckeln ur `aiPhotoResults`).
- `src/components/editor/AiPhotoSection.tsx`: ny `useEffect` på `[selectedRef?.url, source?.hash, subjectKind]` som synkar `aiPhotoResults[layer.id]` mot cache enligt ovan.

## Det som inte ändras
- `MapPreview.tsx`, swap-edge-funktion, schema, snapshot/print-pipeline, admin-UI, andra lagertyper, removeBackground-flödet.