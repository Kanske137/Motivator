# Konsoliderad produkt-per-mall (Shopify)

## Mål
En **Shopify-produkt per mall** istället för upp till 4 separata. All produkttyp-/storleks-/ramval blir varianter på samma produkt. Endast **nya** mallar använder det nya flödet — befintliga mallar och deras Shopify-produkter rörs inte.

## Shopify-modellen

Varje konsoliderad produkt får exakt 3 options:

| # | Namn | Värden |
|---|------|--------|
| 1 | Produkttyp | Poster, Canvas, Metallposter, Plexiglas (endast aktiverade) |
| 2 | Storlek | Alla aktiva storlekar (union över aktiverade produkttyper) |
| 3 | Utförande | Ram (Vit/Ek/Valnöt/Svart/Ingen) + Hängare (Ek/Valnöt/Svart/Vit) + Djup (2 cm/4 cm) + "Standard" |

**Viktigt:** vi genererar bara **giltiga** kombinationer per produkttyp — Shopify kräver inte hela kartesiska produkten:

- Poster → endast ram-/hängar-utföranden, alla aktiva poster-storlekar
- Canvas → endast djup-utföranden (2 cm/4 cm), alla aktiva canvas-storlekar
- Metallposter / Plexiglas → endast utförande "Standard", respektive storleksset

Det håller varianträkningen långt under 100 (typiskt ~40–60).

**Titel & handle:** endast mallnamnet (`Stjärnhimmel` → handle `stjarnhimmel`). Inget `-poster` / `-canvas`-suffix.

## Datamodell (Supabase)

Idag ligger en rad i `product_configs` per (mall × produkttyp). Vi inför ett **mall-läge**:

- Ny kolumn `product_configs.is_consolidated boolean default false`
- Ny kolumn `product_configs.enabled_product_types text[] default '{}'` (vilka produkttyper mallen säljer)
- För konsoliderade mallar: **en enda rad** per mall. `product_type` blir `'multi'` (befintliga `'posters'|'canvas'|'aluminum'|'acrylic'`-rader berörs inte).
- `gelato_sku_map` utökas så nycklar är `"<productType>|<size>|<variant>"` istället för bara `"<size>|<variant>"`.
- `sizes` / pricing fortsätter ligga i `pricing.ts` per produkttyp; den konsoliderade raden refererar bara `enabled_product_types`.
- `shopify_sync_state` får 1 rad per konsoliderad mall (en `shopify_product_id`).

Befintliga rader och deras synkstatus förblir orörda → ingen migration av data.

## Admin/Designer

**Designern (`/admin/designer/:slug`)** får ett nytt val överst i sidofältet bredvid Stående/Liggande:

```
Visningsläge:  [ Standard ]  [ Canvas ]
```

- **Standard-läge** styr layout för Poster / Metallposter / Plexiglas (identisk designyta).
- **Canvas-läge** styr layout/wrap för Canvas (samma funktionalitet som idag).
- Plexi-hörnpluppar är ren overlay i kundens editor när Plexiglas är vald variant — påverkar inte admin-designen.
- Toggle visas bara om mallen har minst en standard-typ + canvas aktiverad; annars döljs den.

**Mall-skapande (`CreateTemplateDialog`)** byter `Produkttyp`-väljaren mot multi-select med checkboxar:

```
☑ Poster   ☑ Canvas   ☐ Metallposter   ☐ Plexiglas
```

Minst en måste väljas. Detta sätter `enabled_product_types` och `is_consolidated = true`.

**`ProductOptionsSection`** visar fortsatt en flik per aktiverad produkttyp där admin väljer tillåtna storlekar + ramar/djup/material, precis som idag.

## Editor (kundsidan)

`FormatSection` har redan ett "Produkt"-toggle — vi återanvänder det:

- Läser `enabled_product_types` från konsoliderade mallen
- Vid byte av produkttyp ändras storleks-/utförande-listorna men handle förblir samma
- Variant-resolver matchar på 3 selectedOptions (`Produkttyp`, `Storlek`, `Utförande`) istället för 2
- Hängare och djup förblir samma data-id som idag (svensk källa) — bara att de nu lever i samma Shopify-option

## Sync till Shopify (`shopify-sync-template`)

Edge-funktionen får en gren när `is_consolidated = true`:

1. Bygg variant-listan genom att iterera `enabled_product_types`, för varje typ generera `(storlek × utförande)` enligt admin-tillåtna val + Gelato-SKU finns
2. Skapa/uppdatera **en** Shopify-produkt med 3 options
3. SKU-mapping: `gelato_sku_map["<type>|<size>|<variant>"]` → variantens SKU
4. Order-webhook (`shopify-order-webhook`) läser produkttyp från `selectedOptions` istället för från handle-suffix
5. "Saknade SKU"-varningen i UI räknar nu per (type, size, variant)-tripel

## Tekniska noter

- `deriveTemplateSlug()` kan slopas för konsoliderade mallar — handle = slug direkt
- `getEffectiveSizes()` får ny signatur som tar `productType`-arg när vi är i konsoliderat läge
- Variant-resolver-cache nyckel blir `handle|size|utförande|produkttyp`
- Liquid-temat behöver inget ändras — varianter visas redan via `selectedOptions`
- Befintliga, gamla per-typ-produkter fortsätter fungera oförändrat och syns i admin som tidigare

## Vad lämnas orört
- Alla redan synkade mallar/produkter
- Pricing-tabeller (`pricing.ts`) — fortsätter vara källa per produkttyp
- 3D-canvas, AI-flöden, kart-renderare, mockups
- Cart-sync, print-pipeline och Gelato-fulfillment (utöver SKU-lookup-uppdatering)
