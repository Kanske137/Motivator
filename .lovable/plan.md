## Fix: Gelato-webhook parser mot verklig doc-spec

### Bakgrund
Gelatos test-webhook (`order_item_status_updated`, ref=`{{MyOrderId}}`) landade och autentiserades korrekt — men vår `parseGelatoEvent` har fel fältvägar mot den riktiga payloaden (verifierat mot [Gelato webhooks docs](https://dashboard.gelato.com/docs/webhooks/)). Utan fix skulle första riktiga `shipped`-eventet skapa en Shopify-fulfillment **utan tracking**.

### Vad jag ändrar
Enda filen som rörs: **`supabase/functions/gelato-webhook/index.ts`**.

**1. Route på `event`-fältet, inte `fulfillmentStatus`.**
Gelato skickar fyra event-typer, och `fulfillmentStatus` finns bara på en av dem. Ny switch på `event.event`:
- `order_status_updated` → huvudflödet (fulfillment + eventuellt event).
- `order_item_tracking_code_updated` → tracking-only update (post fulfillment-event, uppdatera tracking-kolumner).
- `order_item_status_updated` → logga bara status per item, ingen Shopify-action (för granulär för fulfillment).
- `order_delivery_estimate_updated` → logga bara.

**2. Läs tracking från rätt path.**
```ts
// order_status_updated: event.items[0].fulfillments[0]
// order_item_tracking_code_updated: root-level
```
Plocka första fulfillment med `trackingCode` (items kan ha flera paket — vi använder första och loggar om det finns fler).

**3. Ta bort död `customerReferenceId`-läsning.**
Docs bekräftar: den finns inte i webhook-payloads. Matcha bara på `orderId` (primärt) och `orderReferenceId` (fallback). `shopify_order_id` finns redan i vår `gelato_orders`-rad via `shopify-order-webhook`.

**4. Bredda `SHIP_STATUSES`.**
Enligt Gelatos order-status-lista räknas även `shipped_to_recipient` etc. som skeppning. Håller `shipped` + `shipped_to_recipient` för att vara säkra; övriga (`printed`, `in_production` …) fortsätter till logg-only.

**5. Idempotens per event-id.**
Lägger till kontroll `raw?.id === event.id` för att inte dubbelposta samma event om Gelato retryr. Behåller nuvarande `last_status`-check för status-transitions.

**6. Bättre loggar.**
Logga `event.event` + `event.id` + antal items/fulfillments så nästa debug tar 10 sekunder.

### Vad jag INTE ändrar
- `shopify-order-webhook` (skickar redan `orderReferenceId` korrekt).
- Frontend / DB-schema / config.toml.
- Idempotens-modellen mot Shopify (`shopify_fulfillment_gid`-återanvändning).

### Verifiering
1. Skicka Gelatos test-webhook igen från Dashboard → loggen ska visa `event=order_item_status_updated` och svaret `no link` (fortfarande OK — dummy-ordern finns inte i vår DB).
2. När första riktiga ordern går till `shipped`: loggen visar `event=order_status_updated`, tracking hittas, Shopify-fulfillment skapas med `trackingInfo`, kund får mejl med spårlänk.
3. Om det ändå går fel: exakt payload finns i `gelato_orders.raw` + edge-function-loggarna — snabb-fix från riktig data.

Godkänn så byter jag till build mode och kör ändringarna.
