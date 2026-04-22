

## Mellansteg: Fixar för admin-config (innan kund-editor-refaktor)

### Var vi är i övergripande planen

Fas 1 punkt 1–4 är klara (DB, schema, admin scaffolding). **Detta mellansteg slutför Fas 1 punkt 1–4 ordentligt** innan vi går vidare till **Fas 1 punkt 5–6** (kund-editor-refaktor + snapshot-pipeline).

Två av punkterna fanns redan i ursprungsplanen (skapa ny mall, mall-thumbnails) men är inte byggda än. Två är genuina bugfixar/UX-fixar som behövs nu (variant-toggle, lager-preview).

### Det som ska göras nu

#### 1. Skapa nya mallar från `AdminConfigs`
- "Skapa ny mall"-knapp i headern → `CreateTemplateDialog` (titel, auto-slug-handle, seed-typ Poster/Canvas/Båda).
- INSERT i `product_configs` med standard `sizes`, `map_styles`, `text_config`, tomt `gelato_sku_map`, tomt `template`. Migration lägger till INSERT/UPDATE-policy (öppen tills vi har auth, TODO-kommentar).
- Redirect till `/admin/designer/<handle>`.

#### 2. Tomt-läge i `DesignerPage`
- När `layers.length === 0` → visa stor "Tomt — börja här"-zon ovanpå canvasen med "Skapa standardlayout"-knapp.
- `createDefaultLayout()` i `layer-utils.ts` genererar karta (centrum, 60% höjd) + text under (15% höjd) — speglar dagens kund-default.

#### 3. ProductOptions: defaults per produkttyp (bugfix)
- Ny fil `src/lib/product-defaults.ts` med `DEFAULT_PRODUCT_VARIANTS`:
  - Poster: sizes `13x18, 21x30, 30x40, 50x70, 70x100` · frames `Ingen, Vit, Svart, Ek, Valnöt`
  - Canvas: sizes `30x40, 50x70, 60x90, 70x100` · depths `2cm, 4cm`
- `ProductOptionsSection` slår ihop config-faktiska + defaults per typ. Info-banner: "🛈 Standardvarianter visas — Gelato-SKU saknas tills du fyller i `gelato_sku_map`."
- Publicerings-validering hindrar fortfarande publicering om vald size saknar SKU-mapping.

#### 4. Riktig lager-preview i admin-canvas
- **Map-lager** → `MapLayerPreview.tsx`: Mapbox **static-image** (`/styles/v1/<style>/static/<lng>,<lat>,<zoom>/300x300`) med SVG `clipPath` för shape (rect/circle/heart/square). Token via ny `useMapboxToken`-hook (React Query, cachar `get-mapbox-token` edge-anrop).
- **Text-lager** → `TextLayerPreview.tsx`: faktisk `defaults.text` med `font`, `fontSizePct` (av lagrets höjd), `align`, `color`. Fallback "TEXT".
- **Image-lager** (Fas 2-prep): `defaults.url` om satt, annars upload-placeholder.
- **Line/margin**: tunn färgad border som speglar `thicknessMm`.
- Lager-namnet flyttas till liten tag i övre vänstra hörnet, syns endast vid select/hover.

#### 5. Mall-thumbnails i `AdminConfigs` (planpunkt 10)
- Auto-genererad mini-thumbnail per kort baserad på `template.defaultLayout.portrait` (samma rendering-stack som `LayerCanvas`, men icke-interaktiv och 120×160 px). Visar verklig preview av kartcentrum + text.

### Filer

| Fil | Ändring |
|---|---|
| `supabase/migrations/<ts>_product_configs_admin_policies.sql` | INSERT + UPDATE-policy på `product_configs` (öppen, TODO-kommentar för auth) |
| `src/pages/AdminConfigs.tsx` | "Skapa ny mall"-knapp + thumbnails |
| `src/components/admin/CreateTemplateDialog.tsx` (ny) | Dialog + INSERT |
| `src/components/admin/TemplateThumbnail.tsx` (ny) | Liten icke-interaktiv preview för korten |
| `src/lib/product-defaults.ts` (ny) | `DEFAULT_PRODUCT_VARIANTS` |
| `src/components/admin/ProductOptionsSection.tsx` | Merge config + defaults; info-banner |
| `src/pages/admin/DesignerPage.tsx` | Tomt-läge + "Skapa standardlayout"-knapp |
| `src/lib/layer-utils.ts` | `createDefaultLayout()` |
| `src/components/admin/LayerCanvas.tsx` | Använder nya preview-komponenter; flyttar namn-tag |
| `src/components/admin/MapLayerPreview.tsx` (ny) | Static Mapbox + SVG clipPath |
| `src/components/admin/TextLayerPreview.tsx` (ny) | Renderar faktisk text |
| `src/hooks/useMapboxToken.ts` (ny) | React Query-hook, cachar token |

### Verifiering

1. `/admin/configs` → "Skapa ny mall" → "Test Stockholm" + "Båda" → redirect till designer. ProductOptions visar både poster (5 sizes/5 frames) och canvas (4 sizes/2 djup) från defaults.
2. Befintlig poster-mall → toggla canvas → får canvas-defaults (inte poster-data).
3. Tom orientation → "Skapa standardlayout"-knapp → karta + text dyker upp.
4. Karta-lager visar verklig Mapbox-bild av Stockholm i vald form. Text-lager visar "STOCKHOLM" i vald font/färg.
5. `/admin/configs` visar verkliga thumbnails per mall.

### Direkt efter detta mellansteg

Fortsättning på **Fas 1 punkt 5–6** i ursprungsplanen:
- Kund-editor-refaktor: `editorStore.layerValues`, `MapLayer`/`TextLayer`-runtime-komponenter, `MapPreview` loopar lager i zIndex-ordning, `FormatSection` filtrerar via `productOptions`.
- Snapshot-pipeline: `renderArtworkSnapshot(template, layerValues)`, sekventiell map-render.

