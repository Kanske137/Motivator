# Plan: Bevara AI-referenslager (aiPhoto) vid byte mellan stående/liggande

## Problem
När en kund jobbar i stående och har använt ett `aiPhoto`-lager i läget **Ta bort bakgrund** (genererat resultat sparat), och sedan byter orientering till liggande, försvinner bilden i den nya orienteringens behållare.

## Orsak
`aiPhotoSources` och `aiPhotoResults` i editorStore är keyade på lager-ID. Lager-ID skiljer sig mellan `template.layouts[productType].portrait.layers` och `…landscape.layers`. När `setConfig` byter layout-block görs en remapping via `buildLayerIdMap`, men i `setOrientation` (rad ~627–640 i `src/stores/editorStore.ts`) görs **ingen** sådan remap — `aiPhotoSources` och `aiPhotoResults` (samt `photoSources`/`photoAiResults`) lämnas oförändrade och pekar fortfarande på den gamla orienteringens lager-ID. Resultatet hittas inte längre via `aiPhotoResults[newId]` och bilden visas inte.

## Åtgärd (minimal, isolerad till editorStore)

Endast `setOrientation` i `src/stores/editorStore.ts` ändras. Övrig funktionalitet rörs inte.

1. Bygg en lager-ID-mappning mellan föregående och nästa orientering inom samma template + samma produkt-typ. Återanvänd parnings-logiken från `buildLayerIdMap` (parar lager av samma `type` index-för-index), men begränsad till de två orienteringarna i aktivt layout-block.
2. Använd den mappningen för att **remap:a** följande state-maps innan `set(...)`:
   - `aiPhotoSources`
   - `aiPhotoResults`
   - `photoSources`
   - `photoAiResults`
   - `layerTransforms` (idag nollställs den; behåll genom att remap:a istället så även vanliga foton flyttar med sin form/offset till motsvarande behållare i den nya orienteringen — samma princip som vid layoutblock-byte)
3. Skicka de remap:ade maparna in i `mirrorPhoto(...)` så legacy-mirrors (`photoFile`, `aiPrintFileUrl` m.m.) blir korrekta för den nya orienteringen.

Inget annat ändras: `MapPreview`, `AiPhotoSection`, `AiStyleSection`, snapshot- och print-pipeline läser fortfarande från samma maps via lager-ID, men nu med rätt nycklar för den nya orienteringen.

## Teknisk detalj — implementationsskiss

Inuti `setOrientation`:

```text
prevOrientation = state.orientation
prevLayers = activeLayoutBlock(template, productType)[prevOrientation].layers
nextLayers = activeLayoutBlock(template, productType)[orientation].layers

idMap = pairByTypeIndex(prevLayers, nextLayers)   // samma logik som buildLayerIdMap

remap(map) = Object.fromEntries(
  Object.entries(map).map(([oldId, v]) => [idMap[oldId] ?? oldId, v])
)

aiPhotoSources  = remap(state.aiPhotoSources)
aiPhotoResults  = remap(state.aiPhotoResults)
photoSources    = remap(state.photoSources)
photoAiResults  = remap(state.photoAiResults)
layerTransforms = remap(state.layerTransforms)
```

`buildLayerIdMap` kan brytas ut/återanvändas genom att lägga till en variant som tar två lagerlistor direkt (eller anropa befintlig och plocka ut just dessa två orienteringar).

## Vad det INTE påverkar
- `setConfig` (layoutblock-byte) — oförändrat.
- AI-genereringsflödet, cache, prompt-logik — oförändrat.
- Rendering, snapshot, print-pipeline — oförändrat.
- Lager utan motsvarande "partner" i nya orienteringen tappas (samma beteende som vid layoutblock-byte idag).

## Verifiering
1. Stående med `aiPhoto`-lager i Ta bort bakgrund-läge, generera resultat → byt till liggande → bilden ska visas i liggande behållaren.
2. Byt tillbaka till stående → samma bild kvar.
3. Vanliga `photo`-lager fortsätter fungera som förut vid orienteringsbyte.
4. Mall med två `aiPhoto`-lager: båda följer med korrekt parade till sina motsvarigheter.
