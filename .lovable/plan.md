Jag hittade en tydlig miss i synk-funktionen: databasen och editorn har hängarna sparade, och SKU-mappen har Gelato-SKU:er för hängare, men `shopify-sync-template` har fortfarande en lokal poster-pristabell utan hängarpriser. Därför filtreras alla hängare bort i `plan()` som `no price`, vilket matchar loggen exakt: `poster existing=30 toCreate=0 toUpdate=30`. 30 = 6 storlekar × 5 vanliga ramval, alltså inga hängare planeras alls.

Plan:

1. Uppdatera poster-priserna i `supabase/functions/shopify-sync-template/index.ts`
   - Spegla `src/lib/pricing.ts` så hängarna får sina definierade priser:
     - 21x30: Hängare Vit/Svart 339, Ek/Valnöt 349
     - 30x40: Hängare Vit/Svart 439, Ek/Valnöt 449
     - 40x50: Hängare Vit/Svart 489, Ek/Valnöt 499
     - 50x70: Hängare Vit/Svart 589, Ek/Valnöt 599
     - 70x100: Hängare Vit/Svart 729, Ek/Valnöt 749
   - Lämna 13x18 utan hängare, eftersom Gelato-SKU saknas där.

2. Behåll hängare som värden under samma Shopify-option `Ram`
   - Det ska alltså bli varianter som `30x40 / Hängare Ek`.
   - Ingen separat `Ingen ram`-definition skapas för hängare; `Ingen` fortsätter bara vara ett vanligt ramvärde i grundflödet för poster.

3. Förbättra felsökningsloggningen lite
   - Logga `plannedVariants` och antal `skipped`, så det blir uppenbart om hängare filtreras bort igen p.g.a. pris eller SKU.
   - Efter fixen bör nästa postersynk ungefär visa `existing=30 toCreate=20 toUpdate=30`, inte `toCreate=0`.

4. Rensa den separata publiceringsvarningen i samma funktion
   - Loggarna visar också en Shopify GraphQL-varning: `Field 'app' doesn't exist on type 'AppCatalog'` i publications-queryn.
   - Den verkar inte vara orsaken till hängarvarianterna, men den gör att publiceringssteget returnerar `false`. Jag tar bort det inkompatibla fältet och matchar Online Store via namn istället, så loggarna blir rena och produkten kan publiceras korrekt.

Efter detta behöver du synka `vad-poster` igen. Då ska hängaralternativen skapas som riktiga Shopify-varianter med storlek, pris och Gelato-SKU.