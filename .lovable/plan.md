## Mål
Tillåt kunden att placera ikoner (hjärta, hus, stjärna m.fl.) ovanpå ett kartlager — synliga i editorn, cart-thumbnail och Gelato-tryckfil. Ikonerna har fast storlek (oberoende av kartans zoom), respekterar lagrets form (heart/star/circle), och kan raderas via en liten papperskorgsknapp.

## Datamodell

`src/stores/editorStore.ts`:

```ts
export interface MapIcon {
  id: string;          // uuid
  iconId: string;      // t.ex. "heart"
  xPct: number;        // 0..100, position inom kartlagrets box
  yPct: number;        // 0..100
}

interface MapLayerValue {
  ...
  icons: MapIcon[];    // default []
}
```

Nya actions:
- `addMapIcon(layerId, icon)` — push + clamp inom shape (om utanför → no-op)
- `removeMapIcon(layerId, iconId)`
- `moveMapIcon(layerId, iconId, xPct, yPct)` (drag-stöd, valfritt i v1)

Ny transient state (ej persisterad i `layerValues`, ligger i store):
- `activeIconTool: { iconId: string } | null` — sätts när användaren klickar en ikon i panelen, nollställs vid ESC eller efter placering (vi kör "place-one-then-deactivate" — enklast och matchar Mapiful).
- `selectedMapIconId: { layerId, iconId } | null` — vald ikon på kartan (för papperskorgs-popover).

## Ikonkatalog

`src/lib/map-icon-catalog.ts` (ny):
- Använd lucide-react (finns redan): Heart, Home, Briefcase, MapPin, Smile, User, Star, Building2, ArrowRight, ArrowLeft, ArrowUp, ArrowDown, LifeBuoy, Goal, Camera, Zap (matchar Mapiful-bilden + lite extra).
- Export `MAP_ICONS: Array<{ id, label, Component }>` + helper `iconSvgString(id, color)` som returnerar en serialiserad SVG (24x24 viewBox) för rastrering på canvas i `template-snapshot`. Vi extraherar `iconNode` från lucide eller renderar via `renderToStaticMarkup` av `<IconComponent>`.

Ikonen ritas alltid med `currentColor = #111` (samma som textens fontColor-default — kan göras konfigurerbar i framtiden men inte i denna iteration).

## Storlek

Fast storlek i `mm`: `ICON_SIZE_MM = 8` (≈ matchar Mapiful). Konverteras till px både på skärm (via `frontPxPerMm` som redan finns för text) och på print-canvas (via `pxPerCm` i snapshot). Detta gör att storleken är oberoende av kartans interna zoom — det är layer-storleken som styr.

## Editor-panel

`src/components/editor/ControlPanel.tsx` (`MapTabs.renderForLayer`):

Lägg till en ny sektion under map style:

```tsx
<div className="pt-4 border-t">
  <MapIconsSection layer={l} value={...} />
</div>
```

Ny komponent `MapIconsSection`:
- Header "Ikoner" + body-text (nya i18n-nycklar i `sv.json`: `mapIcons.heading`, `mapIcons.subheading`, `mapIcons.addToMap`, `mapIcons.search`, `mapIcons.showMore`, `mapIcons.delete`; översätt till alla 11 språk).
- Sökruta (Input) som filtrerar `MAP_ICONS` på `label` (svensk i18n via t-nycklar `mapIcon.<id>`).
- 4-kolumns grid med kvadratiska knappar (samma stil som bifogad bild). Aktivt val har ring/`bg-primary/10`.
- Klick på en knapp → `setActiveIconTool({ iconId })`. Klick igen på samma → avaktivera.
- "Visa fler ikoner"-toggle som expanderar listan från 16 → alla.

## Placering & cursor-preview

`src/components/editor/MapPreview.tsx`, inom `MapLayerSlot`:

1. När `activeIconTool` är satt OCH muspekaren är inom lagret OCH inom shape → rendera en absolut-positionerad lucide-ikon (storlek `iconPx`) vid musens position, `pointer-events: none`, opacity 0.7. Använd ny helper `isPointInShape(shape, w, h, x, y)` i `src/lib/shape-clip.ts`:

```ts
export function isPointInShape(shape, w, h, x, y): boolean
```

Implementerad via:
- `rect`: alltid sant
- `circle`: `(x-cx)² + (y-cy)² ≤ r²`
- `heart`/`star`: bygg en `Path2D` av samma path-string som `buildShapeClipPath` och använd ett offscreen `CanvasRenderingContext2D.isPointInPath`. Cacha Path2D per shape+size i en `useMemo`.

2. Cursor: `cursor: crosshair` när tool aktivt och inom shape, annars default.

3. `onPointerDown` (vänsterklick) inom shape → `addMapIcon(layerId, { id: uuid, iconId, xPct, yPct })`, `setActiveIconTool(null)`. Klick utanför shape → ignorera (men ev. avaktivera om utanför lagret helt).

## Rendera ikoner i editor

I `MapLayerSlot` rendera efter map-tilen, före text-overlays:

```tsx
<div style={{ clipPath }} className="absolute inset-0 pointer-events-none">
  {icons.map(icon => (
    <button
      key={icon.id}
      onClick={(e) => { e.stopPropagation(); setSelectedMapIconId({layerId, iconId}); }}
      className="absolute pointer-events-auto"
      style={{ left: `${icon.xPct}%`, top: `${icon.yPct}%`, width: iconPx, height: iconPx, transform: 'translate(-50%, -50%)' }}
    >
      <Icon ... size={iconPx} />
    </button>
  ))}
</div>
```

När `selectedMapIconId` matchar → rendera en liten popover ovanför ikonen med en Trash2-knapp (i18n: `mapIcons.delete`). Klick utanför avmarkerar (klick på preview-bakgrunden).

## Snapshot/print

`src/lib/template-snapshot.ts` (`drawMapLayer` eller direkt i map-blocket runt rad 663):

Efter map-bilden är ritad (inom shape-clip):
```ts
for (const icon of mv.icons ?? []) {
  const sizePx = ICON_SIZE_MM * (rect.w / frontMm.w);   // skala mot lagrets bredd
  const svg = iconSvgString(icon.iconId, "#111");
  const img = await loadSvgAsImage(svg, sizePx, sizePx);
  ctx.drawImage(img, rect.x + rect.w*icon.xPct/100 - sizePx/2, rect.y + rect.h*icon.yPct/100 - sizePx/2, sizePx, sizePx);
}
```

Ny helper `loadSvgAsImage(svg, w, h): Promise<HTMLImageElement>` som wrapper för `new Image() + data:image/svg+xml;base64,...`. Shape-clip är redan satt så ikoner utanför formen klipps automatiskt (matchar editorn).

## Cart-preview & tryckfil

Inga separata ändringar — `template-snapshot.ts` används av både `renderTemplateSnapshot` (thumbnail) och `getPrintFileUrl`/Gelato-pipeline. Eftersom `icons` ligger i `MapLayerValue` skickas de automatiskt via `layerValues` till snapshot.

`EditorPage.handleAddToCart` properties: inget extra behövs eftersom `_design_id` + servrarens print-pipeline läser samma `layerValues`.

## Filer som ändras

- `src/stores/editorStore.ts` — `MapIcon`, fält i `MapLayerValue`, actions, transient state, init/reset till `icons: []`.
- `src/lib/shape-clip.ts` — `isPointInShape`.
- `src/lib/map-icon-catalog.ts` — ny.
- `src/components/editor/ControlPanel.tsx` — `MapIconsSection` + rendera den i `MapTabs`.
- `src/components/editor/MapPreview.tsx` — cursor-preview, klickplacering, render av placerade ikoner, papperskorgs-popover.
- `src/lib/template-snapshot.ts` — `drawMapIcons` i map-blocket.
- `src/i18n/locales/*.json` — nya nycklar (`mapIcons.*` + `mapIcon.<id>`-etiketter) i alla 11 språk.

## Avgränsning

- Endast karta får ikoner (inte foto/AI-foto/text-lager).
- En färg (#111). Ingen färgväljare i v1.
- Ingen drag-and-drop av redan placerade ikoner i v1 — bara placera + radera. (Lätt att addera senare via `moveMapIcon`.)
- Ingen rotation/skalning av enskild ikon.
- Inga ändringar i admin-designer, mockup, pricing, Shopify, Gelato-SKU, auth, secrets.

## Verifiering

1. `/editor?handle=brollopskarta&type=poster` → ny "Ikoner"-sektion under map style. Klicka hjärtikon → cursor blir crosshair, hjärta följer musen endast inom karta + endast inom heart-shape (testa med heart-shape karta att ikon-preview döljs när muspekaren är i hjärtformens "luft"). Klick → ikon placeras, tool avaktiveras.
2. Klick på placerad ikon → liten papperskorgsknapp visas, klick raderar.
3. Storleken är konstant när man scroll-zoomar kartan.
4. Lägg i varukorg → `_preview_image` visar ikonerna. Inspektera `_print_file_url` → ikonerna finns i tryckfilen på rätt position.
