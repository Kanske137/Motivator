Problemet är att `resolveConfigForHandle()` returnerar direkt första config som matchar `shopify_handle` innan den tar hänsyn till `type`. I konsoliderade mallar delar Poster, Canvas, Metallposter och Plexiglas samma handle, så URL:en hinner ändras till t.ex. `type=aluminum`, men resolver-effekten väljer ändå första configen för samma handle — oftast Poster. Därför krävs ett andra klick.

Plan:
1. Uppdatera `resolveConfigForHandle()` i `src/lib/product-config.ts` så den, när `preferredType` finns, först försöker matcha både `shopify_handle` och `product_type`.
2. Behåll nuvarande fallback-beteende för gamla/icke-konsoliderade länkar: om ingen typmatch finns, använd direkt handle-match eller template_slug-match som idag.
3. Kontrollera att `EditorPage.tsx` kan fortsätta använda samma resolver-effekt utan extra omladdning.

Förväntad effekt:
- Första klicket på Metallposter/Plexiglas går direkt till rätt produkttyp.
- Poster och Canvas fortsätter fungera.
- Gamla länkar utan `type` landar fortfarande stabilt på Poster.