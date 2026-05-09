## Problem

När du skapade "Skapa fordonsposter" lades **endast 1 rad** in i `product_configs` (med `is_consolidated=true`, `product_type='multi'`, `enabled_product_types=['posters','canvas','aluminum','acrylic']`). Edge-funktionen synkade också korrekt **1 Shopify-produkt** med 76 varianter (se loggen: `[sync] multi existing=1 toCreate=75`).

Det som ser ut som 4 mallar är bara hur listan renderas. `AdminConfigs.tsx` anropar `loadAllConfigs()` som internt kör `expandConsolidatedConfig()` och returnerar **en virtuell rad per produkttyp** (poster/canvas/aluminum/acrylic). Det gjordes för att editor-/kund-routes (`/p/<slug>-poster`) skulle fungera oförändrat, men admin-listan ska inte använda den expanderade vyn.

## Lösning

### 1. `src/pages/AdminConfigs.tsx`
- Byt `loadAllConfigs()` → `loadAllConfigsRaw()` så listan visar en rad per DB-post.
- Visa `enabled_product_types` som badges på kortet när `is_consolidated`.
- Status/synk-indikator (Shopify-produkt-id, antal varianter, "Senast synkad") läses från `shopify_sync_state` på `product_config_id` (inte längre per-typ).
- "Öppna designer"-länken ska peka på `/admin/designer/<template_slug>` (utan `-poster`-suffix). Verifiera att DesignerPage redan hanterar konsoliderade slugs (det gör den enligt tidigare arbete med `designMode`-toggle).

### 2. Ev. andra ställen som listar/räknar mallar
Sök efter `loadAllConfigs(` i `src/` och avgör per förekomst om den ska byta till `loadAllConfigsRaw()`. EditorPage MÅSTE fortsätta använda den expanderade varianten (kunden navigerar fortfarande via `/p/<slug>-poster`).

### 3. Ingen DB-migration eller edge-funktion behöver röras
Datat är redan korrekt. Det här är rent en presentationsfix i admin.

## Vad jag INTE rör
- `expandConsolidatedConfig` och kund-/editor-flödet — det bygger på virtuella slugs och fungerar.
- `shopify-sync-template` — synkar redan rätt (1 produkt, 76 varianter bekräftat i loggen).
- Befintliga icke-konsoliderade mallar — visas som idag (en rad var).

## Verifiering efter implementation
1. Ladda `/admin/configs` → "Skapa fordonsposter" syns som **en** rad med 4 typ-badges.
2. Klick på den öppnar `/admin/designer/skapa-fordonsposter` med Standard/Canvas-toggle.
3. Shopify-admin: en produkt med 76 varianter (redan bekräftat i edge-loggen).
