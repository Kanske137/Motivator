# Multi Face-Swap: stöd flera referensbilder (kund kan välja)

## Problem
`MultiFaceUploadSection` använder hårdkodat `referenceImages[0]?.url` (eller legacy `referenceImageUrl`). Admin kan i inspektorn lägga in flera referensbilder per `aiPhoto`-lager (samma `defaults.referenceImages[]` som vanlig face-swap), men kunden får inget val — multi-face kör alltid på den första.

Vanlig `AiPhotoSection` har redan en picker som:
1. Filtrerar `referenceImages` efter aktuell `orientation` ("portrait" / "landscape" / "any").
2. Visar grid när ≥2 alternativ finns, kallar `setAiPhotoSelectedRef(layerId, url)`.
3. Läser `aiPhotoSelectedRefUrl[layerId]` från store, faller tillbaka på första.

## Lösning — strikt additivt, endast `MultiFaceUploadSection.tsx`

Återanvänd exakt samma logik och samma store-fält (`aiPhotoSelectedRefUrl`, `setAiPhotoSelectedRef`) så att valet är konsistent om kunden skulle växla mellan multi-face och vanlig face-swap (även om bara ett av lägena är aktivt åt gången per lager).

### Ändringar i `src/components/editor/MultiFaceUploadSection.tsx`

1. **Resolva referensbilder** identiskt med `AiPhotoSection` (rad 93–110 där):
   - Bygg `allReferenceImages` från `layer.defaults.referenceImages` med fallback till legacy `referenceImageUrl`.
   - Filtrera efter `useEditorStore(s => s.orientation)` på `r.orientation` ("any" | matchande).
2. **Selektion**: läs `aiPhotoSelectedRefUrl[layer.id]` från store, fall tillbaka på `referenceImages[0]`. `refUrl` = vald url.
3. **Heal-effect**: om `stored` saknas eller inte längre finns i listan (orientation-byte), kalla `setAiPhotoSelectedRef(layer.id, referenceImages[0].url)`.
4. **Picker-UI**: rendera samma grid som `AiPhotoSection` (rad 367–396) när `referenceImages.length >= 2`. Rubrik via befintlig nyckel `t("aiPhoto.chooseSubject")` — inga nya i18n-nycklar.
5. **Cache-nyckel**: `makeMultiFaceKey(layer.id, refUrl, hashEntries)` — redan `refUrl`-beroende, så byte av referens → ny cache-bucket utan ändringar i `multi-face-cache.ts`.
6. **Skapa-igen vid byte av referens**: vid orientation- eller refUrl-byte, om `aiPhotoResults[layer.id]` finns men ingen cache för nya (refUrl, hashes) — rensa via `setAiPhotoResult(layer.id, null)` (samma mönster som `AiPhotoSection` rad 134-ff). Om cache finns → återanvänd direkt.

### Edge function
**Ingen ändring.** `multi-face-swap` får redan `referenceImageUrl` i bodyn — kommer nu få den valda istället för alltid den första.

### Schema / store / admin / övriga komponenter
**Helt orörda.** `referenceImages[]` på `aiPhoto.defaults` finns redan, admin-UI för att lägga till flera är redan på plats, store-actions `setAiPhotoSelectedRef` finns redan, vanlig `AiPhotoSection` fungerar identiskt.

## Acceptanskrav
1. Mall med multi-face aktiverat och **1** referensbild: ingen picker, beter sig som idag.
2. Mall med multi-face aktiverat och **≥2** referensbilder (orientation-filtrerat): kunden ser samma picker-grid som vanlig face-swap. Byte av referens → om cache finns visas resultatet direkt, annars rensas resultatet och "Skapa" kör nytt anrop mot vald referens.
3. Vanlig (single-face) `AiPhotoSection` oförändrad.
4. Inga ändringar i edge function, schema, store, admin-inspector, cache-lib eller i18n.
