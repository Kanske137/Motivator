// Receives Shopify orders/paid webhooks. Verifies HMAC, then asynchronously
// generates print files and submits a Gelato order.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  resolveGelatoProductUid,
  productTypeFromHandle,
  submitGelatoOrder,
  type GelatoProductType,
  type GelatoOrderItem,
} from "../_shared/pod/gelato.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shopify-hmac-sha256, x-shopify-topic, x-shopify-shop-domain",
};

const SHOPIFY_API_VERSION = "2025-07";

// SKU map, UID resolution and the Gelato order API now live in the shared Gelato
// adapter (_shared/pod/gelato.ts). This function only parses Shopify props.
type ProductType = GelatoProductType;

function normalizeProductType(raw: string | null | undefined): ProductType | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === "poster" || v === "posters") return "posters";
  if (v === "canvas") return "canvas";
  if (v === "aluminum" || v === "aluminium" || v === "metallic" || v === "metallposter") return "aluminum";
  if (v === "acrylic" || v === "akryl" || v === "plexiglas") return "acrylic";
  return null;
}

async function verifyHmac(rawBody: string, hmacHeader: string | null, secret: string): Promise<boolean> {
  if (!hmacHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const digest = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (digest.length !== hmacHeader.length) return false;
  let mismatch = 0;
  for (let i = 0; i < digest.length; i++) mismatch |= digest.charCodeAt(i) ^ hmacHeader.charCodeAt(i);
  return mismatch === 0;
}

function getProp(props: Array<{ name: string; value: string }> | undefined, name: string): string | null {
  if (!Array.isArray(props)) return null;
  const p = props.find((x) => x.name === name);
  return p ? String(p.value) : null;
}

async function processOrder(supabase: any, order: any) {
  const shopifyOrderId = String(order.id);
  const shopifyOrderName = String(order.name ?? "");
  const projectUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const gelatoKey = Deno.env.get("GELATO_API_KEY");
  const shopifyDomain = Deno.env.get("SHOPIFY_STORE_PERMANENT_DOMAIN")
    ?? Deno.env.get("SHOPIFY_STORE_DOMAIN")
    ?? "wdxugd-yq.myshopify.com";
  const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");

  if (!gelatoKey) {
    await supabase.from("gelato_orders").update({ status: "gelato_failed", error: "GELATO_API_KEY missing" })
      .eq("shopify_order_id", shopifyOrderId);
    return;
  }

  // Load DB overrides per handle
  const { data: configs } = await supabase.from("product_configs").select("shopify_handle, gelato_sku_map");
  const configByHandle: Record<string, any> = {};
  (configs ?? []).forEach((c: any) => { configByHandle[c.shopify_handle] = c; });

  const items: GelatoOrderItem[] = [];
  const printErrors: string[] = [];
  const skuErrors: string[] = [];

  for (const li of order.line_items ?? []) {
    const props = li.properties as Array<{ name: string; value: string }> | undefined;

    // Observability: log every property name + value-length received per line
    // item. Critical for diagnosing missing _print_file_url after a checkout.
    if (Array.isArray(props) && props.length) {
      const summary = props.map((p) => `${p.name}(${String(p.value ?? "").length})`).join(", ");
      console.log(`[shopify-webhook] line ${li.id}: properties received: ${summary}`);
    } else {
      console.log(`[shopify-webhook] line ${li.id}: NO properties received`);
    }

    const size = getProp(props, "_size");
    const variant = getProp(props, "_variant");
    const orientation = (getProp(props, "_orientation") ?? "portrait") as "portrait" | "landscape";
    const handle = getProp(props, "_product_handle") ?? li.product_handle ?? "";
    const clientPrintFileUrl = getProp(props, "_print_file_url");
    const designSource = getProp(props, "_design_source") ?? "map";
    // Konsoliderade produkter skickar _product_type explicit. Fallback för
    // gamla beställningar: utled från handle-suffix.
    const productType =
      normalizeProductType(getProp(props, "_product_type"))
      ?? productTypeFromHandle(handle);

    if (!size) continue; // not an editor item

    console.log(
      `[shopify-webhook] line ${li.id}: clientPrintFileUrl=${clientPrintFileUrl ?? "MISSING"} source=${designSource}`
    );

    // 1) Print file: REQUIRED to come from the client (single pipeline). No
    //    legacy server-side fallback — that path renders text incorrectly and
    //    cannot disable map labels, which produced broken Gelato orders.
    if (!clientPrintFileUrl) {
      printErrors.push(`line ${li.id}: missing _print_file_url (source=${designSource})`);
      continue;
    }
    const printUrl = clientPrintFileUrl;
    console.log(`[shopify-webhook] line ${li.id}: using client print file ${printUrl}`);


    // 2) Resolve productUid
    const cfg = configByHandle[handle];
    const resolved = resolveGelatoProductUid({
      handle,
      size: size!,
      variant,
      orientation,
      productType,
      dbMap: cfg?.gelato_sku_map ?? null,
    });

    console.log(
      `[shopify-webhook] line ${li.id}: handle="${handle}" size=${size} variant=${variant} orient=${orientation} → source=${resolved.source} uid=${resolved.productUid ?? "NONE"} (${resolved.detail})`
    );

    if (!resolved.productUid) {
      skuErrors.push(`line ${li.id}: ${resolved.detail}`);
      continue;
    }

    items.push({
      itemReferenceId: String(li.id),
      productUid: resolved.productUid,
      fileUrl: printUrl,
      quantity: li.quantity ?? 1,
    });
  }

  if (items.length === 0) {
    const status = printErrors.length ? "pending_manual"
      : skuErrors.length ? "sku_not_found"
      : "skipped";
    const error = printErrors.length
      ? `missing_print_file_url — ${printErrors.join(" | ")}`
      : [...skuErrors].join(" | ") || "no editor items in order";
    console.warn(`[shopify-webhook] order ${shopifyOrderId} → ${status}: ${error}`);
    await supabase.from("gelato_orders").update({ status, error })
      .eq("shopify_order_id", shopifyOrderId);
    return;
  }

  // 3) Build + submit the provider order (Gelato adapter).
  const ship = order.shipping_address ?? order.billing_address ?? {};
  const partialErrors = [...printErrors, ...skuErrors];

  const result = await submitGelatoOrder({
    apiKey: gelatoKey,
    orderReferenceId: shopifyOrderName || shopifyOrderId,
    customerReferenceId: shopifyOrderId,
    currency: order.currency ?? "SEK",
    items,
    shippingAddress: {
      firstName: ship.first_name ?? "",
      lastName: ship.last_name ?? "",
      addressLine1: ship.address1 ?? "",
      addressLine2: ship.address2 ?? "",
      city: ship.city ?? "",
      postCode: ship.zip ?? "",
      country: ship.country_code ?? "SE",
      state: ship.province_code ?? "",
      email: order.email ?? order.contact_email ?? "",
      phone: ship.phone ?? order.phone ?? "",
    },
  });

  if (!result.ok) {
    console.error(`[shopify-webhook] Gelato API failed ${result.status}:`, String(result.error).slice(0, 800));
    await supabase.from("gelato_orders").update({
      status: "gelato_failed",
      error: result.status ? `${result.status}: ${result.error}` : String(result.error),
      payload: result.requestBody,
    }).eq("shopify_order_id", shopifyOrderId);

    if (result.status && shopifyDomain && shopifyToken) {
      await fetch(`https://${shopifyDomain}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}.json`, {
        method: "PUT",
        headers: { "X-Shopify-Access-Token": shopifyToken, "Content-Type": "application/json" },
        body: JSON.stringify({ order: { id: shopifyOrderId, note: `Gelato fail: ${result.status}` } }),
      }).catch(() => {});
    }
    return;
  }

  console.log(`[shopify-webhook] Gelato order submitted: ${result.providerOrderId}`);
  await supabase.from("gelato_orders").update({
    status: "submitted",
    gelato_order_id: result.providerOrderId,
    payload: result.requestBody,
    error: partialErrors.length ? partialErrors.join(" | ") : null,
  }).eq("shopify_order_id", shopifyOrderId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const rawBody = await req.text();
  const hmac = req.headers.get("X-Shopify-Hmac-Sha256");

  const secret = Deno.env.get("SHOPIFY_API_SECRET") ?? Deno.env.get("SHOPIFY_WEBHOOK_SECRET");
  if (secret) {
    const ok = await verifyHmac(rawBody, hmac, secret);
    if (!ok) {
      console.warn("HMAC verification failed");
      return new Response("invalid hmac", { status: 401, headers: corsHeaders });
    }
  } else {
    console.warn("No SHOPIFY_API_SECRET configured — accepting webhook unverified (DEV)");
  }

  let order: any;
  try { order = JSON.parse(rawBody); } catch {
    return new Response("bad json", { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const shopifyOrderId = String(order.id);
  const { error: insertErr } = await supabase.from("gelato_orders").insert({
    shopify_order_id: shopifyOrderId,
    shopify_order_name: order.name ?? null,
    status: "received",
  });

  if (insertErr) {
    if (String(insertErr.code) === "23505" || String(insertErr.message).includes("duplicate")) {
      return new Response("already processed", { status: 200, headers: corsHeaders });
    }
    console.error("insert error", insertErr);
    return new Response("db error", { status: 500, headers: corsHeaders });
  }

  // @ts-ignore — EdgeRuntime is available in Supabase Edge Functions
  EdgeRuntime.waitUntil(processOrder(supabase, order));

  return new Response("ok", { status: 200, headers: corsHeaders });
});
