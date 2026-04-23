

## Mellansteg: Form-rensning, default-plats per karta, oberoende textrutor

Tre fokuserade fixar innan Fas 2.

### 1. Begränsa kartformer till `circle | heart | star`

**Tillåtna former:** Cirkel, Hjärta, Stjärna. Rektangel + Kvadrat tas bort överallt. Befintliga lager med `"rect"`/`"square"` migreras tyst till `"circle"` vid läsning.

**Filer:**
- `src/lib/template-schema.ts` — `mapShapeSchema = z.enum(["circle", "heart", "star"])`. `MapShape`-typen följer med.
- `src/lib/template-migrate.ts` — i `resolveTemplate`/`buildTemplateFromLegacy`: om `defaults.shape` är `"rect"` eller `"square"` → sätt `"circle"`.
- `src/lib/layer-utils.ts` — ny map-lager-default `shape: "circle"` (istället för `"rect"`).
- `src/components/admin/LayerInspector.tsx` — ta bort `<SelectItem>` för rect/square; lägg till `star`.
- `src/components/admin/MapLayerPreview.tsx` + `TemplateThumbnail.tsx` — clipPath-switch: ta bort `rect`/`square`, lägg till `star` (SVG-clipPath, 5-uddig stjärna i `objectBoundingBox`-koordinater).
- `src/components/editor/ControlPanel.tsx` — `shapeOptions`-array: bara cirkel/hjärta/stjärna. Importera `Star` från lucide-react. Grid blir `grid-cols-3` istället för `grid-cols-4`.
- `src/components/editor/MapPreview.tsx` — `shapeClipPath()` får ny `case "star"` som returnerar `url(#starId)`. Lägg till `<StarClipDef>` (parallellt med `HeartClipDef`).
- `src/components/editor/layers/MapLayerInstance.tsx` + `StaticLayers.tsx` — Props-typer uppdateras till `"circle" | "heart" | "star"`.
- `src/lib/template-snapshot.ts` — `clipForShape()`: ta bort `square`, lägg till `star` (Path2D med 5 uddar, samma `objectBoundingBox`-mappning som SVG-versionen). `liveMapShape`-typ uppdateras.
- `src/stores/editorStore.ts` — `MapShape`-typ uppdateras; legacy-mirror default `"circle"` istället för `"rect"`.

**Stjärn-path** (5-uddig, `objectBoundingBox` 0–1): klassisk pentagram-formel runt centrum (0.5, 0.5), ytterradie 0.5, innerradie 0.2, första udden uppåt. Samma path används både i SVG-clipPath och som Path2D i snapshot.

### 2. Förvald plats per karta i admin

I `LayerInspector` får varje map-lager en **plats-sökruta** (samma Mapbox geocoding som kund-editorn) som sätter både `defaults.center` och `defaults.zoom` på lagret samt sparar `defaults.placeName`/`city`/`country` så att länkad text-default kan auto-byggas.

**Schema** (`template-schema.ts`):
- `mapDefaultsSchema` får valfria `placeName`, `city`, `country` (alla `z.string().optional()`). Bakåtkompatibelt.

**Admin-UI** (`LayerInspector.tsx`, för map-lager):
- Ny "Förvald plats"-sektion ovanför Lng/Lat/Zoom: input + dropdown med geocode-resultat (återanvänder `geocode()` från `@/lib/mapbox`, samma debounce-mönster som `PlaceLayerSection`).
- När admin väljer ett resultat: skriver `defaults.center = r.center`, `zoom = 12` (eller behåller nuvarande om satt), `placeName = r.place_name`, `city = r.city`, `country = r.country`.
- Lng/Lat/Zoom-inputs blir kvar för finjustering.
- För **alla länkade text-lager i samma orientation** (där `defaults.linkedMapLayerId === mapLayer.id`): auto-uppdatera `defaults.text` med samma `STAD\nLand\n00.0000°N · 00.0000°E`-format som kund-runtime använder. Detta sker i Designer-state-nivå (`DesignerPage` har redan `onChange` för layers). Lägg en helper `applyAdminPlaceToLinkedTexts(layers, mapId, place)` i `template-migrate.ts` (eller ny `template-helpers.ts`) och anropa den vid plats-pick.

**Kund-runtime** (`editorStore.hydrateLayerValues`):
- När en map-lager hydreras, kopiera in `defaults.placeName/city/country` till `MapLayerValue` så kund-editorn visar adminens valda plats direkt under "Vald plats".

### 3. Olänkade textrutor uppdateras ALDRIG av kartändringar

Nuvarande `applyPlaceInternal` i `editorStore.ts` har en bakåtkompatibilitets-fallback (rad 436–447) som behandlar första text-lagret som auto-länkat till första kart-lagret om **inget** text-lager har en explicit länk. Detta är roten till "olänkad text uppdateras ändå".

**Fix** (`editorStore.ts`):
- Ta bort hela `anyExplicitLink`/`firstMapId`/`firstTextId`-fallbacken.
- Ny regel, exakt: text-lager auto-uppdateras **endast** om `l.defaults.linkedMapLayerId === mapId` **och** `tv.isCustom === false`.
- Olänkade text-lager rör vi aldrig vid plats-byten — de visar `defaults.text` (som admin satt) tills kunden själv ändrar dem.

**Migrationsstöd** för befintliga single-layer-mallar som nu skulle "tappa" auto-uppdateringen:
- I `template-migrate.ts` / `resolveTemplate`: om en mall har **exakt en map** + **exakt en text** och text-lagrets `linkedMapLayerId` är `undefined` → sätt det automatiskt till map-lagrets id. Säkerställer att de två befintliga publicerade produkterna (Personlig karta poster/canvas) fortsätter fungera utan admin-handpåläggning.

### Verifieringssteg

1. Admin-form-väljaren visar bara Cirkel/Hjärta/Stjärna. Kund-editorns "Kartans form" visar samma tre i grid-cols-3. Stjärna renderar både i preview och i print-snapshot.
2. Befintliga mallar med `shape: "rect"` öppnas utan fel — visas som cirkel.
3. I admin: sätt förvald plats "Göteborg" på Karta 2 → kund-editorn öppnar med Karta 2 centrerad på Göteborg, "Vald plats" visar Göteborg, länkad Text 2 visar `GÖTEBORG\nSverige\n…`.
4. Mall med 2 kartor + 2 texter där bara Text 1 är länkad till Karta 1: byt plats på Karta 2 → Text 2 ändras INTE (visar admin-default eller kundens egna inmatning). Byt plats på Karta 1 → Text 1 uppdateras (om kund inte redan skrivit eget).
5. Befintlig single-layer-poster: byta plats uppdaterar fortfarande texten (auto-länkning från migration kickar in).

### Direkt efter detta

Tillbaka till **Fas 2** (AI-stilar, mockup-galleri, 3D canvas-preview, cart-integration med snapshot-pipelinen).

