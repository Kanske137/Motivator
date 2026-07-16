// Server-side Gelato adapter (Phase 3a).
//
// The Gelato specifics — the shared SKU map, UID/productType resolution, and the
// order API call — live here so the edge functions call provider functions instead
// of hardcoding Gelato inline. Logic is moved VERBATIM from the previous inline
// copies, so behavior is byte-identical. Later phases turn this into a full
// PodProvider (mockups, print spec, fulfillment parse, pricing).
import SKU_MAP_JSON from "../gelato-sku-map.json" with { type: "json" };

export type GelatoProductType = "posters" | "canvas" | "aluminum" | "acrylic";

/** The single shared Gelato SKU map (was imported separately by each function). */
export const GELATO_SKU_MAP = SKU_MAP_JSON as Record<
  string,
  Record<string, { portrait: string; landscape: string }>
>;

export function productTypeFromHandle(handle: string): GelatoProductType | null {
  const h = (handle || "").toLowerCase();
  if (h.endsWith("-acrylic") || h.includes("acrylic") || h.includes("akryl")) return "acrylic";
  if (h.endsWith("-aluminum") || h.includes("aluminum") || h.includes("aluminium") || h.includes("metallic")) return "aluminum";
  if (h.includes("canvas")) return "canvas";
  if (h.includes("poster") || h.includes("karta")) return "posters";
  return null;
}

/** Direct UID lookup by Gelato catalog key (e.g. "posters"). Used by template sync. */
export function gelatoUid(
  typeKey: string,
  size: string,
  variant: string,
  orientation: "portrait" | "landscape" = "portrait",
): string | null {
  return GELATO_SKU_MAP[typeKey]?.[`${size}|${variant}`]?.[orientation] ?? null;
}

export interface ResolveResult {
  productUid: string | null;
  source: "db" | "local-exact" | "local-size-fallback" | "missing";
  detail: string;
}

/** Order-time resolution: per-handle DB override → local exact → size-only fallback.
 *  Moved verbatim from shopify-order-webhook. */
export function resolveGelatoProductUid(args: {
  handle: string;
  size: string;
  variant?: string | null;
  orientation: "portrait" | "landscape";
  productType?: GelatoProductType | null;
  dbMap?: Record<string, Record<string, string>> | null;
}): ResolveResult {
  const { handle, size, variant, orientation, productType, dbMap } = args;

  // 1) DB-mapping (per-handle override). Konsoliderade mallar har nycklar som
  //    "<type>|<size>|<variant>" — prova den först, annars legacy "size|variant".
  if (variant && dbMap) {
    if (productType && dbMap[`${productType}|${size}`]?.[variant]) {
      return { productUid: dbMap[`${productType}|${size}`][variant], source: "db", detail: `${productType}|${size}|${variant}` };
    }
    if (dbMap[size]?.[variant]) {
      return { productUid: dbMap[size][variant], source: "db", detail: `${size}|${variant}` };
    }
  }

  const ptype = productType ?? productTypeFromHandle(handle);
  if (!ptype) {
    return { productUid: null, source: "missing", detail: `unknown product type for handle="${handle}"` };
  }
  const localForType = GELATO_SKU_MAP[ptype] ?? {};

  // 2) Local exact size|variant
  if (variant && localForType[`${size}|${variant}`]?.[orientation]) {
    return {
      productUid: localForType[`${size}|${variant}`][orientation],
      source: "local-exact",
      detail: `${ptype} ${size}|${variant} ${orientation}`,
    };
  }

  // 3) Size-only fallback ONLY if variant is missing entirely.
  // If a variant was specified but didn't match exactly, we MUST fail loudly
  // instead of silently shipping the wrong product (e.g. "Hängare Ek" → flat poster).
  if (!variant) {
    const sizeMatch = Object.entries(localForType).find(([k]) => k.startsWith(`${size}|`));
    if (sizeMatch && sizeMatch[1]?.[orientation]) {
      return {
        productUid: sizeMatch[1][orientation],
        source: "local-size-fallback",
        detail: `${ptype} ${sizeMatch[0]} ${orientation} (no variant supplied)`,
      };
    }
  }

  return {
    productUid: null,
    source: "missing",
    detail: `no exact SKU for ${ptype} size=${size} variant=${variant ?? "(none)"} orientation=${orientation}`,
  };
}

// --- Order submission ---

export interface GelatoOrderItem {
  itemReferenceId: string;
  productUid: string;
  fileUrl: string;
  quantity: number;
}

export interface GelatoShippingAddress {
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postCode: string;
  country: string;
  state: string;
  email: string;
  phone: string;
}

export interface SubmitResult {
  ok: boolean;
  providerOrderId: string | null;
  /** The exact body POSTed — persisted to the order row for debugging (parity with before). */
  requestBody: unknown;
  status: number | null;
  error: string | null;
}

/** Build + POST a Gelato order. Body shape is identical to the previous inline code. */
export async function submitGelatoOrder(input: {
  apiKey: string;
  orderReferenceId: string;
  customerReferenceId: string;
  currency: string;
  items: GelatoOrderItem[];
  shippingAddress: GelatoShippingAddress;
  /**
   * Gelato order type. "draft" (the SAFE DEFAULT) creates a reviewable draft
   * that is NOT sent to production until it is approved in Gelato — so the
   * merchant can review/edit an order before it prints. "order" prints
   * immediately. This will become a per-merchant admin setting later.
   */
  orderType?: "order" | "draft";
}): Promise<SubmitResult> {
  const body = {
    orderType: input.orderType ?? "draft",
    orderReferenceId: input.orderReferenceId,
    customerReferenceId: input.customerReferenceId,
    currency: input.currency,
    items: input.items.map((i) => ({
      itemReferenceId: i.itemReferenceId,
      productUid: i.productUid,
      files: [{ type: "default", url: i.fileUrl }],
      quantity: i.quantity,
    })),
    shippingAddress: input.shippingAddress,
  };

  try {
    const res = await fetch("https://order.gelatoapis.com/v4/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": input.apiKey },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        providerOrderId: null,
        requestBody: body,
        status: res.status,
        error: JSON.stringify(json).slice(0, 800),
      };
    }
    return {
      ok: true,
      providerOrderId: json.id ?? json.orderId ?? null,
      requestBody: body,
      status: res.status,
      error: null,
    };
  } catch (e) {
    return { ok: false, providerOrderId: null, requestBody: body, status: null, error: String(e) };
  }
}

// --- Catalog import (Phase 3b slice 1) ---
//
// provider.getProductCatalog(): fetch Gelato's FULL public catalog list and map
// each catalog's productAttributes to GENERIC variant axes — this is what
// replaces the hardcoded 4-category/size/frame vocabulary (gelato-fetch-uids).
// Consumed by the `pod-catalog-import` edge function, which upserts the result
// into `product_bases`.
//
// Verified API shape (Gelato docs):
//   GET /v3/catalogs        → [{ catalogUid, title }]
//   GET /v3/catalogs/{uid}  → { catalogUid, title, productAttributes:
//     [{ productAttributeUid, title, values: [{ productAttributeValueUid, title }] }] }

const GELATO_PRODUCT_API = "https://product.gelatoapis.com/v3";

export interface VariantAxisValue {
  key: string;
  label: string;
}

export interface VariantAxis {
  key: string;
  label: string;
  values: VariantAxisValue[];
}

/** One provider catalog/product family, normalized for `product_bases`. */
export interface CatalogBase {
  providerProductId: string; // Gelato catalogUid
  title: string;
  variantAxes: VariantAxis[];
  raw: unknown; // the provider payload as returned (debugging / re-derivation)
}

async function gelatoProductApi(path: string, apiKey: string): Promise<any> {
  const res = await fetch(`${GELATO_PRODUCT_API}${path}`, {
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep raw text for the error below */ }
  if (!res.ok) {
    throw new Error(`Gelato ${path} ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

/**
 * Fetch every Gelato catalog + its attributes as normalized bases.
 *
 * A single broken catalog must not sink the whole import — Gelato's own API
 * 550s on some of its catalogs (observed live: "default-flat-prices") — so
 * per-catalog failures are collected in `failed` and the rest imports fine.
 */
export async function getProductCatalog(
  apiKey: string,
): Promise<{ bases: CatalogBase[]; failed: { id: string; error: string }[] }> {
  const list = await gelatoProductApi("/catalogs", apiKey);
  // Tolerate both a bare array and a wrapped { data: [...] } response.
  const catalogs: any[] = Array.isArray(list) ? list : (list?.data ?? []);

  const out: CatalogBase[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const c of catalogs) {
    const uid = c?.catalogUid ? String(c.catalogUid) : null;
    if (!uid) continue;
    let detail: any;
    try {
      detail = await gelatoProductApi(`/catalogs/${encodeURIComponent(uid)}`, apiKey);
    } catch (e) {
      failed.push({ id: uid, error: String(e) });
      continue;
    }
    out.push({
      providerProductId: String(detail?.catalogUid ?? uid),
      title: String(detail?.title ?? c?.title ?? uid),
      variantAxes: (Array.isArray(detail?.productAttributes) ? detail.productAttributes : []).map(
        (a: any): VariantAxis => ({
          key: String(a?.productAttributeUid ?? ""),
          label: String(a?.title ?? a?.productAttributeUid ?? ""),
          values: (Array.isArray(a?.values) ? a.values : []).map(
            (v: any): VariantAxisValue => ({
              key: String(v?.productAttributeValueUid ?? ""),
              label: String(v?.title ?? v?.productAttributeValueUid ?? ""),
            }),
          ),
        }),
      ),
      raw: detail,
    });
  }
  return { bases: out, failed };
}

// --- Fulfillment parsing (Phase 3a slice 2b) ---
//
// Gelato reports fulfillment + tracking in two different shapes, and both are
// Gelato-specific, so the parsing lives here (behind the adapter) and the edge
// functions stay provider-agnostic:
//   1. Webhook EVENTS (order_status_updated, order_item_tracking_code_updated, …)
//      → parseFulfillmentWebhook(). Consumed by gelato-webhook.
//   2. The Order API response (GET /v4/orders/:id) → parseGelatoOrderResponse().
//      Consumed by gelato-backfill, which polls that endpoint.
//
// Logic moved VERBATIM from the previous inline copies so behavior is identical.
// The status → ship/event MAPPING intentionally stays in each caller: the webhook
// and backfill use deliberately different SHIP_STATUSES sets, so unifying them
// here would change behavior. This slice moves the parse only.

export interface TrackingInfo {
  number: string | null;
  url: string | null;
  company: string | null;
}

export interface ParsedFulfillmentEvent {
  eventType: string;           // Gelato's event name, e.g. "order_status_updated"
  eventId: string | null;      // Gelato's event id, e.g. "os_5e5680ce494f6"
  status: string;              // fulfillmentStatus / status (lower-case)
  gelatoOrderId: string | null;
  shopifyOrderName: string | null; // our orderReferenceId (e.g. "#1042")
  trackingInfo: TrackingInfo;
  fulfillmentCount: number;    // for logging
}

/** Pick the first tracking entry from a Gelato webhook event. (Was pickTracking.) */
function pickWebhookTracking(event: any): { info: TrackingInfo; count: number } {
  // order_item_tracking_code_updated: everything on root.
  if (event?.event === "order_item_tracking_code_updated") {
    return {
      info: {
        number: event.trackingCode ?? null,
        url: event.trackingUrl ?? null,
        company: event.shipmentMethodName ?? "Gelato",
      },
      count: event.trackingCode ? 1 : 0,
    };
  }

  // order_status_updated: items[].fulfillments[]
  let count = 0;
  let first: any = null;
  const items = Array.isArray(event?.items) ? event.items : [];
  for (const item of items) {
    const fs = Array.isArray(item?.fulfillments) ? item.fulfillments : [];
    for (const f of fs) {
      count += 1;
      if (!first && f?.trackingCode) first = f;
    }
  }
  if (!first && items[0]?.fulfillments?.[0]) first = items[0].fulfillments[0];

  return {
    info: {
      number: first?.trackingCode ?? null,
      url: first?.trackingUrl ?? null,
      company: first?.shipmentMethodName ?? "Gelato",
    },
    count,
  };
}

/** Parse a Gelato fulfillment WEBHOOK event into normalized fields. (Was parseGelatoEvent.) */
export function parseFulfillmentWebhook(event: any): ParsedFulfillmentEvent {
  const eventType = String(event?.event ?? "").trim();
  const eventId = event?.id ? String(event.id) : null;

  // Status per event type:
  //   order_status_updated             → fulfillmentStatus
  //   order_item_status_updated        → status
  //   order_item_tracking_code_updated → always "shipped"-ish (use eventType)
  //   order_delivery_estimate_updated  → no status
  const status = String(event?.fulfillmentStatus ?? event?.status ?? "")
    .toLowerCase()
    .trim();

  const gelatoOrderId = event?.orderId ? String(event.orderId) : null;
  const shopifyOrderName = event?.orderReferenceId ? String(event.orderReferenceId) : null;

  const { info: trackingInfo, count: fulfillmentCount } = pickWebhookTracking(event);

  return { eventType, eventId, status, gelatoOrderId, shopifyOrderName, trackingInfo, fulfillmentCount };
}

/**
 * Parse a Gelato Order API response (GET /v4/orders/:id) into a normalized
 * status + tracking. (Was the inline status derivation + extractTracking in
 * gelato-backfill.)
 */
export function parseGelatoOrderResponse(g: any): { status: string; trackingInfo: TrackingInfo } {
  const status = String(g?.fulfillmentStatus ?? g?.status ?? "").toLowerCase();
  const ship =
    (Array.isArray(g?.shipment?.fulfillments) && g.shipment.fulfillments[0]) ||
    (Array.isArray(g?.fulfillments) && g.fulfillments[0]) ||
    g?.shipment ||
    {};
  return {
    status,
    trackingInfo: {
      number: ship.trackingCode ?? ship.trackingNumber ?? null,
      url: ship.trackingUrl ?? null,
      company: ship.shipmentMethodName ?? ship.carrier ?? "Gelato",
    },
  };
}
