# Plan: Move-handle position + "fyll-hela-lagret"-form för kartor och foton

## 1. Flytta handtaget till övre vänstra utsidan av lagerinnehållet

Idag sitter `moveHandle` på `top-2 left-2` (inuti lagret), vilket överlappar innehållet — speciellt på små lager och vid clip-shapes (cirkel/heart/star) där hörnet ändå är "tomt" men på rect/foto syns det överlappa.

**Lösning:** Flytta handtaget till `top: -14px; left: -14px` (alltså strax utanför övre vänstra kanten av lagrets bounding box). Eftersom lagrets wrapper i `MapPreview` är `position: absolute` inom posterramen, kommer handtaget att ligga utanför bounding boxen men fortfarande renderas (parent har inte `overflow: hidden`).

Säkerställ att:
- `z-index` är högt nog att alltid synas ovanpå andra lager (`z-50` eller motsvarande inline `zIndex: 9998`).
- Handtaget får inte clippas av layer-wrapperns clip-path. Handtaget ligger redan **utanför** clip-content (det är ett separat absolut element i wrappern, inte inuti `PhotoLayerView`/`MapLayerSlot`s clippade div), så det är säkert.
- Specialhantering för text-lager: handtaget renderas idag *inuti* text-divens flex-layout (i `<span>`-grannskap). Vi flyttar det utanför så att det inte påverkar centrerings­layouten.

**Filer att ändra:** `src/components/editor/MapPreview.tsx` — exakt ett ställe där `moveHandle` definieras (raderna ~282-292), samt text-lagrets render där handtaget ska bli ett syskon till text-wrappern istället för ett barn.

## 2. Ny "Fyll lager"-form (rect) för kartor och foton

### Schema-ändringar (`src/lib/template-schema.ts`)

- **`mapShapeSchema`**: Lägg till `"rect"` → `z.enum(["rect", "circle", "heart", "star"])`.
- **`photoShapeSchema`**: Redan inkluderar `"rect"` — inget att göra här.
- Migrationsvänligt: nya kartor får default `"circle"` så befintliga templates förblir oförändrade.

### Admin-inspector (`src/components/admin/LayerInspector.tsx`)

I de två map/photo shape-`Select`-fälten lägg till option:
- Karta: `<SelectItem value="rect">Fyll lager (rektangel)</SelectItem>`
- Foto/aiPhoto: redan har "rect"-option (verifiera).

### Customer-render (`src/components/editor/MapPreview.tsx`)

**Karta:**
- I `shapeClipPath()`: `case "rect": return undefined;` (ingen clip → fyller hela bounding box).
- I `MapLayerSlot`: `isCircle` används bara för att räkna ut perfekt cirkel-clip. För `"rect"` skickas `staticClip = undefined` → kartan renderas som rektangel som fyller hela layer-rect. Inget annat krävs eftersom `MapLayerInstance` redan tar hela `inset-0`.

**Foto / AI-foto:**
- `shape === "rect"` → `shapeClipPath` returnerar `undefined`. `PhotoLayerView` har redan exakt rätt logik: när `shape !== "circle"` och `staticClipPath === undefined` får `clipPath = undefined` → bilden fyller hela bounding box.
- Pan-logiken (cover-mode med `offsetX/Y`) fungerar **redan** för `rect` — `canPan` styrs av `fit !== "contain"` och `maxX/maxY > 0`, helt oberoende av shape. Inget behöver ändras där.

### Print-pipeline & snapshot

Verifiera att `template-snapshot.ts` och `print-pipeline.ts` hanterar `rect` korrekt (= ingen clip). Eftersom de flesta render-paths redan defaultar till "ingen clip" vid okänd/saknad shape förväntas inga ändringar, men jag granskar och uppdaterar vid behov.

### Migration

Ingen DB-migration krävs. Befintliga template-JSONs har redan `"circle"|"heart"|"star"` för kartor — schemat utvidgas bakåtkompatibelt.

## Filer som ändras

- `src/lib/template-schema.ts` — utvidga `mapShapeSchema`.
- `src/components/admin/LayerInspector.tsx` — lägg till "rect"-option för karta.
- `src/components/editor/MapPreview.tsx` — flytta moveHandle utanför + hantera `rect` i `shapeClipPath`.
- `src/lib/template-snapshot.ts` & `supabase/functions/generate-print-file/index.ts` — verifiera/uppdatera vid behov.

Resultat: Handtaget sitter konsekvent precis utanför övre vänstra hörnet på alla lagertyper, och både kartor och foton kan väljas att fylla hela lagret rektangulärt — foton behåller pan/zoom-stödet.
