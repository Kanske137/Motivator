## Problem

Wrap-front-markören och margin-lagret använder `zIndex: 9998–10000`, vilket är högre än shadcn-overlays (Dialog, Sheet, Popover, Dropdown — alla `z-50`). Resultat: streckade linjer och margin syns ovanpå modaler, menyer och förstorade preview-bilder.

## Fix

Sänk till säkra värden under 50, men över editorns layer-z-index (typiskt 1–20):

### `src/components/editor/MapPreview.tsx`
- Margin-lager: `zIndex: 9999` → `40`
- Move-handle på lager: `zIndex: 9998` → `39`
- Front-zon ram: `zIndex: 9999` → `41`
- Front-zon label: `zIndex: 10000` → `42`

### `src/components/admin/LayerCanvas.tsx`
- Wrap-skuggband: `zIndex: 9998` → `40`
- Front-zon ram: `zIndex: 9999` → `41`
- "Synlig framsida"-label: `zIndex: 10000` → `42`

Ingen visuell förändring inom editorytan — bara att modaler/menyer/lightbox (z-50) nu hamnar ovanpå som förväntat.
