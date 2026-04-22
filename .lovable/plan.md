

## Fix: Per-lager state för flera kartor & texter

### Problemet

Kund-store har **ett globalt** `mapCenter`/`mapZoom`/`mapShape`/`text`/`textFont` osv. När en mall har 2 kartor + 2 texter:
- Bara den **första** kartan är "live" — övriga är låsta till sina admin-defaults.
- "Plats"-fliken styr bara den första kartan.
- Bägge text-lagren renderar samma globala `text` → blir dubletter.
- Drag-och-drop på kartan i preview slutar fungera när admin har låst position på lagret (och den andra kartan har aldrig varit interaktiv).

### Lösning — per-lager värden + per-lager UI + valbar text↔karta-länkning

#### 1. Schema: ny `linkedMapLayerId` på text-lager

`src/lib/template-schema.ts`:
- `textDefaultsSchema` får valfritt `linkedMapLayerId: z.string().nullable().optional()`.
  - `null`/undefined = ingen länk (statisk text)
  - sträng = id på ett map-lager → text auto-uppdateras med stad/koordinater när den kartan flyttas/byts plats på.

#### 2. Editor-store: `layerValues` map

`src/stores/editorStore.ts`:
- Nytt state:
  ```ts
  layerValues: Record<string /* layerId */, MapLayerValue | TextLayerValue>
  ```
  - `MapLayerValue`: `{ center, zoom, styleId, shape, showLabels, placeName, city, country }`
  - `TextLayerValue`: `{ text, font, isCustom, visible }`
- `setConfig` hydrerar `layerValues` från **alla** lager i `template.defaultLayout[orientation].layers` (inte bara första).
- Nya setters: `setLayerMapCenter(id, c)`, `setLayerMapZoom(id, z)`, `setLayerMapStyle(id, s)`, `setLayerMapShape(id, s)`, `setLayerShowLabels(id, v)`, `applyPlaceToLayer(id, args)`, `setLayerText(id, t)`, `setLayerTextFont(id, f)`, `setLayerTextVisible(id, v)`.
- `applyPlaceToLayer(mapId, args)`:
  1. Uppdaterar map-lagrets `center/placeName/city/country`.
  2. Loopar alla text-lager där `defaults.linkedMapLayerId === mapId` och `value.isCustom === false` → regenererar texten via `buildAutoText`.
- Behåller globala fält som **derived getters** för bakåtkompatibilitet (returnerar första kartans/textens värde) — så ingenting går sönder under övergången.

#### 3. `MapLayerInstance.tsx`: ta `layerId` istället för "live"-flagga

- Tar bort `live` boolean. Tar emot `layerId` + `interactive`.
- Alla map-events (`moveend`) skriver tillbaka till `layerValues[layerId]` via `setLayerMapCenter/Zoom`.
- `interactive` styrs av `!layer.locks.position` per lager.
- Reverse-geocoding triggar `applyPlaceToLayer(layerId, ...)`.

#### 4. `MapPreview.tsx`: läs per-lager-värden

- För varje map-lager: läs `layerValues[l.id]` istället för globalt store.
- För varje text-lager: läs `layerValues[l.id].text/font/visible` istället för globalt `text`/`textFont`/`textVisible`.
- Tar bort konceptet "first map = live" — alla kartor är nu interaktiva (om locks tillåter).

#### 5. `ControlPanel.tsx`: dynamiska sektioner per lager

Bygg om från statiska accordions till dynamiska:

**Plats-sektion**: Loopar alla map-lager i mallen.
- Om endast 1 karta → header bara "Plats".
- Om flera → "Plats — Karta 1", "Plats — Karta 2" osv (använder `layer.name` om satt).
- Varje karta får sin egen sub-sektion med: vald plats, sökruta, tipstext. Sökresultat triggar `applyPlaceToLayer(layerId, ...)`.

**Kartstil-sektion**: Samma mönster — en sub-grupp per map-lager med stil/labels/form/bg. Bg är fortfarande globalt (en per layout).

**Text-sektion**: Loopar alla text-lager. Var och en får: visa-toggle, textarea, font-grid. Skriver till `setLayerText(id, ...)`.

Lager med fullt låsta defaults (alla relevanta `locks` true) hoppas över helt eller visas som read-only info.

#### 6. Admin: `LayerInspector` får text↔karta-koppling

`src/components/admin/LayerInspector.tsx`:
- I text-lager-defaults: ny `Select` "Länka till karta":
  - "Ingen (statisk text)"
  - En option per map-lager i samma orientation (visar `layer.name`).
- Sätter/rensar `defaults.linkedMapLayerId`.

#### 7. Snapshot-pipeline läser `layerValues`

`src/lib/template-snapshot.ts`:
- Tar `layerValues` i input. För varje lager: använd `layerValues[l.id]` om finns, annars `l.defaults`. Säkrar att print-filen matchar exakt det kunden ser.

### Filer

| Fil | Ändring |
|---|---|
| `src/lib/template-schema.ts` | `linkedMapLayerId` i textDefaults |
| `src/stores/editorStore.ts` | `layerValues` map + per-lager setters + `applyPlaceToLayer` |
| `src/components/editor/layers/MapLayerInstance.tsx` | Per-lager binding via `layerId` |
| `src/components/editor/MapPreview.tsx` | Läs `layerValues` per lager |
| `src/components/editor/ControlPanel.tsx` | Dynamiska Plats/Kartstil/Text-sektioner per lager |
| `src/components/admin/LayerInspector.tsx` | Länka-text-till-karta select |
| `src/lib/template-snapshot.ts` | Läs `layerValues` |
| `src/lib/template-migrate.ts` (om behövs) | Default `linkedMapLayerId = null` på legacy-text |

### Verifiering

1. Mall med 2 kartor + 2 texter → kund kan dra/zooma båda kartorna fritt.
2. Plats-fliken visar "Karta 1" och "Karta 2" sektioner separat — sök i Karta 2 flyttar bara Karta 2.
3. Text-fliken visar "Text 1" och "Text 2" separat — redigera Text 1 ändrar inte Text 2.
4. I admin: sätt Text 1 länkad till Karta 1, Text 2 länkad till Karta 2 → ändra plats i Karta 2 uppdaterar Text 2 (om kund inte redigerat den manuellt) men inte Text 1.
5. Befintliga single-layer-mallar fungerar oförändrat.

### Efter detta

Tillbaka till plan: **Fas 2** (kund-editor: AI-stilar, mockup-galleri, 3D canvas-preview, cart-integration med snapshot-pipelinen).

