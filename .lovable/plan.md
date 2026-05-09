## Roten till problemet

`expandConsolidatedConfig` skapar 4 virtuella `ProductConfig` med **samma** `shopify_handle` (skillnaden är bara `product_type`). Format-togglen i `src/components/editor/FormatSection.tsx` använder dock `shopify_handle` som diskriminator:

```ts
active: c.shopify_handle === activeHandle   // sant för ALLA fyra
onClick={() => onProductChange(e.handle)}   // skickar samma handle → noop
```

Resultat: alla fyra knappar markeras aktiva och ingen växling sker.

## Fix

Diskriminera på `product_type` istället för `handle`. Hela editor-flödet redan vet om typen via `config.product_type` och URL-parametern `?type=`.

### Filer

**`src/components/editor/FormatSection.tsx`**
- Ny prop: `activeProductType: ProductType` (ersätter `activeHandle` för aktiv-markering).
- Ny prop: `onProductChange: (handle: string, productType: ProductType) => void`.
- Bygg `toggleEntries` med `productType` som nyckel; sätt `active: c.product_type === activeProductType`.
- Skicka `(c.shopify_handle, c.product_type)` i onClick.

**`src/components/editor/ControlPanel.tsx`**
- Vidarebefordra de nya prop-typerna oförändrat.

**`src/pages/EditorPage.tsx`**
- `onProductChange(newHandle, newType)` ska:
  - Hitta nästa virtuella config: `configs.find(c => c.shopify_handle === newHandle && c.product_type === newType)`.
  - Sätta URL-param `type=<newType>` (mappa `posters→poster`, `aluminum→aluminum`, `acrylic→acrylic`, `canvas→canvas` enligt befintlig konvention för `?type=`).
  - `setConfig(next)` så `EditorStore.product_type` byts → variant/storlek/layout-källor reagerar som idag.
- Skicka `activeProductType={config.product_type}` till `<ControlPanel>`.

### Vad som inte ändras
- `expandConsolidatedConfig` och `loadAllConfigs` — fortsätter ge 4 virtuella configs (krävs för att FormatSection ska kunna lista alla typer).
- `resolveShopifyVariantId` — tar redan `productType` som tredje axel.
- Add-to-cart, sizes, variants, prismotor — oförändrade.

### Verifiering
1. Öppna `/editor?handle=skapa-fordonsposter` → endast en typ markerad.
2. Klick på "Canvas" → URL får `?type=canvas`, layout/varianter byter, endast Canvas markerad.
3. Lägg i varukorg → rätt Shopify-variant matchar (Produkttyp + Storlek + Utförande).
