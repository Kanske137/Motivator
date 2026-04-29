## Mål
Texten "© Mapbox · © OpenStreetMap" under kundeditorns preview ska bara visas när den aktiva mallen faktiskt innehåller ett kartlager. För mallar utan karta (t.ex. rena foto- eller AI-mallar) döljs raden helt.

## Ändring

**Fil:** `src/components/editor/MapPreview.tsx` (rad 521)

Inom samma komponent finns redan tillgång till `template` via `useEditorStore`. Vi beräknar om mallen har minst ett lager av typ `map` och rendrar `<p>`-raden villkorligt.

```tsx
const hasMapLayer = useMemo(
  () => (template?.layers ?? []).some((l) => l.type === "map"),
  [template]
);

// ...
{hasMapLayer && (
  <p className="text-[10px] text-muted-foreground">© Mapbox · © OpenStreetMap</p>
)}
```

Om `template` redan finns i scope (vilket den gör i MapPreview) använder vi den direkt; annars hämtas den via `useEditorStore((s) => s.template)`.

## Påverkan
- Ingen ändring i admin-vyn eller snapshot/print-pipelinen.
- Ingen ändring av attribution när minst ett kartlager finns — beteendet är oförändrat för befintliga kartmallar.
