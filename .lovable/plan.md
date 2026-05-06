Problemet är att appen själv tappar query-parametrarna efter start: `EditorPage` använder `setParams({ handle, type })` vid produktbyte, vilket ersätter hela URL:en och raderar `locale`, `currency`, `country` och `rate`. Därför kan `new URLSearchParams(location.search).get('country')` fortsätta bli `null` även om temat/snippeten skickar rätt från början.

Plan:
1. Ändra `onProductChange` i `src/pages/EditorPage.tsx` så den bevarar befintliga query-parametrar och bara uppdaterar `handle` + `type`.
2. Lägg till en liten återställning i `useShopContextBootstrap`: när appen har härlett/mottagit country från currency eller `SHOP_CONTEXT`, skriv tillbaka `country`, `locale`, `currency` och `rate` i URL:en med `history.replaceState` utan reload. Då visar konsoltestet `country` även om temat skickar context via postMessage i stället för iframe-query.
3. Verifiera med en lokal preview-URL som saknar `country`, men har `currency=EUR`, att appen normaliserar URL:en till att innehålla `country=DE`, och att produktbyte inte raderar parametern.

Tekniskt:
- Inga temaändringar behövs.
- Inga databasändringar behövs.
- Prislogiken fortsätter använda Storefront-priser via `country`; ändringen gör bara att landkontexten inte försvinner ur URL/state.