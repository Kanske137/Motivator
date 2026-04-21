// Receives Shopify orders/paid webhooks. Verifies HMAC, then asynchronously
// generates print files and submits a Gelato order.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shopify-hmac-sha256, x-shopify-topic, x-shopify-shop-domain",
};

const SHOPIFY_API_VERSION = "2025-07";

// Local Gelato UID resolver (mirror of src/lib/gelato.ts logic, kept simple)
function resolveProductUid(args: {
  size: string;
  variant?: string | null;
  orientation: "portrait" | "landscape";
  dbMap?: Record<string, Record<string, string>> | null;
}): string | null {
  const { size, variant, dbMap } = args;
  if (variant && dbMap?.[size]?.[variant]) return dbMap[size][variant];
  // Fallback: any variant for that size
  const sizeRow = dbMap?.[size];
  if (sizeRow) {
    const first = Object.values(sizeRow)[0];
    if (first) return first;
  }
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
  // constant-time-ish compare
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
    ?? "canvas-poster-creator-2wh5d.myshopify.com";
  const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");

  if (!gelatoKey) {
    await supabase.from("gelato_orders").update({ status: "gelato_failed", error: "GELATO_API_KEY missing" })
      .eq("shopify_order_id", shopifyOrderId);
    return;
  }

  // Load all product configs once for SKU mapping
  const { data: configs } = await supabase.from("product_configs").select("shopify_handle, gelato_sku_map");
  const configByHandle: Record<string, any> = {};
  (configs ?? []).forEach((c: any) => { configByHandle[c.shopify_handle] = c; });

  const items: any[] = [];
  const errors: string[] = [];

  for (const li of order.line_items ?? []) {
    const props = li.properties as Array<{ name: string; value: string }> | undefined;
    const styleId = getProp(props, "_map_style");
    const centerStr = getProp(props, "_map_center");
    const zoomStr = getProp(props, "_map_zoom");
    const size = getProp(props, "_size");
    const variant = getProp(props, "_variant");
    const bgColor = getProp(props, "_bg_color") ?? "#FFFFFF";
    const orientation = (getProp(props, "_orientation") ?? "portrait") as "portrait" | "landscape";
    const handle = getProp(props, "_product_handle") ?? li.product_handle ?? "";
    const text = getProp(props, "Text") ?? "";

    if (!styleId || !centerStr || !zoomStr || !size) {
      // Not one of our editor items — skip silently
      continue;
    }

    const [latStr, lngStr] = centerStr.split(",");
    const center: [number, number] = [parseFloat(lngStr), parseFloat(latStr)];
    const zoom = parseFloat(zoomStr);

    // 1) Generate print file
    let printUrl: string | null = null;
    try {
      const res = await fetch(`${projectUrl}/functions/v1/generate-print-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
        body: JSON.stringify({
          styleId, center, zoom, size, orientation,
          text, textVisible: !!text,
          posterBgColor: bgColor,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(`generate-print-file ${res.status}: ${JSON.stringify(json)}`);
      printUrl = json.url ?? json.publicUrl ?? json.printUrl ?? null;
      if (!printUrl) throw new Error("no print URL returned");
    } catch (e) {
      errors.push(`line ${li.id}: print ${String(e)}`);
      continue;
    }

    // 2) Resolve productUid
    const cfg = configByHandle[handle];
    const productUid = resolveProductUid({
      size: size!,
      variant,
      orientation,
      dbMap: cfg?.gelato_sku_map ?? null,
    });
    if (!productUid) {
      errors.push(`line ${li.id}: no productUid for ${handle} ${size}|${variant}`);
      continue;
    }

    items.push({
      itemReferenceId: String(li.id),
      productUid,
      files: [{ type: "default", url: printUrl }],
      quantity: li.quantity ?? 1,
    });
  }

  if (items.length === 0) {
    await supabase.from("gelato_orders").update({
      status: errors.length ? "print_failed" : "skipped",
      error: errors.join(" | ") || "no editor items in order",
    }).eq("shopify_order_id", shopifyOrderId);
    return;
  }

  // 3) Build Gelato order
  const ship = order.shipping_address ?? order.billing_address ?? {};
  const gelatoBody = {
    orderType: "order",
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
  };

  try {
    const res = await fetch("https://order.gelatoapis.com/v4/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": gelatoKey },
      body: JSON.stringify(gelatoBody),
    });
    const json = await res.json();
    if (!res.ok) {
      await supabase.from("gelato_orders").update({
        status: "gelato_failed",
        error: `${res.status}: ${JSON.stringify(json).slice(0, 800)}`,
        payload: gelatoBody,
      }).eq("shopify_order_id", shopifyOrderId);

      // Add a note on the Shopify order for visibility
      if (shopifyDomain && shopifyToken) {
        await fetch(`https://${shopifyDomain}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}.json`, {
          method: "PUT",
          headers: { "X-Shopify-Access-Token": shopifyToken, "Content-Type": "application/json" },
          body: JSON.stringify({ order: { id: shopifyOrderId, note: `Gelato fail: ${res.status}` } }),
        }).catch(() => {});
      }
      return;
    }
    await supabase.from("gelato_orders").update({
      status: "submitted",
      gelato_order_id: json.id ?? json.orderId ?? null,
      payload: gelatoBody,
      error: errors.length ? errors.join(" | ") : null,
    }).eq("shopify_order_id", shopifyOrderId);
  } catch (e) {
    await supabase.from("gelato_orders").update({
      status: "gelato_failed", error: String(e), payload: gelatoBody,
    }).eq("shopify_order_id", shopifyOrderId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const rawBody = await req.text();
  const hmac = req.headers.get("X-Shopify-Hmac-Sha256");

  // Use API secret for HMAC verification (Shopify signs webhooks with the app's API secret)
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

  // Idempotent insert
  const shopifyOrderId = String(order.id);
  const { error: insertErr } = await supabase.from("gelato_orders").insert({
    shopify_order_id: shopifyOrderId,
    shopify_order_name: order.name ?? null,
    status: "received",
  });

  if (insertErr) {
    // Duplicate → already processed (or in flight)
    if (String(insertErr.code) === "23505" || String(insertErr.message).includes("duplicate")) {
      return new Response("already processed", { status: 200, headers: corsHeaders });
    }
    console.error("insert error", insertErr);
    return new Response("db error", { status: 500, headers: corsHeaders });
  }

  // Respond fast, do work in background
  // @ts-ignore — EdgeRuntime is available in Supabase Edge Functions
  EdgeRuntime.waitUntil(processOrder(supabase, order));

  return new Response("ok", { status: 200, headers: corsHeaders });
});
