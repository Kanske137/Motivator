## Varför bara "personlig-karta" fungerar

Tre orsaker samverkar — alla i appkoden, inget i temat:

### 1. Pris-kartan hoppar över nya admin-mallar
`useShopifyPriceMap()` bygger sina (storlek, variant)-kombinationer från `config.sizes`. Nya admin-byggda mallar (X-poster, testglas, testalu, akryl m.fl.) har tom `sizes` — storlekarna kommer från `productOptions` × prislistor via `getEffectiveSizes()`. Resultat: `combos = []`, vi frågar aldrig Shopify och `priceFromMap` returnerar alltid `null`. Endast "personlig-karta" har den gamla `sizes`-arrayen ifylld → därför är det den enda som visar Shopify-priset/valutan.

### 2. Fallback-formatteraren tvingar SEK-symbol
När live-priset saknas faller vi tillbaka på `formatPrice(currentPrice(), shopCtx)`. Den har en "säkerhetsnät"-rad som tvingar valutan till SEK när `rate=1`, även om kunden har EUR/USD. Det är därför valutasymbolen inte ändras längre — fallbacken är aktiv för alla mallar utom "personlig-karta".

### 3. Handle-mismatch ger tyst fallback
Om en mall i admin har ett `shopify_handle` som inte finns som produkt i Shopify (eller har andra variant-/storleksnamn) returnerar Storefront API tom data utan fel. Vi måste logga detta tydligt så vi ser exakt vilka mallar som saknar Shopify-koppling.

---

## Åtgärd

1. **`src/hooks/useShopifyPriceMap.ts`** — bygg `combos` från `getEffectiveSizes(config, productOptions)` istället för `config.sizes`. Då fungerar Shopify-priser för alla mall-typer (poster/canvas/aluminium/akryl/glas).

2. **`src/lib/format-price.ts`** — ta bort tvångskonverteringen till SEK när `rate=1`. Visa istället beloppet i kundens valuta med rätt symbol; konvertering hanteras av Shopify-priserna när de finns.

3. **`src/lib/shopify-prices.ts`** — lägg till en `console.info` när `productByHandle` returnerar `null` (handle saknas i Shopify) och när varianter inte matchas på (size, variant), så vi snabbt kan se varför en specifik mall inte får live-pris.

4. **Verifiering**
   - Öppna en av de "trasiga" mallarna i editorn → bekräfta i konsolen att vi nu fetchar priser och att rätt valutasymbol visas.
   - Kontrollera att "personlig-karta" fortfarande visar identiska priser med kassan.
   - Om någon mall fortfarande saknar pris → loggen säger om handle eller variantnamn är boven, och då vet vi vilken admin-konfig som behöver synkas till Shopify.

Inga ändringar i temat, databasen eller `pricing.ts`.