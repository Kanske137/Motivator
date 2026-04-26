
## Plan: Marginal click-through (kund) · Linje-rotation · Ångra-knapp

### 1. Marginal blockerar klick i **kund-editorn** (huvudbuggen)

**Rotorsak**: I `src/components/editor/MapPreview.tsx` (rad 202–339) renderas alla lager med en gemensam wrapper-div (`wrapStyle`, rad 204–211). För marginal-lagret är wrappern 100%×100% av canvasen och saknar `pointer-events: none`. Den fångar därför alla klick/drag innan eventet hinner ner till `MarginLayerView` (som internt har korrekt logik med transparent mitt).

**Fix**: I rendrings-grenen för `l.type === "margin"` (rad 330–336), lägg `pointerEvents: "none"` på wrappern. `MarginLayerView` har redan `pointer-events: auto` på de fyra synliga kant-strippsen, så marginalen syns kvar visuellt men mitten släpper igenom klick till kartan/övriga lager.

```tsx
if (l.type === "margin") {
  return (
    <div key={l.id} style={{ ...wrapStyle, pointerEvents: "none" }}>
      <MarginLayerView layer={l} />
    </div>
  );
}
```

Samma sak görs förebyggande för `line`-wrappern i kund-editorn (rad 322–328) — kunden ska aldrig kunna interagera med linjer ändå (admin-låsta).

### 2. Linje-rotation: bevara längd vid byte horisontell ↔ vertikal

**Rotorsak**: I `LayerInspector.tsx` byter orientation-kontrollen bara `defaults.orientation`, vilket gör att en bred-och-låg box blir en bred-och-låg vertikal linje (= nästan ingen längd).

**Fix**: I `LayerInspector.tsx`, vid orientation-ändring för line-lager: swappa `wPct`/`hPct` och justera `xPct`/`yPct` så att linjens centrum ligger kvar:

```ts
const newW = layer.hPct;
const newH = layer.wPct;
const newX = layer.xPct + (layer.wPct - newW) / 2;
const newY = layer.yPct + (layer.hPct - newH) / 2;
// Klampa till [0, 100 - storlek] för att undvika out-of-bounds
onChange({
  ...layer,
  xPct: clamp(newX, 0, 100 - newW),
  yPct: clamp(newY, 0, 100 - newH),
  wPct: newW,
  hPct: newH,
  defaults: { ...layer.defaults, orientation: nextOrientation },
});
```

### 3. Ångra-knapp i admin-designern

**Var**: `src/pages/admin/DesignerPage.tsx`.

**Hur**:
- En `useRef<Template[]>([])` lagrar tidigare versioner av `template`. Sessionsbaserad → försvinner vid sidladdning (precis som du vill).
- En wrapper `commitTemplate(next)` används istället för direkt `setTemplate` på alla mutator-paths (`setLayers`, orientation-ändringar via `setTemplate({...template, productOptions})` etc.). Den pushar nuvarande `template` till stacken (med en cap på t.ex. 50 steg) och sätter sen den nya.
- En `undo()`-funktion poppar senaste och `setTemplate(prev)`.
- En `Ångra`-knapp i headern (mellan "Visa som kund" och "Spara draft") med `Undo2`-ikon från `lucide-react`. Disabled när stacken är tom. Cmd/Ctrl+Z keyboard shortcut som bonus.

```tsx
const historyRef = useRef<Template[]>([]);
const [canUndo, setCanUndo] = useState(false);

function commitTemplate(next: Template) {
  if (template) {
    historyRef.current.push(template);
    if (historyRef.current.length > 50) historyRef.current.shift();
    setCanUndo(true);
  }
  setTemplate(next);
}

function undo() {
  const prev = historyRef.current.pop();
  if (!prev) return;
  setTemplate(prev);
  setCanUndo(historyRef.current.length > 0);
  setSelectedId(null); // valt lager kan vara raderat i föregående state
}
```

Alla befintliga anrop till `setTemplate(...)` i `DesignerPage.tsx` (inkl. `setLayers`-helpern) byts till `commitTemplate(...)`.

### Filer som ändras
- `src/components/editor/MapPreview.tsx` — pointer-events fix för margin (+line) wrapper
- `src/components/admin/LayerInspector.tsx` — line-orientation swap-logik
- `src/pages/admin/DesignerPage.tsx` — undo stack + knapp + keyboard shortcut

Säg **kör** så implementerar jag i ordning: marginal-fix → linje-rotation → ångra.
