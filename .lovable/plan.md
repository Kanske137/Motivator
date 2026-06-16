## Bakgrund

Två regressioner från förra build:

1. **Foto-pan blockerad** i Skapa själv. Anledning: när vi gjorde kund-tillagda shape/line-lager interaktiva i previewen satte vi `pointerEvents: 'auto'` på HELA wrappern (via `wrapStyle`). En custom shape som ligger ovanpå ett foto fångar då alla pekare, så fotot kan inte längre pannas.

2. **Linje-orientering byter inte riktning.** `LayerQuickSettings` patchar `defaults.orientation: "vertical"` men `layerTransforms[id].wPct/hPct` rörs inte. Bbox-en förblir bred-och-tunn, resize-handtaget (bottom-right) sitter kvar i samma punkt, och längden = gamla tjockleken eftersom render-vyn vänder axeln inom samma bbox.

## Ändringar

### 1) `src/components/editor/MapPreview.tsx`

För kund-tillagda shape/line (`isCustomDecor === true`):
- Sätt `pointerEvents: 'none'` på wrappern (samma som låsta shape/line idag).
- Behåll `pointerEvents: 'auto'` på `moveHandle` och `resizeHandle` (redan satt i deras inline-style).
- Innehållet (ShapeLayerView / LineLayerView) behöver ingen pekarinteraktion — bara handtagen.

Konkret i shape/line/grenarna:
```ts
const style = { ...wrapStyle, pointerEvents: "none" as const };
```
(slopa `isCustomDecor ? wrapStyle : {...}`-villkoret — alltid none för wrappern).

Samtidigt i `isInteractiveLayer`-beräkningen: ta bort `isCustomDecor` så att shape/line-wrappern inte heller får `pointerEvents: undefined`-fallthrough. Detta säkerställer att foto/karta under får alla pekarhändelser tillbaka.

Inget ändras för photo/aiPhoto/map/text — de behåller sin nuvarande interaktion.

### 2) `src/components/editor/LayerQuickSettings.tsx` — line orientation swap

När kund byter `horizontal ↔ vertical`: swappa även layerTransform-rektangeln så bbox blir lika "lång" i nya riktningen.

```ts
const setLayerTransform = useEditorStore((s) => s.setLayerTransform);
const layerTransforms = useEditorStore((s) => s.layerTransforms);

function applyLineOrientation(layer, next) {
  if (layer.defaults.orientation === next) return;
  onPatch({ orientation: next });
  // Swap bbox width/height kring lagrets center
  const eff = effectiveLayerRect(layer, layerTransforms); // import från layer-utils
  const cx = eff.xPct + eff.wPct / 2;
  const cy = eff.yPct + eff.hPct / 2;
  const newW = eff.hPct;
  const newH = eff.wPct;
  const rect = clampLayerRect({
    xPct: cx - newW / 2,
    yPct: cy - newH / 2,
    wPct: newW,
    hPct: newH,
  });
  setLayerTransform(layer.id, rect);
}
```

Resize-handtaget (bottom-right av bbox) hamnar då automatiskt vid nya linjens ände — och längden blir samma som föregående linje, fast på andra axeln.

Ingen ändring i `editorStore.ts`, `freeform-layers.ts`, `template-schema.ts`, snapshot- eller print-pipeline. Drag-reorder, visibility, onboarding och CTA-validering rörs inte. Inga nya i18n-nycklar.

## Filer som ändras
- `src/components/editor/MapPreview.tsx` — ta bort `pointerEvents: 'auto'` på custom shape/line-wrappers; rensa `isCustomDecor` ur `isInteractiveLayer`.
- `src/components/editor/LayerQuickSettings.tsx` — swap bbox på orientation-byte.
