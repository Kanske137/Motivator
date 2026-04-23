
Problemet är inte själva mall-logiken eller SKU-logiken längre. Det som fallerar är Shopify-autentiseringen i backend.

### Vad som faktiskt är fel

Det finns tydliga tecken på att `shopify-sync-template` använder fel autentiseringskälla för Shopify Admin API:

1. `shopify-storefront` fungerar
   - Storefront-anropen returnerar `200`.
   - Det betyder att butikens domän och storefront-token fungerar.

2. `shopify-sync-template` fallerar direkt med `401 Invalid API key or access token`
   - Felet uppstår innan produktskapande/variantlogik hinner spela någon roll.
   - Alltså är Admin API-token som edge functionen använder ogiltig eller inte rätt token för runtime.

3. Nuvarande funktion hämtar token via `Deno.env`
   - Den försöker läsa `SHOPIFY_ONLINE_ACCESS_TOKEN:user:*`
   - annars fallback till `SHOPIFY_ACCESS_TOKEN`
   - Men trots reconnect får vi fortfarande samma `401`, vilket visar att runtime-token som funktionen ser inte är användbar för Admin API.

4. Din nuvarande chat-/tool-auktorisering och edge function-runtime är inte samma sak
   - Jag kunde läsa att din användare är Shopify-auktoriserad i verktygen.
   - Samtidigt finns inga tillgängliga connector-kopplingar för nuvarande användare i projektet.
   - Det tyder på att appens edge function inte säkert delar samma auth-kanal som chat-verktygen.

5. Samma sårbarhet finns sannolikt även i `shopify-order-webhook`
   - Den använder också `SHOPIFY_ACCESS_TOKEN` direkt.
   - Den kan därför senare få samma typ av Admin API-problem.

### Slutsats

Det uppenbara grundproblemet är:
- Synk-knappen i appen går via en edge function som förlitar sig på en Shopify Admin-token i runtime-secrets.
- Den token som funktionen faktiskt använder är fel, gammal eller inte korrekt exponerad till runtime.
- Reconnect i chatten har därför inte löst det verkliga felet i appens backend-path.

## Plan för att lösa det

### 1. Gör Shopify-auth i backend deterministisk
Refaktorera auth-hanteringen i `supabase/functions/shopify-sync-template/index.ts` så att den:
- använder en enda tydlig tokenkälla i prioriterad ordning
- loggar vilken tokenkälla som valdes, utan att exponera hemligheter
- loggar vilken domän som används
- slutar “gissa” genom att scanna miljön brett efter alla `SHOPIFY_ONLINE_ACCESS_TOKEN*`

Målet är att funktionen alltid använder en verifierad Admin-token, inte en opportunistisk fallback.

### 2. Lägg till ett explicit Admin API-auth-test först
Innan produktsynk körs ska funktionen göra ett litet test mot Admin API, t.ex. en enkel shop-query.
Om auth fallerar ska svaret bli tydligt, t.ex.:
- vilken auth-källa som användes
- att Admin-token är ogiltig i backend
- att ingen produktsynk försöktes

Det gör att vi kan skilja auth-fel från produkt-/variantfel direkt.

### 3. Centralisera Shopify-auth i en gemensam helper
Skapa samma auth-upplägg för:
- `shopify-sync-template`
- `shopify-order-webhook`

Det minskar risken att synk fixas men att order-webhook senare fortfarande använder en gammal token.

### 4. Sluta bygga på antagandet att reconnect automatiskt uppdaterar edge runtime
Nuvarande implementation antar i praktiken att en reconnect gör rätt token tillgänglig i `Deno.env`.
Planen är att verifiera och koda för den faktiska backend-kanalen som finns i projektet, istället för att anta att reconnect räcker.

### 5. Om runtime-token fortfarande inte är giltig: byt integrationsstrategi
Om verifieringen visar att Lovable-runtime inte får en fungerande Admin-token via env, behöver synken flyttas till den stödda Shopify-integrationen istället för att ske med ett manuellt env-tokenflöde.

Det innebär att vi i nästa steg väljer en av dessa robusta vägar:
- antingen säkrar en riktig permanent Admin-token som backend får tillgång till
- eller flyttar Shopify-skapande/uppdatering till en stödd integrationsväg som inte beror på denna trasiga env-tokenmodell

### 6. Förbättra felmeddelandet i admin-UI
`DesignerPage` och `CreateTemplateDialog` ska visa ett mer exakt fel än bara “Shopify-synk misslyckades”, t.ex.:
- “Backendens Shopify Admin-token är ogiltig”
- istället för att det ser ut som att mall- eller variantdatan är fel

## Filer som påverkas

- `supabase/functions/shopify-sync-template/index.ts`
  - auth-flöde
  - auth-test
  - tydligare loggning och felhantering

- `supabase/functions/shopify-order-webhook/index.ts`
  - samma auth-helper / samma säkra tokenstrategi

- eventuellt ny shared helper i `supabase/functions/_shared/...`
  - gemensam Shopify Admin-auth

- `src/pages/admin/DesignerPage.tsx`
  - bättre feltext i toast

- `src/components/admin/CreateTemplateDialog.tsx`
  - bättre feltext i toast

## Verifiering efter fix

1. Klick på “Synka till Shopify” ger inte längre `401`.
2. Funktionen loggar tydligt vilken auth-källa som användes.
3. En enkel Admin API test-query passerar innan produktsynk startar.
4. Mallen “Mitt hjärta” skapar eller uppdaterar produkt(er) i Shopify.
5. Samma auth-upplägg fungerar även för order-webhookens Admin-anrop.
6. Om auth fortfarande saknas får du ett exakt, begripligt fel som pekar på backend-auth och inte på mallarna.

## Kort sagt

Det som inte stämmer är att appens Shopify-synk just nu körs med fel backend-authmodell. Din Shopify-anslutning verkar finnas på användar-/tool-nivå, men edge functionen använder fortfarande en ogiltig eller felaktigt exponerad Admin-token i runtime. Det är därför du får samma 401 om och om igen.
