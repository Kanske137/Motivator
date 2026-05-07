Jag hittade den konkreta orsaken: båda anropen till backend-funktionen `shopify-storefront` får `401 UNAUTHORIZED`. Därför hämtas inga riktiga Shopify Markets-priser, `derivedFx` blir `null`, och UI:t faller tillbaka till `formatPrice()` med `rate=1` — vilket ger rätt valutatecken men SEK-belopp.

Plan:
1. Lägg till funktionsspecifik config för `shopify-storefront` så den kan anropas publikt från iframe/editor, på samma sätt som andra webhook/OAuth-flöden som inte har användarlogin.
2. Behåll Storefront-token och butikdomän server-side i funktionen; ändringen ska bara släppa igenom anropet, inte exponera hemligheter.
3. Verifiera i preview med `/editor?...currency=EUR&country=DE&rate=1` att `shopify-storefront` svarar 200 istället för 401 och att knappen visar ett konverterat EUR-belopp istället för SEK-summan med eurotecken.

Tekniskt ändras troligen bara `supabase/config.toml`:
```toml
[functions.shopify-storefront]
verify_jwt = false
```
