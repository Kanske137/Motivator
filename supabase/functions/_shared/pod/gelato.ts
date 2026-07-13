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
}): Promise<SubmitResult> {
  const body = {
    orderType: "order",
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
