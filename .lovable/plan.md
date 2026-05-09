## Problem

När kunden i editorn växlar mellan en standardprodukt (poster/aluminium/akryl) och canvas i samma konsoliderade mall försvinner den uppladdade bilden / AI-bilden ur previewen — trots att bägge layouter har samma lagertyper.

## Rotorsak

`canvas` använder ett separat `canvasLayout`-block i mallen (separat från `defaultLayout`), eftersom canvas-wrap kräver egna positioner. Lagerträden är strukturellt lika, men varje lager har **egna ID:n**. I `setConfig` (src/stores/editorStore.ts):

1. `layerValues` re-hydratiseras från det nya layoutblocket → photo-lagrets state (shape, offsetX/Y) återgår till defaults under det nya ID:t.
2. `layerTransforms` nollas helt (`{}`).
3. `aiPhotoResults` är keyad på gamla layer-ID:n och blir därför "föräldralös" under det nya layoutblocket — AI-bilden visas inte.
4. `photoPreviewUrl`/`aiPrintFileUrl`/`designSource` bevaras redan, men eftersom photo-lagret renderas via `photoOverlayUrl` så syns originalbilden i photo-slots — *aiPhoto-lagret* (där AI-resultat bor) får dock inget src eftersom dess key inte längre matchar.

Resultat: photo-layer fungerar delvis (originalbild dyker upp), men AI-resultat och alla per-lager-justeringar (form, pan, custom rect) försvinner. Användaren upplever det som "bilden tas inte med".

## Lösning

Lägg till en migreringshjälp i `editorStore` som mappar gamla layer-ID:n till nya genom att para ihop lager i samma ordning per typ (samma `l.type`). Använd den i `setConfig` när `prevConfig` finns och layoutblocket faktiskt byts (poster→canvas eller tvärtom).

### Steg

1. **Ny helper** i `src/stores/editorStore.ts`:
   ```
   buildLayerIdMap(prevTemplate, prevProductType, nextTemplate, nextProductType, orientation)
     → Record<oldId, newId>
   ```
   - Hämta `getActiveLayoutBlock(...)[orientation].layers` för båda sidor.
   - Gruppera per `l.type` (`map`, `text`, `photo`, `aiPhoto`, `image`).
   - Para ihop index-för-index inom varje typgrupp.

2. **Uppdatera `setConfig`**:
   - Om föregående `state.config` och `state.template` finns → bygg `idMap` för både `portrait` och `landscape`.
   - I stället för att blint köra `hydrateLayerValues(...)` för det nya layoutblocket, börja med fresh defaults för nya layer-ID:n och **överskriv** med den gamla `state.layerValues[oldId]` när `idMap[oldId]` finns. Så bevaras photo/aiPhoto shape + offset, text-innehåll, kart-state, m.m.
   - Mappa om `state.layerTransforms` på samma sätt (`{ [idMap[oldId]]: value }`) i stället för `{}`.
   - Mappa om `state.aiPhotoResults` på samma sätt så AI-bilden återansluter till det nya aiPhoto-lagret.

3. **Behåll** befintligt beteende när `prevConfig` saknas (förstaladdning) eller när layoutblocket är samma referens (t.ex. byte mellan posters/aluminium/akryl som alla använder `defaultLayout`) — då finns ingen risk för ID-mismatch och `hydrateLayerValues` kan köras som idag.

4. **Bevarat**: `photoFile`, `photoPreviewUrl`, `photoHash`, `aiPrintFileUrl`, `designSource`, `aiPhotoFaceImages`, `aiResultCache` — rörs inte (redan bevarade idag).

### Filer som ändras

- `src/stores/editorStore.ts` — ny `buildLayerIdMap` + uppdaterad `setConfig`-logik.

Inga ändringar i UI-komponenter, mall-schema eller DB.

### Förväntat resultat

Byter kunden från poster → canvas (eller omvänt) följer både uppladdad bild, AI-resultat, foto-form/pan, text-innehåll och kart-position med över till nya layoutblockets lager. Byte mellan poster/aluminium/akryl (samma `defaultLayout`) fortsätter fungera identiskt.
