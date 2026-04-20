

# Ombyggnad: Config-drivet editor-system med Mapbox, single-page UX och Shopify iframe-integration

## Sammanfattning

Bygger om editorn från steg-wizard till **Mapiful-inspirerad single-page editor**:
- Live Mapbox-preview + kontrollpanel (sidopanel desktop / bottom sheet mobil)
- Gelato mockup-galleri under preview
- Config-drivet system (Supabase `product_configs`) som renderar UI dynamiskt per produkt
- Shopify iframe-integration via postMessage + auto-injicerad Liquid-template (Admin API)
- Admin-sida i Lovable för visuell layout-design av produktkonfigurationer

## Del 1 — Datamodell

**Ny tabell** `product_configs`:

```sql
CREATE TABLE public.product_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_handle text UNIQUE NOT NULL,
  title text NOT NULL,
  product_type text NOT NULL,                -- 'posters' | 'canvas'
  layouts jsonb NOT NULL DEFAULT '{}',       -- portrait + landscape layer-definitioner
  map_styles jsonb NOT NULL DEFAULT '[]',    -- tillåtna Mapbox style-IDs
  text_config jsonb NOT NULL DEFAULT '{}',   -- fonts, max chars, position
  sizes jsonb NOT NULL DEFAULT '[]',         -- storlekar + variants + priser
  gelato_sku_map jsonb NOT NULL DEFAULT '{}',-- size|variant → orientation → UID
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.product_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read configs" ON public.product_configs FOR SELECT USING (true);
```

Seed: två konfigurationer (poster + canvas) baserade på nuvarande `pricing.ts` och `gelato-sku-map.json`.

## Del 2 — Mapbox

Klient: `mapbox-gl` med stilar `light-v11`, `dark-v11`, `outdoors-v12`, `satellite-v9`, `streets-v12`, `navigation-night-v1`. Geocoding för platssök.

Secrets som promptas: `MAPBOX_PUBLIC_TOKEN` (klient) + valfri `MAPBOX_SERVER_TOKEN` (edge function).

## Del 3 — Single-page editor

**Desktop (≥768px)**:
```text
┌────────────────────────────┬──────────────────┐
│                            │  KONTROLLPANEL   │
│     LIVE KART-PREVIEW      │  ▸ Format        │
│     (Mapbox + text         │    (Poster/Canvas│
│      overlay + ram CSS)    │     Storlek      │
│                            │     Ram/Djup     │
│                            │     Orientering) │
│                            │  ▸ Plats         │
│                            │  ▸ Kartstil      │
│                            │  ▸ Text          │
│                            │  ─────────────   │
│                            │  PRIS + KÖP      │
├────────────────────────────┴──────────────────┤
│  MOCKUP-GALLERI (Gelato, horisontell scroll)  │
└───────────────────────────────────────────────┘
```

**Mobil (<768px)**: Preview överst (~50%), kontrollpanel scrollbar under, mockup-galleri nedanför, sticky bottom-bar med pris + "Lägg i varukorg".

**Kontrollpanelens flikar/sektioner** (Accordion):
1. **Format** — *en samlad flik*: Produkt (Poster/Canvas-toggle) → Storlek → Ram (poster) eller Djup (canvas) → Orientering. Allt här uppdaterar pris och Gelato-UID i realtid.
2. **Plats** — adress-sök (Mapbox Geocoding), zoom-slider
3. **Kartstil** — 6 visuella thumbnails
4. **Text** — input + font-val + visa/dölj-toggle

Att växla Poster ↔ Canvas behåller karta/plats/text/stil och nollställer bara storlek/variant till första giltiga.

**Komponenter**:
- `MapPreview` — Mapbox canvas + HTML text-overlay + ram/border CSS
- `ControlPanel` — accordion med 4 sektioner ovan
- `FormatSection` — sub-komponent för den samlade Format-fliken
- `MockupGallery` — Gelato mockups (4-6) som horisontell scroll
- `EditorPage` — laddar config från `?handle=...`

## Del 4 — Shopify iframe-integration

**Editor-sida**: URL `/editor?handle=personlig-karta-poster`. "Lägg i varukorg" skickar `postMessage` till parent:

```js
window.parent.postMessage({
  type: 'ADD_TO_CART',
  variantId: '...',
  properties: {
    Orientation, Text, _gelato_uid, _print_file_url,
    _map_style, _map_center, _map_zoom
  }
}, '*');
```

**Edge function `shopify-inject-editor`** (Admin API):
1. Skapar `snippets/personlig-karta-editor.liquid` med iframe + postMessage-listener som anropar `/cart/add.js`
2. Skapar/uppdaterar `templates/product.personlig-karta.json` som inkluderar snippet
3. Tilldelar template till de två produkterna

Körs en gång manuellt från admin-sidan.

## Del 5 — Admin-sida `/admin/configs`

- Lista alla `product_configs`
- Visuell layout-editor: drag-resize-rektanglar för placeholders (`map`, `text`, `image`) på en canvas-yta
- Tab för portrait/landscape
- Välj tillåtna kartstilar, fonts, storlekar/priser
- Live preview av hur editorn kommer se ut
- Knapp "Synka till Shopify" → triggar `shopify-inject-editor`

Ingen auth i v1 (kan läggas till senare bakom feature flag).

## Del 6 — Tryckfil-generering

**Edge function `generate-print-file`**:
- Input: map-state (center/zoom/style) + text + storlek
- Mapbox Static Images API → högupplöst karta
- Komposition med text via Deno-canvas
- Upload till `print-files` bucket → returnerar public URL till `_print_file_url`

## Filer

**Nya**:
- `src/pages/EditorPage.tsx`, `src/pages/AdminConfigs.tsx`
- `src/components/editor/MapPreview.tsx`, `ControlPanel.tsx`, `FormatSection.tsx`, `MockupGallery.tsx`, `ConfigLayoutEditor.tsx`
- `src/lib/mapbox.ts`, `src/lib/product-config.ts`
- `src/stores/editorStore.ts` (omskriven, config-driven)
- `supabase/functions/shopify-inject-editor/index.ts`
- `supabase/functions/generate-print-file/index.ts`
- Migration: `product_configs` tabell + seed

**Ändrade**:
- `src/App.tsx` — nya routes `/editor`, `/admin/configs`
- `src/pages/Index.tsx` — landing/redirect
- `package.json` — `mapbox-gl`, `@types/mapbox-gl`

**Borttagna**: alla `src/components/editor/Step*.tsx` och `Editor.tsx` (ersatta).

## Ordning

1. Prompta `MAPBOX_PUBLIC_TOKEN` (+ valfri `MAPBOX_SERVER_TOKEN`)
2. Migration: `product_configs` + seed för båda produkterna
3. Mapbox preview + ControlPanel med samlad Format-flik → fungerande editor
4. MockupGallery (Gelato)
5. Shopify postMessage + cart-flow
6. Edge function `shopify-inject-editor`
7. Edge function `generate-print-file`
8. Admin-sida `/admin/configs`

