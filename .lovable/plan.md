## Problemet

Valutatecken visas korrekt (t.ex. "€") men beloppet är fel — det är SEK-summan med eurotecken (t.ex. "199 €" istället för "~17 €").

### Rotorsak
Editorn räknar pris i två steg:

1. **Källa A — Shopify Storefront `@inContext(country)`** (via `useShopifyPriceMap` → `getShopifyPrices`): returnerar redan rätt valuta + rätt belopp för marknaden. När detta lyckas visas "displayPrice" korrekt.
2. **Fallback B — intern SEK × rate** (via `formatPrice(sekAmount, shopCtx)`): används när A inte hittar någon variant. Den använder `ctx.rate` som kommer från `cart.currency.rate` i Liquid-snippeten.

Två saker gör att vi hamnar i Fallback B med fel siffra:

- **`cart.currency.rate` i Concept-temat returnerar `1`** för många kunder (Shopify Markets sätter inte alltid en FX-rate i Liquid när marknaden använder "currency conversion" via Markets Pro / inte är fullt aktiverad). → URL-paramen `rate=1` → SEK-beloppet visas oförändrat med fel valutasymbol.
- **Storefront `productByHandle` matchar inte alltid varianten.** Vår `findVariant` jämför `selectedOptions.value` (t.ex. "21x30 cm" / "Vit") mot mallens combos. Om Shopify-storleken är skriven annorlunda ("21×30 cm" med riktigt multiplikationstecken, eller "Hängare i ek" mot "Ek") så returnerar den `null` → vi faller till B → fel siffra.

Vi måste alltså både (a) säkerställa att Källa A nästan alltid lyckas, och (b) göra Fallback B robust när A misslyckas.

---

## Plan

### 1. Diagnos först (1 min)
Lägg till tillfällig konsol-logg i `src/lib/shopify-prices.ts` (`fetchVariants`) som loggar `handle`, `country`, returnerade `selectedOptions`-värden, och i `findVariant` när matchning misslyckas. Be användaren öppna editor-iframen i butiken (DE-marknad), kopiera DevTools-loggen → vi vet då exakt vilka strängar Shopify levererar.

### 2. Gör variant-matchning toleransare i `src/lib/shopify-prices.ts`
Uppdatera `normalize()` så den även:
- Ersätter `×` (U+00D7), `x`, `X` → `x`.
- Tar bort diakritiska tecken (`å→a`, `ä→a`, `ö→o`, etc.) via `.normalize("NFD").replace(/\p{Diacritic}/gu, "")`.
- Tar bort vanliga prefix som "Hängare i ", "Ram i ", "Ramad ".

Detta gör att "Hängare i ek" matchar "Ek", "21×30 cm" matchar "21x30cm", osv.

### 3. Bygg en FX-bro när Storefront-pris saknas
Lägg till en ny hjälpfunktion i `src/lib/shopify-prices.ts`:

```
getMarketCurrency(handle, country) → { currencyCode, anyAmountSEK, anyAmountMarket } | null
```

Den läser **vilken som helst** variant från `productByHandle @inContext(country)` och returnerar förhållandet mellan dess SEK-pris (vi vet vårt interna SEK från `pricing.ts`) och dess marknadspris. Det ger oss en **härledd FX-rate** som garanterat speglar Shopifys egen kurs för marknaden, oavsett vad temat skickade i `cart.currency.rate`.

I `useShopifyPriceMap` exponera även denna härledda rate. I `EditorPage`/`FormatSection`:

- Om `livePrice` finns → använd den (oförändrat).
- Annars: `formatMoney(sekAmount * derivedRate, derivedCurrency, locale)` istället för `formatPrice(sekAmount, shopCtx)`.

Detta löser fallet där varianten inte matchas exakt men vi ändå behöver visa rätt belopp i rätt valuta.

### 4. Förbättra theme-snippeten i `SHOPIFY_SETUP.md`
Byt URL-rate-källa från `cart.currency.rate` till en mer pålitlig kombination, och skicka även den i `SHOP_CONTEXT`-postMessage:

```liquid
&rate={{ shop.currency | default: 'SEK' }}...
```

I praktiken: använd `localization.country.currency.iso_code` istället för `cart.currency.iso_code` (det är marknadsvalutan, inte cart-valutan), och skicka även `shop_currency={{ shop.currency }}` så vi i editorn vet att vår SEK-bas matchar shop-basen.

Notera: detta är bara en backup — den riktiga fixen är steg 2+3 ovan, eftersom användaren aldrig får röra Liquid igen om vi själva härleder FX i editorn.

### 5. Test-checklista
1. Öppna `personlig-karta-poster` i butiken som **DE-kund** (EUR). Pris ska visa t.ex. "17,99 €" — inte "199 €".
2. Byt storlek/ram → delta-priserna i `FormatSection` ska också vara i EUR med rätt belopp.
3. Lägg i varukorg → CartDrawer visar samma EUR-summa (den läser cart-cost från Shopify, alltid korrekt).
4. Som **SE-kund** (SEK) → priser som tidigare, oförändrat.
5. Logga DevTools-konsolen efter steg 1 — `[shopify-prices] derived rate=…` ska finnas och inte vara `1`.

---

## Filer som ändras

- `src/lib/shopify-prices.ts` — bättre `normalize()`, ny `getDerivedFx()`-hjälp, debug-loggning.
- `src/hooks/useShopifyPriceMap.ts` — exponera `derivedFx` (currency + rate) bredvid pris-mappen.
- `src/pages/EditorPage.tsx` — använd `derivedFx` för fallback-priset.
- `src/components/editor/FormatSection.tsx` — använd `derivedFx` för delta-prisformat när Shopify-pris saknas.
- `src/lib/format-price.ts` — liten ny `formatMoneyFromSEK(sekAmount, derivedFx, locale)`-helper.
- `SHOPIFY_SETUP.md` — uppdatera snippeten att använda `localization.country.currency.iso_code` och skicka `shop_currency`.

Inga DB-ändringar, inga edge function-ändringar.
