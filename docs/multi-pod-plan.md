# Multi-POD (Phase 3) — Implementation Plan

Provider-agnostic Print-on-Demand: generalize the Gelato-only integration behind a
`PodProvider` interface, make Gelato itself generic (all products/sizes, not just
the 4 wall-art types), then add Printful. Merchant self-serve onboarding, per-provider
print files, mockups via each provider's API, live cost/shipping display, and a live
print-area guide in the editor.

Status: **Phase 3a in progress.** Slice 2a shipped + verified against live Gelato;
2b + the DB rename remain. This doc is the decided sequence.

---

## Progress log (living — keep updated across parallel sessions)

Coordination note: work happens on branch `claude/parallel-claude-cli-workflow-okjppo`
from more than one Claude session (web + CLI). Before starting a slice, `git pull`
this branch and read this log so two sessions don't edit the same file at once.

### Done
- **3a slice 2a** — order-submit + SKU resolution behind `PodProvider` (server adapter
  `supabase/functions/_shared/pod/gelato.ts`: `resolveGelatoProductUid`, `submitGelatoOrder`;
  client `src/lib/pod/`). Verified against live Gelato. Commits `da9477b`, `21e44a9`, `4dbd7ea`.
- **Order-webhook auth/delivery fix** — `verify_jwt=false` in `config.toml` + HMAC via the app
  client secret; `orders/paid` registered. Verified end-to-end. Commits `31e3965`, `965bd3f`,
  `09c9aba`, `57fc8ae`.
- **Launch-blocker: webhook multi-tenancy** — `shopify-order-webhook` now resolves shop + Admin
  token from the ORDER'S OWN installation (`X-Shopify-Shop-Domain` → `shopify_app_installations`)
  instead of a hardcoded Arthena store + shared env token. Commit `5f8be94`. NOTE: this edited
  `shopify-order-webhook/index.ts` — the DB rename below must be rebased on top of it.
- **3a slice 2b — fulfillment-parse behind the adapter (CODE done; deploy pending).** Commit
  `529c6b8`. `_shared/pod/gelato.ts` now owns `parseFulfillmentWebhook(event)` (webhook shape) and
  `parseGelatoOrderResponse(order)` (Order API shape); `gelato-webhook` + `gelato-backfill` import
  them, inline copies deleted. Verbatim move → byte-identical behavior. Status→ship/event mapping
  (`SHIP_STATUSES`/`EVENT_MAP`) deliberately left in each caller (they differ). REMAINING: deploy
  both functions + verify via Gelato's test webhook (Deno type-check couldn't run locally — proxy
  blocks deno.land).

### Next (reasonable order)
1. **Deploy + verify 2b** — `supabase functions deploy gelato-webhook gelato-backfill`, then fire
   Gelato's test webhook and confirm parse/tracking unchanged. (Or bundle with the DB-rename deploy.)
2. **3a DB rename — LAST, its own coordinated pass.** `gelato_orders` → `pod_orders`
   (+ `provider`, `provider_order_id`); `product_configs.gelato_sku_map` → `variant_map`.
   Blast radius = 6 files (`gelato-webhook`, `gelato-backfill`, `shopify-order-webhook`,
   `admin-templates`, `src/lib/product-config.ts`, generated `src/integrations/supabase/types.ts`)
   + migration + regenerated types + atomic redeploy of every function that reads the tables.
   Sensitive → ONE session owns it end-to-end; pull the slice-2a/2b + multi-tenancy commits first.

### Still open (not 3a)
- **Launch-blocker: per-install POD credentials.** Order/submit still reads one shared
  `GELATO_API_KEY` env; must become a per-installation lookup. Needs a `pod_connections` table
  (scoped to Phase 3e/4 in this plan) — do not invent the schema ad hoc.

---

## 0. Locked decisions & verified constraints

- **Shopify variant limit = 2048 variants/product** (default), NOT 100 (old limit).
  **Max 3 options/product** (`OPTIONS_OVER_LIMIT`) — the *tighter* real constraint.
- **Mockups = provider API for ALL providers, always.** Gelato (verified), Printful,
  Printify all have mockup APIs → one `getMockup()` path. **Goal: retire the current
  procedural compositing (`mockup-composite.ts`) entirely;** keep overlay/procedural only
  as an emergency fallback if a specific SKU has no usable API mockup.
- **Multi-provider model:** YES at shop level; ONE provider per Shopify product;
  a single customer ORDER may span providers → split into N `pod_orders` + N Shopify
  fulfillments (the biggest hidden complexity).
- **Auth = OAuth-first where the provider supports it.** Printful (OAuth 2.0 Public App)
  and Printify (OAuth 2.0 for multi-merchant platforms) → OAuth. Gelato → API key (no
  third-party OAuth exists). Store access + refresh tokens in `pod_connections`.
- **Who connects:** the **MERCHANT** connects their own POD account (BYO). The **end
  shopper never touches the POD** — orders flow merchant-store → POD via the merchant's
  connection. (Terminology: "merchant" = Motiv's customer; "shopper" = the merchant's buyer.)
- **Shipping:** informational only — `getShippingEstimate()` shown in admin; merchant
  sets their own Shopify shipping. No Carrier Service integration.
- **Returns:** none built. Providers cover misprints/defects (their side, via the
  merchant's POD account). Shopper returns = the merchant handles them (personalized =
  non-returnable), for now through their own POD account. We build **pre-production
  cancellation only** + surface defect/reprint status.
- **Print area:** first-class in the editor — live safe-area + bleed + real print-area
  mask while designing.
- **Key model:** BYO provider connection (merchant pays their POD) as default; managed later.
- **Providers at launch: all three — Gelato, Printful, Printify.** Sequence: **start with
  Gelato** (already connected; it's the proving ground for the generic model across 3a–3d),
  then add Printful + Printify together in 3e (both OAuth).
- **Variant cap default:** soft warning as the count grows + hard block at 2048.

---

## 1. Current state (grounded)

Gelato-only, hardcoded everywhere. No `PodProvider` exists. Provider coupling lives in:
tables (`gelato_orders`, `product_configs.gelato_sku_map`), the proprietary UID strings in
`gelato-sku-map.json` (duplicated client + edge), hardcoded API base URLs in edge functions,
print-spec constants in `template-snapshot.ts`, and procedural mockups.

Good precedent: `pricing_rules` is already provider-generic (`provider/material/size/variant`).

---

## 2. Target architecture

### 2.1 `PodProvider` interface (`src/lib/pod/` + `supabase/functions/_shared/pod/`)
```
interface PodProvider {
  id: string
  // onboarding
  verifyConnection(creds): Promise<{ ok, account? }>
  getProductCatalog(): Promise<ProductBase[]>
  // design → print
  getPrintSpec(sku): PrintSpec   // { format, dpiTarget, bleedMm, safeAreaMm, colorProfile, widthPx, heightPx, printArea }
  resolveSku(base, axisValues): string
  // visualize
  getMockup(sku, designUrl, views?): Promise<string[]>
  // commerce
  getLivePrice(sku, region): Promise<{ cost, currency }>
  getShippingEstimate(sku, region): Promise<{ amount, currency, etaDays }>
  // fulfillment
  submitOrder(items, address): Promise<{ providerOrderId }>
  parseFulfillmentWebhook(payload): { orderRef, status, tracking? }
}
```
A registry keyed by `provider` id resolves the adapter both client- and server-side.

### 2.2 Product base (unlocks apparel/cases + generalizes Gelato)
```
ProductBase = {
  provider, providerProductId, category,            // "poster" | "t-shirt" | "phone-case" ...
  variantAxes: [{ key, label, values[] }],          // generic axes, not hardcoded size/frame
  printAreas: [{ id, label, widthMm, heightMm, geometry, safeAreaMm, bleedMm }],
  mockup: "api" | "overlay" | "procedural"
}
```
Replaces the hardcoded `allowedSizes/Frames/Depths/Materials/Finishes` vocabulary.

### 2.3 Data model changes
- `gelato_orders` → **`pod_orders`** (+ `provider`, `provider_order_id`); one Shopify
  order → many rows.
- `product_configs.gelato_sku_map` → **`variant_map`** (provider-neutral) (+ a `provider`
  field on the config / per product base).
- NEW **`pod_connections`** (per-installation provider creds, encrypted, service-role only).
- NEW **`product_bases`** (imported catalog cache per provider).
- NEW **`print_specs`** (per `provider + sku`).
- Keep **`pricing_rules`**; add a companion **cost** field/table for margin.

---

## 3. Phased delivery

Each phase ships independently. Parity first, then generalize, then scale.

### Phase 3a — Interface + Gelato to parity (no behavior change)
**Goal:** extract `PodProvider`, move all Gelato specifics behind it, rename tables/columns.
Ship = byte-identical behavior.

- **DB migration:** rename `gelato_orders`→`pod_orders` (+ `provider default 'gelato'`,
  `gelato_order_id`→`provider_order_id`); rename `product_configs.gelato_sku_map`→`variant_map`.
- **New:** `src/lib/pod/types.ts` (interface + `ProductBase`/`PrintSpec`), `src/lib/pod/registry.ts`,
  `src/lib/pod/gelato/` (adapter wrapping today's `gelato-catalog.ts`, `gelato.ts`,
  `gelato-sku-map.json`). Mirror in `supabase/functions/_shared/pod/`.
- **Refactor behind interface:**
  - `shopify-order-webhook/index.ts::processOrder` → `provider.submitOrder()` (Gelato URL/body/headers move into the adapter).
  - `gelato-webhook` + `gelato-backfill` → `provider.parseFulfillmentWebhook()`.
  - `shopify-sync-template::getUid` + `shopify-order-webhook::resolveProductUid` → `provider.resolveSku()`.
  - `ProductOptionsSection.tsx` `hasGelatoSku()` → provider-generic availability check.
- **Delete:** `reveal-gelato-secret` (temporary).
- **Ship criteria:** existing Gelato flow (create/sync/order/fulfill) works unchanged.

### Phase 3b — Generic product base + generalize Gelato + editor print-area
**Goal:** the generic model, proven by extending Gelato beyond wall art; live print-area in editor.

- **DB:** `product_bases` table + import via Gelato's ecommerce/catalog API
  (generalize `gelato-fetch-uids` → `provider.getProductCatalog()`, drop the 4 hardcoded
  categories; expose Gelato's broader range: apparel, mugs, etc.).
- **Client:** replace hardcoded variant vocab (`product-defaults.ts`, `gelato-catalog.ts`
  getters, `ProductOptionsSection` product-type blocks) with `variantAxes` from the base.
  Template schema: layers reference a `printAreaId`; product options become axis-driven.
- **Editor (`ControlPanel`/`LayerCanvas`/`EditorPage`):** render the selected base's
  **print-area boundary + safe area + bleed** live; for non-rectangular areas show the
  real mask; warn when design leaves the safe zone.
- **Variant cap UI:** live "X / 2048" counter + ≤3-option mapping + hard block; chunked
  `productVariantsBulkCreate` in sync.
- **Ship criteria:** a Gelato apparel/mug product can be configured + synced; editor shows
  the correct print area for it.

### Phase 3c — Print spec per SKU + server-side hi-res print files
**Goal:** correct print files per product/provider (fixes the ~152-DPI ceiling).

- **DB:** `print_specs` per `provider+sku`.
- **New server renderer** (extend `generate-print-file`): renders at
  `provider.getPrintSpec(sku)` — true DPI, format, bleed, safe area, color profile,
  print-area geometry. Replaces the browser 152-DPI pipeline for the final file.
- **Client `template-snapshot.ts`/`EditorPage`:** keep the fast preview; move the
  order-time hi-res file to the server path. Remove hardcoded `PX_PER_CM`, `bleedCm`, `wrapCm`.
- **Ship criteria:** order-time print files meet each SKU's real spec.

### Phase 3d — Mockups via provider API + cost/shipping display
**Goal:** exact previews; informed pricing.

- **New:** `getMockup()` for Gelato (async job + cache keyed `provider+sku+designHash`,
  bucket `mockup-cache`). Retire `mockup-composite.ts` to fallback-only.
- **Admin:** `getLivePrice()` + `getShippingEstimate()` shown per product (cost + margin
  vs `pricing_rules` retail; shipping is informational).
- **Ship criteria:** product card + editor show provider-generated mockups; admin shows
  cost/shipping.

### Phase 3e — Add Printful + Printify + multi-provider orders + onboarding
**Goal:** the shop truly multi-POD (all three live end-to-end).

- **New:** `src/lib/pod/printful/` and `src/lib/pod/printify/` (+ their `_shared/pod/*`
  server halves) implementing the full interface (OAuth connect + refresh, catalog,
  resolveSku, print spec, mockup, order, webhook).
- **OAuth infra:** a `pod-oauth-connect/callback` edge function (per provider), tokens
  stored in `pod_connections`; refresh-token handling. Gelato stays an API-key paste.
- **Order splitting:** `shopify-order-webhook` groups line items by their product's provider
  → one `submitOrder` + one `pod_orders` row + one Shopify fulfillment **per provider**.
  `pod-webhook` router dispatches to the right adapter's `parseFulfillmentWebhook`.
- **Onboarding UI:** connect provider → import bases → pick products → starter templates →
  one-click add product. "Add product" is the core self-serve flow.
- **Ship criteria:** a cart with a Gelato item + a Printful item produces 2 POD orders and
  2 tracked fulfillments on the one Shopify order.

---

## 4. Cross-cutting concerns (from the "what you might miss" list)

- **Catalog drift:** periodic `product_bases` refresh; handle discontinued SKUs on live products.
- **Cost/margin:** store provider cost alongside `pricing_rules` retail.
- **Print-area compatibility:** templates are print-area-bound; switching base may need re-fit.
- **Color management:** ICC/color profile per spec (paper vs textile).
- **Per-installation POD credentials (BYO) — REQUIRED for launch:** the order/submit path
  must resolve the MERCHANT'S OWN provider connection from `pod_connections`, not a single
  shared env key. Today `shopify-order-webhook` reads one shared `GELATO_API_KEY` env — that
  must become a per-installation lookup keyed by the order's shop. (Phase 3e/4.)
- **Webhook-handler multi-tenancy — REQUIRED for launch:** derive shop + access token
  per-installation for ALL Shopify Admin calls inside the webhook. The failure-note PUT still
  targets a hardcoded/env store domain + token (an Arthena-era single-store leftover) — must
  come from the order's installation. Also set `SHOPIFY_API_SECRET` so app-managed webhooks are
  HMAC-verified in production (today an unset secret makes the handler accept UNVERIFIED — DEV only).
- **Provider webhooks:** per-provider registration/secret/verification; a `pod-webhook` router.
  NOTE: Shopify order webhooks are DECLARATIVE in `shopify.app.toml` (`[[webhooks.subscriptions]]`)
  → auto-registered for every install (and existing installs reconciled) on `shopify app deploy`;
  no per-merchant step. The `orders/paid` subscription was missing entirely and was added (commit
  31e3965) — deploy activates it. Gelato/Printful/Printify fulfillment webhooks are registered on
  the PROVIDER side per connection.
- **Rate limits + retries** per provider; keep the existing `pending_manual` manual-fallback.
- **Availability:** made-to-order (no stock) but sync out-of-stock variants + geo availability.
- **Cancellation:** pre-production cancel path (no returns flow).
- **Billing hook (Phase 5):** meter per order/provider.
- **Sample/test orders** before going live.

---

## 5. Decisions — locked
1. **Providers:** all three (Gelato, Printful, Printify). Sequence: Gelato first (3a–3d),
   Printful + Printify in 3e.
2. **Cap:** soft warning + hard block at 2048.
3. **First coded step:** Phase **3a** — pure refactor of Gelato behind `PodProvider` to
   parity (low risk, unblocks everything).

Still to nail down *within each phase* (provider-API details, not blockers): Gelato's
non-wall-art catalog shape, per-provider print-spec sourcing, mockup async/latency/cost/rate
limits, exact OAuth scopes + app registration, ICC/color handling.
