# Gelato → Shopify fulfillment & leveranssync

## Mål
När Gelato skickar en order ska Shopify automatiskt:
1. Markeras **Fulfilled** med carrier-tracking + tracking-URL.
2. Skicka Shopifys standard-leveransbekräftelse till kund (med tracking-länken).
3. Spegla `in transit` / `out for delivery` / `delivered`-status i orderns tidslinje och på kundens orderstatus-sida.

Plus en engångs-backfill för att rensa redan skickade ordrar som fortfarande står som unfulfilled.

## Förutsättningar (verifierat i projektet)
- `supabase/functions/shopify-order-webhook/index.ts` skapar redan Gelato-ordern vid checkout och loggar i tabellen `gelato_orders` (`shopify_order_id`, `shopify_order_name`, `gelato_order_id`, `status`, `payload`).
- `orderReferenceId` i Gelato sätts till `shopifyOrderName` (t.ex. `#1042`), `customerReferenceId` till `shopifyOrderId` (numeriskt). **Det behåller vi.** Webhooken slår upp Shopify-ordern via `gelato_orders.gelato_order_id`.
- Shopify Admin-token hämtas via befintliga `_shared/shopify-admin.ts` (DB-rad `shopify_app_installations` → fallback `SHOPIFY_ONLINE_ACCESS_TOKEN:user:*` / `SHOPIFY_ADMIN_ACCESS_TOKEN`). Återanvänds — ingen ny token-secret.
- Varje Shopify-order har en merchant-managed fulfillment order med `status: OPEN` och `CREATE_FULFILLMENT` i `supportedActions`.

## Vad som byggs

### 1. Migration: utökad `gelato_orders`
Lägg till kolumner på den befintliga tabellen (ingen ny tabell):
- `shopify_order_gid text` — cachas första gången vi slår upp den
- `shopify_fulfillment_gid text` — idempotensnyckel mot Shopify
- `last_status text` — för att blockera duplicerade webhook-leveranser
- `tracking_code text`, `tracking_url text`, `carrier text`
- `fulfilled_at timestamptz`, `delivered_at timestamptz`
- `raw jsonb` — senaste webhook-payload

### 2. Ny edge function: `gelato-webhook` (publikt webhook-mottag)
- Auth: jämför `?secret=` eller `x-gelato-secret`-header mot `GELATO_WEBHOOK_SECRET`. JWT-verifiering avstängd (publik webhook).
- Parsing tolererar Gelato-status (vi confirm:ar fältnamn mot riktig payload — markeras tydligt i koden):
  - `SHIP_STATUSES`: `["shipped"]` → triggar `fulfillmentCreate`
  - `EVENT_MAP`: `in_transit → IN_TRANSIT`, `out_for_delivery → OUT_FOR_DELIVERY`, `delivered → DELIVERED` → triggar `fulfillmentEventCreate`
  - Övriga (created / printed / etc): bara loggas i `gelato_orders.raw`
- Slår upp Shopify-order via `gelato_orders.gelato_order_id` → `shopify_order_id` (numeriskt) → bygger GID `gid://shopify/Order/<id>`. Cachas i `shopify_order_gid`.
- Idempotens: `last_status === status` ⇒ 200 utan att göra något. `shopify_fulfillment_gid` återanvänds när det redan finns.
- `notifyCustomer: true` så Shopify mejlar leveransbekräftelsen (rekommendation: stäng av Gelatos egna kundmejl för att undvika dubbletter).
- Fel returnerar 5xx så Gelato gör retry.

### 3. Ny edge function: `gelato-backfill` (manuellt anropad)
- Hämtar Shopify-ordrar med `displayFulfillmentStatus = UNFULFILLED` (paginerat).
- Slår upp matchande rad i `gelato_orders`; för rader med `gelato_order_id` frågar Gelatos Order API om aktuell status + tracking.
- Är ordern `shipped` eller längre kommen kör den samma `ensureFulfillment`-väg. Är den `delivered` postas även `DELIVERED`-event.
- Helt idempotent — säker att köra om.

### 4. Secrets
- `GELATO_WEBHOOK_SECRET` — genereras automatiskt (slumpmässig sträng), läggs sedan på Gelato-webhook-URL:en som `?secret=...`.
- `GELATO_API_KEY` finns redan, återanvänds av backfill mot Gelatos Order API.
- Shopify-token: ingen ny secret (befintlig helper).

### 5. Manuella steg som skrivs ut i chatten när bygget är klart
1. **Shopify Admin API-scopes** — lägg till på den befintliga appen och re-authorisera så token får dem:
   - `write_merchant_managed_fulfillment_orders`
   - `read_merchant_managed_fulfillment_orders`
   - `write_fulfillments`
2. **Registrera Gelato-webhook** i Gelato Dashboard → Developer/API → Webhooks, pekande på den deployade funktions-URL:en med `?secret=<GELATO_WEBHOOK_SECRET>` påklistrat.
3. **Skicka tillbaka en riktig Gelato-webhook-payload** så vi kan confirm:a fältnamn och statussträngar (`SHIP_STATUSES`, `EVENT_MAP`, parse-blocket). Jag pekar exakt på vilka rader som ska justeras om de skiljer sig.

## Teknisk detalj (för referens)

```text
checkout (befintligt)
  └─ shopify-order-webhook ──► Gelato.createOrder
                                   orderReferenceId = "#1042"
                                   customerReferenceId = "8124716777818"
       └─ INSERT gelato_orders (shopify_order_id, gelato_order_id, ...)

Gelato shipping event
  └─ POST /functions/v1/gelato-webhook?secret=...
       1. auth via secret
       2. parse status + trackingInfo
       3. SELECT gelato_orders WHERE gelato_order_id = ?
       4. idempotens-check (last_status)
       5. om SHIP: fulfillmentCreate(notifyCustomer=true) → mail
       6. om EVENT_MAP-träff: fulfillmentEventCreate(status=...)
       7. UPDATE gelato_orders (tracking_*, fulfilled_at|delivered_at, last_status, raw)
```

Shopify-mutationer som används (verifierade scopes ovan):
- `fulfillmentCreate(fulfillment: { lineItemsByFulfillmentOrder, trackingInfo, notifyCustomer })`
- `fulfillmentEventCreate(fulfillmentEvent: { fulfillmentId, status, happenedAt })`

## Acceptanskriterier
- En testorder, när Gelato markerar `shipped`, flippar Shopify-ordern till Fulfilled med klickbar tracking-länk och skickar leveransbekräftelsen till kunden.
- När Gelato markerar `delivered` visar Shopifys order-timeline + kundens orderstatus-sida levererat.
- Om Gelato skickar samma webhook igen skapas inget duplikat (ingen extra fulfillment, inget extra event).
- `gelato-backfill` rensar de ordrar som redan är skickade men står som unfulfilled.

## Begränsningar i v1
- Hela ordern fulfillas på första shipment-eventet. Per-paket-precision (matcha Gelatos shipment-items mot enskilda `fulfillmentOrderLineItem`) kan läggas till senare.
- Statussträngarna i `SHIP_STATUSES` / `EVENT_MAP` ska confirm:as mot en riktig Gelato-payload (steg 3 i manuella checklistan).
