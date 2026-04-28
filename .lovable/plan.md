# Fix: aiPhoto-layern visas inte och saknar kund-UI

## Problem
1. **Kund-canvas är tom där aiPhoto-layern ligger.** `MapPreview.tsx` har inget `if (l.type === "aiPhoto")`-fall, så layern hoppas över helt. Adminens referensbild ignoreras.
2. **Det finns ingen "Bild"-flik för face-swap.** `ControlPanel.tsx` filtrerar bara på `type === "photo"`. Eftersom mallen nu använder `aiPhoto` istället för `photo` syns ingen sektion.
3. **Tryckfilen** kommer också bli tom — `template-snapshot.ts` saknar samma fall.

## Lösning

### 1. Visa referensbilden + face-swap-resultatet i kundens canvas
Lägg till `if (l.type === "aiPhoto")`-fall i `MapPreview.tsx` direkt efter `photo`-fallet. Återanvänd den befintliga `PhotoLayerView` (samma form/clipping/fit). Bildkällan väljs så här:
- Om vi har ett face-swap-resultat (`aiPhotoResults[layer.id]`) → visa det
- Annars → visa `layer.defaults.referenceImageUrl`
- Annars → visa platsmarkör ("Ladda upp en bild …")

### 2. Lägg till kund-UI i `ControlPanel.tsx`
Ny accordion-sektion "Bild" (eller "Din bild") som visas när `templateLayers` innehåller minst en `aiPhoto`-layer:
- Per `aiPhoto`-layer:
  - Liten thumbnail av admin-referensbilden (för att kunden ser vad face-swappen utgår från)
  - Upload-knapp för kundens egen bild (selfie / husdjursbild) — återanvänder upload-mönstret från `PhotoUploadSection`
  - "Byt bild" / "Ta bort"
  - Knapp **"Skapa AI-bild"** som triggar `replicate-face-swap`
  - Spinner medan jobbet kör
  - Tunn instruktionstext anpassad efter `subjectKind` ("Bilden ska visa ansiktet på personen/katten/hunden tydligt")

Sektionen visas oavsett om mallen också har en vanlig `photo`-layer. När bara `aiPhoto` finns ska gamla "Bild"-sektionen + AI-stilar inte visas (de hör inte ihop med face-swap).

### 3. Store-stöd
I `editorStore.ts`:
- Ny `aiPhotoSources: Record<layerId, { file: File; previewUrl: string; hash: string | null }>` — kundens uppladdade bilder per aiPhoto-layer.
- Ny `aiPhotoResults: Record<layerId, string>` — resulterande swap-URL per layer.
- Persistent cache i localStorage (samma stil som AI-style-cachen, ny `STORAGE_KEY = "lovable.face-swap-cache.v1"`), keyat på `${faceHash}|${referenceImageUrl}|${layerId}` så att samma selfie + samma referens inte triggar nytt Replicate-anrop.
- Setters: `setAiPhotoSource(layerId, file, previewUrl)`, `setAiPhotoHash(layerId, hash)`, `setAiPhotoResult(layerId, url)`, `clearAiPhoto(layerId)`.
- Hydrering: `hydrateLayerValues` får ett aiPhoto-fall för konsekvens (offsetX/Y, shape) — viktigt så att panorering fungerar precis som för `photo`.

### 4. Edge function-anrop (frontend)
Ny komponent `AiPhotoSection.tsx` (eller subkomponent i ControlPanel) som:
1. Tar emot layer + admin-defaults
2. Vid uppladdning: skapar blob-URL + räknar SHA-256
3. Vid "Skapa AI-bild": laddar först upp selfie till `cart-previews` (samma `uploadCartPreview` som AI-styles), kollar cachen, annars `supabase.functions.invoke("replicate-face-swap", { body: { referenceImageUrl, faceImageUrl, prompt, subjectKind, designId }})`
4. Lagrar resultatet i store + cache
5. Visar toasts vid fel

### 5. Print-snapshot
I `template-snapshot.ts`:
- Lägg till aiPhoto-rendering (återanvänd `drawPhotoLayer`)
- Källa = swap-resultat → referensbild → tom (skip)
- I `EditorPage.tsx` skicka med `aiPhotoResults` i `baseTemplateInput` så att snapshot kan komma åt det. Enklast: tillåt store-läsning direkt i renderaren via en ny prop `aiPhotoResults?: Record<string, string>`.

### 6. Pris/cart
Inga ändringar i pris-flödet. Cart-preview funkar tack vare snapshot-fixen.

## Filer
- ny: `src/components/editor/AiPhotoSection.tsx`
- ny: `src/lib/face-swap-cache.ts` (analog med `ai-cache-storage.ts`)
- redigera: `src/stores/editorStore.ts` (hydrering, setters, cache)
- redigera: `src/components/editor/MapPreview.tsx` (rendera aiPhoto)
- redigera: `src/components/editor/ControlPanel.tsx` (ny sektion + dölj photo/AI när bara aiPhoto)
- redigera: `src/lib/template-snapshot.ts` (rendera aiPhoto)
- redigera: `src/pages/EditorPage.tsx` (skicka aiPhotoResults till snapshot)

## Verifiering
1. På `/admin/designer/...`: referensbilden ligger kvar (redan fixat).
2. På kundeditorn: referensbilden syns i layern.
3. Ny "Bild"-sektion visas. Ladda upp en hund-bild → klicka "Skapa AI-bild" → Replicate kör → swap-resultat visas i layern.
4. Återgå-knapp tar bort swappen, referensbilden visas igen.
5. Klicka "Skapa AI-bild" igen med samma bild → cache-träff (instant).
6. Lägg i varukorg → tryckfil-thumbnail innehåller swap-resultatet.
