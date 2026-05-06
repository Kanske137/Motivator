## Mål
1. Översätt allt som fortfarande visas på svenska (ramnamn, mockup-thumbnail-labels m.fl.).
2. Fixa valutan så att summan stämmer exakt med Shopifys konverterade pris (just nu visas SEK-talet med fel valutasymbol = `rate` saknas/är 1).

---

## Del 1 — Kvarvarande oöversatta texter

Efter genomgång hittades dessa hårdkodade svenska strängar:

**A. Ramvarianter (Ingen / Vit / Svart / Ek / Valnöt / Hängare …)**
- Datakällan (`src/lib/pricing.ts`, `product-config.ts`) MÅSTE behålla svenska nycklar — de används som ID mot Shopify-varianter, Gelato SKU-mappning och pris-tabeller. Vi översätter bara *visningen*.
- Lägg till en `frameVariantLabel(name, t)`-helper i `src/lib/format-price.ts` (eller ny `src/lib/variant-labels.ts`) som mappar svenska variantnamn → i18n-nyckel:
  - `Ingen` → `frame.none`
  - `Vit` → `frame.white`, `Svart` → `frame.black`, `Ek` → `frame.oak`, `Valnöt` → `frame.walnut`
  - `Hängare Vit/Svart/Ek/Valnöt` → `frame.hangerWhite/Black/Oak/Walnut`
  - Canvas djup `2 cm` / `4 cm` → `format.depthValue` med `{cm}`
- Använd helpern i:
  - `FormatSection.tsx` (FrameOption `name` + dropdown-summary)
  - `EditorPage.tsx` (`summary` raden + `Lagt till i varukorgen`-toast)
  - `CartDrawer.tsx` om variantnamn visas där
  - `FrameOption.tsx` `aria-label` / unavailableLabel ("Ej tillgänglig" → `frame.unavailable`)

**B. Mockup-thumbnail-labels** (`src/lib/mockup-scenes.ts`)
- "Vardagsrum / Sovrum / Kontor / På vägg" är hårdkodade.
- Behåll `id` som datanyckel; flytta `label` → `labelKey: "scene.livingroom"` osv. och låt `MockupGallery.tsx` köra `t(scene.labelKey)`.

**C. Produktdetalj-bilder** (`src/components/editor/product-details.ts`)
- "Pappersdetalj / Ramval / Hörndetalj / Baksida & upphängning / Kantdetalj / Montering / Skruvhörn" — samma mönster: byt `label` → `labelKey` (`detail.posterPaper` etc.) och översätt i komponenten.

**D. Toasts / fallback-meddelanden**
- `EditorPage.tsx`: `"Kunde inte förbereda tryckfil"`, `"Okänt fel"`, `"Lagt till i varukorgen"`, `"Den här kombinationen är inte tillgänglig …"` → flytta till `toast.*`-nycklar.
- `FrameOption.tsx`: `"Ej tillgänglig"` default.

**E. Översättningsfiler**
- Lägg till alla nya nycklar i alla 11 språk (`sv` är källa).

---

## Del 2 — Korrekt valutakonvertering (matchar Shopify exakt)

### Problem
Just nu visas `199 €` istället för t.ex. `17,90 €`. Det betyder att `rate` som temat skickar är `1` (eller saknas helt), så `formatPrice` bara byter symbolen utan att räkna om.

Att förlita sig på `cart.currency.rate` i Liquid är bräckligt — det fältet är inte alltid satt och avrundar inte exakt som Shopifys storefront-rendering. Den enda källan som *garanterat* ger samma siffra som kassan är **Storefront API med `@inContext(country: …)`**.

### Lösning: hämta priset direkt från Shopify per produkt

1. **Behåll SEK-tabellen som intern källa** för Gelato-marginaler — ingen ändring i `pricing.ts`.
2. **Ny hook `useShopifyVariantPrice(variantGid, country)`** som anropar Storefront API:
   ```graphql
   query($id: ID!, $country: CountryCode!) @inContext(country: $country) {
     node(id: $id) { ... on ProductVariant { price { amount currencyCode } } }
   }
   ```
   Returnerar `{ amount, currencyCode }` i kundens valuta — exakt samma värde som Shopify visar i kassan.
3. **Ny store-utility `useDisplayPrice()`**:
   - Om en `shopifyPrice` finns för aktiv variant → visa den som-den-är.
   - Annars (admin-läge, okonfigurerad variant, första laddning) → fall tillbaka på `formatPrice(sekAmount, ctx)` som idag.
4. **För pris-deltan** ("+99 kr" mellan storlekar/ramar): hämta priser för alla synliga varianter i ett enda batch-query när storleks-/ram-väljaren öppnas, och räkna delta i kundens valuta. Cache:a per `(handle, country)` i en Zustand-map så vi inte spammar API:et.
5. **Add-to-cart-knappens summa** + **mobile sticky-bar** + **storleks-/ram-dropdownen** i `FormatSection` läser från samma hook → garanterad konsistens med Shopify.

### Theme-snippet
- Behåll `country` och `locale` i query-params (de behövs för i18n och Storefront-context).
- `currency` och `rate` blir då rena fallbacks för admin-läge — behöver inte ändras i temat.

### Edge-cases
- Om Storefront-anropet failar → fallback till SEK×1 (ctx.rate=1) + visa konsoll-varning.
- När `country` ändras via `SHOP_CONTEXT` postMessage → invalidera price-cache och refetch.

---

## Tekniska detaljer

**Filer som ändras:**
- `src/lib/variant-labels.ts` (ny)
- `src/lib/mockup-scenes.ts` — `label` → `labelKey`
- `src/components/editor/product-details.ts` — `label` → `labelKey`
- `src/components/editor/MockupGallery.tsx` — `t(s.labelKey)`
- `src/components/editor/FormatSection.tsx` — översätt variantnamn + djup
- `src/components/editor/FrameOption.tsx` — översätt fallback-text
- `src/pages/EditorPage.tsx` — översätt toasts + summary
- `src/i18n/locales/*.json` (alla 11) — nya nycklar
- `src/hooks/useShopifyDisplayPrice.ts` (ny) — Storefront-prisanrop med `@inContext(country)`
- `src/stores/shopContextStore.ts` — liten cache-map för pris per `(variantId, country)`
- `src/lib/format-price.ts` — `formatMoneyFromShopify({amount, currencyCode}, locale)` helper

**Inga ändringar i:**
- `pricing.ts` (SEK-källan)
- `product-config.ts` variantnamn
- Gelato SKU-mappning
- Theme-snippet (förutom om du redan tagit bort `rate`-fältet är det OK)

**Verifiering:**
- Öppna editorn med `?country=DE&locale=de` → priserna i dropdownen + knappen ska matcha priset på samma produkt på `/en-de/products/...` i butiken.
- Byt ram → delta uppdateras i EUR.
- Switch:a tillbaka till SE → SEK med decimaler enligt SEK-konvention (heltal).
