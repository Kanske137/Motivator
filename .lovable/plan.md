
# Migration: testbutik → live-butik (`wdxugd-yq.myshopify.com`)

Allt ska bytas rakt över. Test-butiken kan avregistreras efteråt.

## Vad som måste ändras

### A. I koden (jag gör)
Den hårdkodade test-domänen finns på fyra ställen. Vi byter alla till live-butiken (eller läser från env), så att inget av misstag kan tala med fel butik:

1. `supabase/functions/_shared/shopify-admin.ts` — fallback-domän
2. `supabase/functions/shopify-oauth-install/index.ts` — fallback-domän
3. `supabase/functions/shopify-oauth-status/index.ts` — fallback-domän
4. `supabase/functions/shopify-order-webhook/index.ts` — fallback-domän
5. `supabase/functions/shopify-storefront/index.ts` — `DOMAIN` är hårdkodad, byt till `wdxugd-yq.myshopify.com`
6. `SHOPIFY_SETUP.md` — uppdatera test-URL i dokumentationen

Inga UI-ändringar, ingen affärslogik rörs.

### B. I Shopify (du gör — jag guidar)

**B1. Skapa ny Custom App i live-butiken**
- Settings → Apps and sales channels → Develop apps → **Create an app** ("Lovable Editor" eller likn.)
- Configuration → **Admin API access scopes**: bocka i  
  `write_products, write_inventory, write_orders, write_themes, read_publications, write_publications`
- Configuration → **Storefront API access scopes**: bocka i alla `unauthenticated_read_*` (produkter, varianter, checkouts).
- API credentials → **Install app** → kopiera:
  - Admin API access token (`shpat_…`)
  - Storefront API access token
  - API key (= Client ID)
  - API secret key (= Client Secret)

**B2. Themet — kör Steg 1, 2, 3 i `SHOPIFY_SETUP.md` på live-butikens tema**  
(snippet `personlig-karta-editor`, JSON-template `personlig-karta`, tilldela template till produkterna `personlig-karta-poster` och `personlig-karta-canvas`).

OBS: editor-iframens URL i snippet (`artful-create-studio-87.lovable.app/editor?…`) är samma — den behöver inte ändras.

**B3. Webhook**
- Settings → Notifications → Webhooks → **Create webhook**
- Event: `Order payment`, Format: JSON
- URL: `https://ptzmnusfgdwcqpjpbyco.supabase.co/functions/v1/shopify-order-webhook`
- Spara → **kopiera den nya signing secret** (börjar med några tecken, visas högst upp).

**B4. Cart-thumbnail snippet (Steg 6) på nya temat** om det inte redan är gjort där.

### C. Secrets som ska bytas (du klistrar in, jag triggar dialogerna)

| Secret | Nytt värde |
|---|---|
| `SHOPIFY_STORE_PERMANENT_DOMAIN` *(ny — lägg till)* | `wdxugd-yq.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | Admin API-token från B1 (`shpat_…`) |
| `SHOPIFY_STOREFRONT_ACCESS_TOKEN` | Storefront-token från B1 |
| `SHOPIFY_APP_CLIENT_ID` | API key från B1 |
| `SHOPIFY_APP_CLIENT_SECRET` | API secret key från B1 |
| `SHOPIFY_WEBHOOK_SECRET` | Signing secret från B3 |
| `SHOPIFY_APP_SCOPES` | Behålls: `write_products,write_inventory,write_orders,write_themes,read_publications,write_publications` |

`SHOPIFY_ONLINE_ACCESS_TOKEN:user:…` (gammal Lovable-Shopify-koppling till testbutiken) — lämnas, den används bara som fallback om DB-installationen saknas. Kan raderas senare när allt verifierats.

### D. Databas-städning (efter att allt fungerar)
Tabellen `shopify_app_installations` innehåller raden för testbutiken. Vi behöver inte ta bort den — koden slår upp på `shop_domain` och hittar bara live-butikens rad framöver. Kan rensas senare.

### E. Verifiering (jag kör)
1. Deploya edge functions med nya domänen.
2. Anropa `shopify-oauth-status` → ska visa `installed:false` för nya butiken (tills B1 install är gjord — eller `true` direkt om vi använder Admin token från Custom App, då hoppar vi över appens egen OAuth-install).
3. Trigga `shopify-sync-template` på en testmall → kontrollera att produkten/varianterna skapas i nya butiken.
4. Öppna en produktsida i nya butiken → editorn laddar → "Lägg i varukorg" → checkout (Bogus Gateway) → kontrollera `gelato_orders`.

## Viktigt att veta
- **Custom App ≠ Dev Dashboard OAuth-app.** Eftersom Admin token från Custom App ges direkt vid install behöver vi inte köra `shopify-oauth-install`-flödet alls för live-butiken. Vi sparar bara token i `SHOPIFY_ACCESS_TOKEN` så plockar `shopify-admin.ts` upp den via legacy-fallbacken.
- **Storefront-token är butiksspecifik.** Den från test-butiken slutar fungera så fort vi byter `DOMAIN` i `shopify-storefront`.
- **Mappningar (Gelato SKU, templates i Supabase)** påverkas inte — de är butiksoberoende.

## Ordning vi kör i
1. Du gör **B1** och skickar mig de fyra värdena.
2. Jag uppdaterar koden (A) och triggar secret-dialoger för **C**.
3. Du gör **B2 + B3 + B4** i nya temat och skickar webhook secret.
4. Jag deployar + verifierar (E).
