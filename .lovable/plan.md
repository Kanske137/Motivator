## Mål
1. **Bugg:** Klick på papperskorgs-knappen tar bort knappen (avmarkerar) men raderar inte själva ikonen. Fixa så att ikonen faktiskt försvinner.
2. **Geo-ankring:** Ikoner ska bindas till en geografisk punkt (lng/lat) på kartan i stället för till lagrets bounding-box. När kunden pannar/zoomar kartan ska ikonen följa med kartans punkt, men ikonens **pixelstorlek** ska förbli konstant (som idag).

---

## Del 1 — Trash-buggen

Trolig orsak: `onClickPlace` på overlay-containern triggas av bubbling när trash-knappen klickas, eller den globala `mousedown`-listenern nollställer `selectedMapIcon` innan React hinner köra `removeMapIcon` (state-race). Symptomen ("trash försvinner, ikon kvar") matchar att `setSelectedMapIcon(null)` körs medan `removeMapIcon` av någon anledning inte sker.

Åtgärder i `src/components/editor/MapIconsOverlay.tsx`:
- Byt trash-knappens handler från `onClick` till `onPointerDown` (fyrar före document-`mousedown`-listenern) och anropa `e.preventDefault()` + `e.stopPropagation()` där.
- Lägg även `onPointerDown` på ikon-knappen som sätter `selectedMapIcon` (samma anledning — undvik race med outside-listenern).
- I `onClickPlace` (containerns onClick): early-return även om `selectedMapIcon` är satt — placering ska aldrig kunna ske ovanpå en existerande markerad ikon utan att den först avmarkeras.
- I outside-`mousedown`-effekten: ignorera om `e.target` är inom någon `.map-icon-popover` (datasel/klass på trash-wrappern) — säkrare än enbart `containerRef.contains`.

Verifiering: klicka på en placerad ikon → trash dyker upp → klicka trash → ikon + trash försvinner direkt.

---

## Del 2 — Geo-ankra ikoner

### Datamodell
`src/stores/editorStore.ts`:
```ts
export interface MapIcon {
  id: string;
  iconId: string;
  lng: number;     // NY — primär anchor
  lat: number;     // NY — primär anchor
  xPct?: number;   // LEGACY — behållen för bakåtkomp, ignoreras om lng/lat finns
  yPct?: number;
}
```
`addMapIcon` tar nu `{ id, iconId, lng, lat }`.

### Placering (editorn)
För att projicera mus → lng/lat behöver overlay åtkomst till Mapbox-instansen.

`src/components/editor/layers/MapLayerInstance.tsx`:
- Lägg till valfri prop `onMapReady?: (map: mapboxgl.Map | null) => void`. Anropa med map vid load och med `null` vid unmount.

`src/components/editor/MapPreview.tsx`:
- Håll en `Map<layerId, mapboxgl.Map>` i en `useRef`. Skicka `onMapReady` ner till varje `MapLayerInstance`.
- Skicka ner samma map-ref-getter till `MapIconsOverlay` som ny prop `getMap: () => mapboxgl.Map | null`.

`src/components/editor/MapIconsOverlay.tsx`:
- **Placering**: vid klick, gör `map.unproject([x, y])` → `{lng, lat}` och anropa `addMapIcon(layerId, { id, iconId, lng, lat })`.
- **Render**: räkna varje ikons pixelposition via `map.project([lng, lat])`. Subscriba på `map.on('move' | 'zoom' | 'rotate', forceUpdate)` så positionerna re-projiceras under pan/zoom.
- **Bakåtkomp**: om `lng/lat` saknas men `xPct/yPct` finns, konvertera EN gång vid första render via `map.unproject([xPct/100*w, yPct/100*h])` och kalla `replaceMapIcon` för att uppgradera datan.
- **Ghost-cursor**: ingen förändring — använder fortfarande musens råa x/y.
- **Shape-clip**: oförändrad — `isPointInShape` använder fortfarande pixelkoordinater (kvar både för ghost och för placeringsvalidering).
- Storleken (`iconPx`) räknas precis som idag baserat på lagrets bounding-box (oberoende av zoom).

### Snapshot/print
`src/lib/template-snapshot.ts` `drawMapIcons`:
- Behöver projicera lng/lat → pixel inom `rect` med samma center/zoom som map-bilden ritades med. Tillsätt en ren Web-Mercator-helper (Mapbox använder standard slippy projection vid pitch=0/bearing=0, vilket alltid är vårt fall):

```ts
function projectToLayerPx(lng, lat, center, zoom, w, h) {
  const scale = 256 * Math.pow(2, zoom);
  const merc = (lon, la) => {
    const x = (lon + 180) / 360 * scale;
    const s = Math.sin(la * Math.PI / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
    return { x, y };
  };
  const c = merc(center[0], center[1]);
  const p = merc(lng, lat);
  return { x: w / 2 + (p.x - c.x), y: h / 2 + (p.y - c.y) };
}
```

- Signaturen för `drawMapIcons` utökas med `center: [number,number]` och `zoom: number`. Anropssidan i map-blocket skickar `mv.center` / `mv.zoom`.
- Fallback för legacy `xPct/yPct` om `lng/lat` saknas (samma kod som idag).
- Klippningen mot shape (`clipForShape`) behålls — ikoner som hamnar utanför formen klipps automatiskt, exakt som i editorn.

---

## Filer som ändras
- `src/stores/editorStore.ts` — `MapIcon` med `lng/lat`, ev. ny `replaceMapIcon`-helper för legacy-uppgradering.
- `src/components/editor/layers/MapLayerInstance.tsx` — `onMapReady`-prop.
- `src/components/editor/MapPreview.tsx` — håll map-instanser per lager, skicka getter till overlay + onMapReady till instance.
- `src/components/editor/MapIconsOverlay.tsx` — pointerdown-fix för trash, geo-projektion via map-instans, prenumeration på move/zoom.
- `src/lib/template-snapshot.ts` — Web Mercator-projektion i `drawMapIcons`, ny signatur med center/zoom.

## Avgränsning
- Ingen ändring i admin, pricing, Shopify, Gelato, auth eller i18n.
- Ingen drag-and-drop av placerade ikoner (kvarhålls för framtida iteration).
- Pitch/bearing förblir 0 (befintligt beteende) — annars skulle Web-Mercator-formeln behöva matchas mot Mapbox transform.

## Verifiering
1. Placera en ikon, klicka den, klicka trash → ikon försvinner direkt.
2. Placera en ikon på t.ex. Eiffeltornet, panorera kartan → ikonen "klistrar" på tornet.
3. Scroll-zooma in/ut → ikonens pixelstorlek är konstant, men dess kartposition håller sig på tornet.
4. Lägg i varukorg → `_preview_image` och `_print_file_url` visar ikonen exakt på tornets position.
