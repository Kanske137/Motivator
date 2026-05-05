## Mål

Editorn (iframe i Shopify-temat) ska automatiskt visa **samma språk och valuta** som butiken visar för kunden — utan val i appen. Stöd för sv (default), en, de + förberedd struktur för fler europeiska språk (no, da, fi, fr, es, it, nl, pl). Pris vid checkout = exakt det Shopify visar.

## Tema-snippet — behövs uppdatering?

**Ja, en liten uppdatering krävs i testbutiken** (3 rader till i befintlig snippet i `personlig-karta-editor`). Mycket lite jobb:

- `src=...?handle=...` → utöka med `&locale={{ request.locale.iso_code }}&currency={{ cart.currency.iso_code }}&country={{ localization.country.iso_code }}`
- Lägg till en liten `<script>` som vid iframe-load `postMessage`:ar `{ type: 'SHOP_CONTEXT', locale, currency, rate, country }` så att appen kan reagera även om kunden byter språk/valuta utan att ladda om.

Resten av snippet (cart-add-flödet, resize) är oförändrat. När appen flyttas till nya temat följer samma 10-radersändring med — temat i sig spelar ingen roll, bara att snippet sitter i en `custom-liquid`-sektion som idag.

`SHOPIFY_SETUP.md` uppdateras med det nya snippet-innehållet.

## Lösning

### A. i18n (språk)

- Installera `react-i18next` + `i18next`.
- Skapa `src/i18n/index.ts` som initierar med resurser och läser locale från:
  1. `?locale=` i URL (sätts av tema-snippet)
  2. `postMessage` `SHOP_CONTEXT` (live-uppdatering)
  3. `navigator.language` (fallback utanför iframe)
  4. `sv` (slutfallback)
- Region-mappning: `en-GB` → `en`, `de-AT` → `de` osv.
- Resursfiler i `src/i18n/locales/`: `sv.json` (källa), `en.json`, `de.json`, `no.json`, `da.json`, `fi.json`, `fr.json`, `es.json`, `it.json`, `nl.json`, `pl.json`. Översättningar genereras initialt för en/de (manuellt kvalitetsskrivna), övriga europeiska språk får en första maskin-översättning som du kan finputsa.
- **Alla** hårdkodade UI-strängar extraheras till nycklar (knappar, sektionsrubriker, mockup-titlar, ramnamn där det är generiska "Ingen/Vit/Svart/Ek/Valnöt/Hängare …", toasts, validering, fält-etiketter).

### B. Valuta & pris (Shopifys egna värden)

Eftersom du vill att slutpriset = exakt det Shopify visar/debiterar, kör vi **Shopifys egen konvertering**:

- Tema-snippet skickar in `currency` (kundens valda) + `rate` (Shopifys multiplikator från SEK).
- I appen: ny `useShopContext()`-store (Zustand) håller `{ locale, currency, rate, country }`.
- Ny `formatPrice(sekAmount, ctx)` helper:
  - `converted = round(sekAmount * rate)` med Shopifys avrundningsregler (heltal för SEK/NOK/DKK/JPY, 2 decimaler för EUR/USD/GBP osv.).
  - Formatera via `Intl.NumberFormat(locale, { style: 'currency', currency })`.
- Editorn visar då **samma belopp** som produktsidan i samma butik visar i kundens valuta. Vid checkout används Shopifys cart (vi har redan rätt valuta i `cart.cost`-svaret) → identiskt belopp betalas.
- Cart-drawer: ta bort hårdkodad `"SEK"`/`" kr"`. Använd `currencyCode` + locale från Shopify-svaret.

### C. Bevarad referens (intern)

`pricing.ts` förblir SEK — det är källan för Gelato-marginaler och variant-mapping. Ingenting i print/order-flödet ändras.

## Filer

**Nya**
- `src/i18n/index.ts`
- `src/i18n/locales/{sv,en,de,no,da,fi,fr,es,it,nl,pl}.json`
- `src/stores/shopContextStore.ts` — locale/currency/rate/country + postMessage-lyssnare
- `src/lib/format-price.ts` — `formatPrice`, `formatPriceDelta` (för "+99 kr"-fallet)
- `src/hooks/useShopContextBootstrap.ts` — läser query-param vid mount, prenumererar på `SHOP_CONTEXT`-meddelanden

**Ändrade**
- `src/main.tsx` — initiera i18n
- `src/App.tsx` — montera `useShopContextBootstrap()`
- `src/pages/EditorPage.tsx` — `t()` + `formatPrice()` istället för `{currentPrice()} kr`
- `src/components/editor/{ControlPanel,FormatSection,FrameOption,MockupGallery,AiStyleSection,AiPhotoSection,PhotoUploadSection,Canvas3DPreview}.tsx` — alla strängar via `t()`; pris-deltan via `formatPriceDelta`
- `src/components/CartDrawer.tsx` — `t()` + använd `currencyCode` från Shopify
- `src/lib/photo-source.ts` + alla `toast.*("svensk text")`-anrop — via `t()`
- `SHOPIFY_SETUP.md` — uppdaterad snippet med locale/currency/rate

**Inte ändras**
- `pricing.ts`, edge functions, cart attributes, print pipeline, Gelato-flöde

## Memory

Sparar i `mem://index.md` Core-regel: *"All ny UI-text ska in via i18n-nycklar (sv som källa) i `src/i18n/locales/*.json`. Hårdkoda aldrig användarsynlig text. Priser visas alltid via `formatPrice()` med Shopify-kontext."* — så alla framtida ändringar respekterar detta automatiskt.

## Tema-uppdatering: Ny snippet att klistra in

I `SHOPIFY_SETUP.md` Steg 1 ersätts iframe + script-blocket med en variant som inkluderar locale/currency. Du gör en kopia-och-klistra i testbutiken (1 minut). När du flyttar till nya temat: samma snippet, samma `custom-liquid`-mall.

## Frågor innan jag kör

Inga blockerande frågor — jag har det jag behöver. Säg "kör" så implementerar jag.