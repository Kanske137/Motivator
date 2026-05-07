Riktigt fel: Storefront API ser bara produkter som är publicerade till rätt sales channels. Vår sync-funktion misslyckas tyst eftersom Shopify-appen saknar `read_publications`/`write_publications` — edge-loggen visar `Access denied for publications field`. Det betyder att inga nya produkter publiceras vare sig till Online Store eller till storefront-tokenets egen kanal, oavsett om du sätter dem ACTIVE manuellt. Den enda fungerande mallen ("personlig-karta") råkar vara publicerad sedan tidigare.

## Vad jag ändrar

1. Lägg till saknade Shopify-scopes
   - `SHOPIFY_APP_SCOPES` utökas med `read_publications,write_publications`.
   - `shopify-oauth-install`/`-callback` läser scopes från env, så install-URL byggs med rätt rättigheter automatiskt.
   - Admin-sidan får en tydlig prompt: "Installera om Shopify-app för att uppdatera rättigheter" om scopes-listan saknar publications.

2. Publicera till ALLA tillgängliga sales channels
   - `shopify-sync-template` uppdateras: efter `publications`-query publiceras produkten via `publishablePublish` till varje publication (Online Store + storefront-appens egen kanal + ev. headless), inte bara den första matchande.
   - Returneras vilka publications som lyckats per produkt, så UI kan visa det.

3. Visa publish-status i admin
   - Sync-resultatet i AdminConfigs visar vilka kanaler varje mall är publicerad till.
   - Om publicering misslyckas (saknad scope, app inte ominstallerad) visas ett tydligt felmeddelande istället för "Synkad".

4. Backfill för existerande produkter
   - Lägg en knapp "Publicera om alla i Shopify" som loopar alla `product_configs` och kör enbart publicerings-steget — så att nya och äldre mallar kommer in i storefront-tokenets publication utan att hela synken körs om.

5. Verifiera
   - Efter ominstallation körs syncen för en testprodukt (t.ex. `x-poster`).
   - Storefront-anrop `productByHandle("x-poster")` ska returnera produkten (kontrolleras via edge-fn).
   - I editorn visas riktiga Shopify-priser och variant-ID upplöses för x-poster, testglas etc.

## Tekniska detaljer (för referens)

- Custom apps med Storefront-token i Shopify har en egen Publication. En produkt blir bara synlig via Storefront API om den publicerats till den. ACTIVE-status räcker inte.
- `publications`-query kräver `read_publications`. `publishablePublish` kräver `write_publications`. Båda saknas idag.
- Efter scopeändring måste du ominstallera appen en gång — flödet finns redan i AdminConfigs ("Installera om").
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN` ändras inte; det är samma token, men den får tillgång till de produkter som publiceras till dess kanal.