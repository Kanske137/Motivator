## Tillägg till "Fri mall"-editorn

Fyra fokuserade förbättringar till `LayersSection` + en validering på CTA.

### 1. Drag-reorder (ersätt upp/ner-knappar)
- Lägg till `@dnd-kit/core` + `@dnd-kit/sortable` (om de inte redan finns; annars använd HTML5 native drag).
- Wrappa `<ul>` i `LayersSection.tsx` med `DndContext` + `SortableContext` (vertikal). Varje rad blir en `useSortable`-item med drag-handle (grip-ikon) till vänster.
- Vid drop: räkna om `zIndex` (överst i listan = högst zIndex). Anropa ny store-action `reorderLayers(orderedIds: string[])` som muterar via `mutateActiveLayoutBlock` och skriver tillbaka zIndex sekventiellt.
- Behåll upp/ner-knapparna som `sr-only` keyboard-fallback? Nej — ersätt helt, men gör drag-handle keyboard-aktiverbar (dnd-kit har inbyggt stöd via `KeyboardSensor`).

### 2. Visibility-toggle
- Alla `TemplateLayer`-instanser har redan en valfri `visible: boolean`-egenskap (default true). Verifieras vid implementation.
- Lägg till en ögon-ikon (Eye / EyeOff) i raden, mellan namn och delete-knappen.
- Ny store-action `setLayerVisible(id, visible)` som muterar layern i aktivt layout-block. Renderpipen (`StaticLayers`, snapshot, print) respekterar redan `visible === false` → dölj då.
- Dolda lager visas i listan med `opacity-50` så det är tydligt.
- Detta gäller både template-lager OCH custom-lager (i motsats till delete som bara funkar på custom).

### 3. Onboarding-tooltip
- Första gången kunden öppnar "Lager"-fliken på en fri mall: visa en popover/tooltip ankrad mot "Lägg till lager"-knappen med kort text (i18n: `layers.onboarding.title` + `layers.onboarding.body` + "Förstått"-knapp).
- Persistens: `localStorage.setItem("freeform-onboarding-seen", "1")` när användaren stänger den. Läs vid mount; visa bara om saknas och `is_freeform === true`.
- Komponent: shadcn `Popover` öppen som default, stängs på klick. Inga ändringar i editorStore.

### 4. Validering: blockera "Lägg i varukorg" vid saknad designkälla
- Definition av "saknad designkälla" på fri mall:
  - 0 lager totalt, ELLER
  - Ingen av lagren har ett "innehåll" (photo utan uploadedUrl, map utan placeName, text med tom sträng, AI-photo utan resultat). Form/line/margin räknas inte som designkälla.
- Lägg en selector i `editorStore`: `hasDesignContent(): boolean`.
- I `EditorPage.tsx`:
  - Beräkna `const canAddToCart = !config.is_freeform || hasDesignContent()`.
  - Skicka `disabled={!canAddToCart}` till `StickyCta` (lägg till prop om den saknas).
  - Vid klick på disabled CTA: visa `toast.error(t("cartAdd.freeformEmpty"))` med hint "Lägg till minst en bild, karta eller text".
- För icke-fria mallar: ingen ändring (befintliga validering oförändrad).

### i18n-nycklar (sv som källa, översätt till en/de/no/da/fi/fr/es/it/nl/pl)
- `layers.dragHandle` ("Dra för att ändra ordning")
- `layers.toggleVisible` / `layers.toggleHidden`
- `layers.onboarding.title` / `layers.onboarding.body` / `layers.onboarding.dismiss`
- `cartAdd.freeformEmpty` / `cartAdd.freeformEmptyHint`

### Filer som ändras
- `src/components/editor/LayersSection.tsx` — drag-reorder, visibility-toggle, onboarding-popover
- `src/stores/editorStore.ts` — `reorderLayers`, `setLayerVisible`, `hasDesignContent`
- `src/components/editor/StickyCta.tsx` — ny `disabled`-prop (om saknas)
- `src/pages/EditorPage.tsx` — koppla validering till CTA
- 11 × `src/i18n/locales/*.json` — nya nycklar
- `package.json` — `@dnd-kit/core` + `@dnd-kit/sortable` (om ej redan installerade)

### Inget rörs
- `freeform-layers.ts`-factory, print-pipeline, template-schema, DB/migrations, Shopify-sync, övriga sektioner i ControlPanel.
