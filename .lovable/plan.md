# Margin alltid visuellt överst

Litet tillägg till tidigare implementation av "Vit marginal"-toggle:

## Beteende
- Margin-lagret ska ALLTID renderas visuellt överst, oavsett dess `zIndex` i mallen.
- Klick-beteende oförändrat — margin-wrappern fortsätter ha `pointer-events: none` så den aldrig stjäl klick från lager under (kanterna har `pointer-events: auto` enbart för att vara synliga, men margin är admin-låst så det spelar ingen roll).

## Ändringar

### `src/components/editor/MapPreview.tsx`
Efter att `layers`-arrayen byggts (rad ~149), sortera om så margin-lager hamnar SIST i loop-ordningen:
```ts
const visibleLayers = whiteMarginEnabled ? allLayers : allLayers.filter((l) => l.type !== "margin");
const layers = [
  ...visibleLayers.filter((l) => l.type !== "margin"),
  ...visibleLayers.filter((l) => l.type === "margin"),
];
```
Eftersom varje lagers wrapper sätter CSS `zIndex: l.zIndex`, lägger vi också till en override för margin: i wrapperStyle, om `l.type === "margin"`, sätt `zIndex: 9999` istället för `l.zIndex`. Det säkerställer att även när admin gett ett annat lager högre `zIndex`, hamnar margin överst.

### `src/lib/template-snapshot.ts`
I render-loopen efter sort-by-zIndex (rad ~523), gör samma omsortering:
```ts
const sorted = [...layout.layers].sort((a, b) => a.zIndex - b.zIndex);
const allLayers = [
  ...sorted.filter((l) => l.type !== "margin"),
  ...sorted.filter((l) => l.type === "margin"),
];
```
Eftersom snapshot ritar lager i array-ordning, hamnar margin sist = överst på canvas.

## Filer som ändras
- `src/components/editor/MapPreview.tsx` — omsortera `layers`, override CSS `zIndex` för margin-wrappers.
- `src/lib/template-snapshot.ts` — omsortera `allLayers` så margin alltid ritas sist.

Mockups, cart-thumbnail och printfilen ärver detta automatiskt eftersom de alla går via `renderTemplateSnapshot`.
