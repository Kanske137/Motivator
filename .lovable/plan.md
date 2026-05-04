# Hängare som del av Ram-varianten i Shopify-sync

## Problem
När mallen "X - poster" syncas till Shopify skapas bara de 5 ursprungliga ram-värdena (Ingen, Vit, Svart, Ek, Valnöt). De fyra hängar-värdena (Hängare Vit, Hängare Svart, Hängare Ek, Hängare Valnöt) saknas — så kunder kan se dem i editorn men inte lägga dem i varukorgen (variant-resolvern hittar ingen matchning).

## Rotorsak
Sync-funktionen `plan()` i `supabase/functions/shopify-sync-template/index.ts` itererar exakt över `template.productOptions.poster.allowedFrames`. Befintliga mallar i databasen sparades **innan** hängare lades till i `getPosterFrames()`, så deras `allowedFrames` innehåller bara de 5 ursprungliga ramarna. Hängarna planeras aldrig och skickas aldrig till Shopify.

Pris-tabellen (`POSTER_PRICES`) och SKU-mapen (`gelato-sku-map.json`, både i `src/lib/` och `supabase/functions/_shared/`) innehåller redan korrekt data för alla fyra hängare i storlekarna 21x30 → 70x100. Endast plan-/sync-steget måste justeras.

## Lösning

### 1. Garantera fullständig ram-lista i sync (`shopify-sync-template/index.ts`)
I `plan()`, för poster-blocket: slå ihop `opts.poster.allowedFrames` med en kanonisk lista (Ingen, Vit, Svart, Ek, Valnöt, Hängare Vit, Hängare Svart, Hängare Ek, Hängare Valnöt) och deduplicera, så att hängarna alltid inkluderas oavsett vad som råkar ligga i den sparade mallen.

Detta är det minst invasiva ingreppet och påverkar bara poster (canvas/aluminum/acrylic lämnas orörda). Eftersom `plan()` redan hoppar över storlek/variant utan SKU eller pris, hamnar 13×18-hängare inte med (saknar SKU) — vilket är önskat beteende.

### 2. Säkerställ option-värden uppdateras innan variants skapas
`syncProductOptions()` lägger redan till saknade värden via `productOptionUpdate` med `optionValuesToAdd`. Med fix 1 kommer de fyra hängar-värdena nu finnas i `desiredByOption["Ram"]` och läggas till på den befintliga Shopify-produktens "Ram"-option innan `productVariantsBulkCreate` körs. Ingen kodändring behövs här utöver fix 1.

### 3. Uppdatera defaults för nya mallar (`CreateTemplateDialog.tsx`)
`DEFAULT_PRODUCT_VARIANTS.poster.frames` använder redan `getPosterFrames()` som läser från SKU-mapen och därför **redan** inkluderar alla fyra hängare. Nya mallar är alltså korrekta. Verifiering räcker — ingen kodändring.

### 4. Befintliga mallar i databasen
För den redan sparade "X - poster"-mallen — efter fix 1 räcker det att klicka "Synka mall" igen. Sync-funktionen kommer själv att:
- Lägga till hängar-värdena på Shopifys "Ram"-option
- Bulk-skapa de fyra nya varianterna per storlek (21×30 t.o.m. 70×100) med rätt SKU och pris

Inget behov av databas-migration eller manuell mall-redigering.

## Filer som ändras
- `supabase/functions/shopify-sync-template/index.ts` — utöka poster-grenen i `plan()` så att `allowedFrames` alltid kompletteras med den kanoniska hängar-listan.

## Verifiering efter implementation
1. Synka "X - poster" från admin.
2. I Shopify Admin: produkten ska nu ha t.ex. 5 storlekar × 9 ram-värden − skipped = ~41 varianter (5 ramar i 13×18 + 9 ramar × 5 större storlekar).
3. I editorn: klicka på "Hängare Ek" på 30×40 och verifiera att "Lägg i varukorg" fungerar (variant-resolvern hittar nu matchning).
