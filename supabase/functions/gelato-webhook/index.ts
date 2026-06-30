// Gelato → Shopify fulfillment & leveranssync.
//
// Tar emot Gelatos order-status-webhook och, beroende på status:
//   1) "shipped"          → skapar Shopify-fulfillment + tracking, mejlar kund
//   2) "in_transit" / "out_for_delivery" / "delivered" → postar fulfillment-event
//   3) övrigt (created/printed/etc.) → loggas bara
//
// Auth: shared secret via ?secret=... eller header x-gelato-secret.
// JWT-verifiering är AVSTÄNGD (publik webhook, se supabase/config.toml).
//
// Idempotens:
//   - gelato_orders.last_status === status ⇒ no-op
//   - shopify_fulfillment_gid återanvänds när det redan finns
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { shopifyAdmin } from "../_shared/shopify-admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-gelato-secret",
};

// --- CONFIRM mot riktig Gelato-payload --------------------------------------
// Gelatos webhooks levererar olika fält beroende på event-typ. Verifiera
// nedanstående status-strängar och fältnamn med en riktig payload, justera vid
// behov. Allt är skrivet defensivt så det går att byta utan att omforma flödet.
const SHIP_STATUSES = new Set(["shipped"]);
const EVENT_MAP: Record<string, string> = {
  in_transit: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
};
// ----------------------------------------------------------------------------

const OPEN_FOS = `
  query($id: ID!) {
    order(id: $id) {
      displayFulfillmentStatus
      fulfillmentOrders(first: 10) {
        nodes { id status supportedActions { action } }
      }
    }
  }`;

const CREATE_FULFILLMENT = `
  mutation($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }`;

const CREATE_EVENT = `
  mutation($fulfillmentEvent: FulfillmentEventInput!) {
    fulfillmentEventCreate(fulfillmentEvent: $fulfillmentEvent) {
      fulfillmentEvent { id status }
      userErrors { field message }
    }
  }`;

interface TrackingInfo {
  number: string | null;
  url: string | null;
  company: string | null;
}

async function ensureFulfillment(
  shopifyOrderGid: string,
  trackingInfo: TrackingInfo,
  existingFulfillmentGid: string | null,
): Promise<string | null> {
  if (existingFulfillmentGid) return existingFulfillmentGid;

  const data = await shopifyAdmin<{
    order: {
      displayFulfillmentStatus: string;
      fulfillmentOrders: { nodes: Array<{ id: string; status: string; supportedActions: Array<{ action: string }> }> };
    } | null;
  }>(OPEN_FOS, { id: shopifyOrderGid });

  if (!data.order) {
    console.warn(`[gelato-webhook] no shopify order found for ${shopifyOrderGid}`);
    return null;
  }
  if (data.order.displayFulfillmentStatus === "FULFILLED") {
    console.log(`[gelato-webhook] ${shopifyOrderGid} already FULFILLED outside our flow`);
    return null;
  }

  const openFOs = (data.order.fulfillmentOrders.nodes ?? [])
    .filter(
      (fo) =>
        fo.status === "OPEN" &&
        fo.supportedActions.some((a) => a.action === "CREATE_FULFILLMENT"),
    )
    .map((fo) => ({ fulfillmentOrderId: fo.id }));

  if (openFOs.length === 0) {
    console.warn(`[gelato-webhook] ${shopifyOrderGid} has no open fulfillment orders`);
    return null;
  }

  const res = await shopifyAdmin<{
    fulfillmentCreate: {
      fulfillment: { id: string; status: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(CREATE_FULFILLMENT, {
    fulfillment: {
      lineItemsByFulfillmentOrder: openFOs,
      trackingInfo: {
        number: trackingInfo.number,
        url: trackingInfo.url,
        company: trackingInfo.company,
      },
      notifyCustomer: true,
    },
  });

  const errs = res.fulfillmentCreate.userErrors ?? [];
  if (errs.length) {
    throw new Error(`fulfillmentCreate: ${JSON.stringify(errs)}`);
  }
  return res.fulfillmentCreate.fulfillment?.id ?? null;
}

async function postEvent(fulfillmentGid: string, status: string) {
  const res = await shopifyAdmin<{
    fulfillmentEventCreate: {
      fulfillmentEvent: { id: string; status: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(CREATE_EVENT, {
    fulfillmentEvent: {
      fulfillmentId: fulfillmentGid,
      status,
      happenedAt: new Date().toISOString(),
    },
  });
  const errs = res.fulfillmentEventCreate.userErrors ?? [];
  if (errs.length) {
    // Logga men kasta inte — Gelato har redan levererat eventet, vi vill inte loopa retries.
    console.error(`[gelato-webhook] fulfillmentEventCreate userErrors`, errs);
  }
}

function parseGelatoEvent(event: any): {
  status: string;
  gelatoOrderId: string | null;
  shopifyOrderName: string | null;
  shopifyOrderId: string | null;
  trackingInfo: TrackingInfo;
} {
  // CONFIRM: justera fältsökvägar när du sett en riktig Gelato-webhook.
  const status = String(
    event?.fulfillmentStatus ?? event?.event ?? event?.status ?? "",
  )
    .toLowerCase()
    .trim();

  const gelatoOrderId =
    event?.orderId ?? event?.id ?? event?.order?.id ?? null;

  // Vi sätter orderReferenceId = shopifyOrderName (ex "#1042") och
  // customerReferenceId = shopifyOrderId (numeriskt) i shopify-order-webhook.
  const shopifyOrderName = event?.orderReferenceId ?? event?.order?.orderReferenceId ?? null;
  const shopifyOrderId = event?.customerReferenceId ?? event?.order?.customerReferenceId ?? null;

  // Shipment-info kan finnas på roten, i fulfillments[0] eller i shipment.
  const ship =
    (Array.isArray(event?.fulfillments) && event.fulfillments[0]) ||
    event?.shipment ||
    (Array.isArray(event?.shipment?.fulfillments) && event.shipment.fulfillments[0]) ||
    event ||
    {};

  const trackingInfo: TrackingInfo = {
    number: ship.trackingCode ?? ship.trackingNumber ?? event?.trackingCode ?? null,
    url: ship.trackingUrl ?? event?.trackingUrl ?? null,
    company:
      ship.shipmentMethodName ??
      ship.carrier ??
      ship.carrierName ??
      event?.shipmentMethodName ??
      "Gelato",
  };

  return {
    status,
    gelatoOrderId: gelatoOrderId ? String(gelatoOrderId) : null,
    shopifyOrderName: shopifyOrderName ? String(shopifyOrderName) : null,
    shopifyOrderId: shopifyOrderId ? String(shopifyOrderId) : null,
    trackingInfo,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 1) Authenticate
    const url = new URL(req.url);
    const secret =
      req.headers.get("x-gelato-secret") ?? url.searchParams.get("secret");
    const expected = Deno.env.get("GELATO_WEBHOOK_SECRET");
    if (!expected) {
      console.error("[gelato-webhook] GELATO_WEBHOOK_SECRET not configured");
      return new Response("misconfigured", { status: 500, headers: corsHeaders });
    }
    if (secret !== expected) {
      return new Response("unauthorized", { status: 401, headers: corsHeaders });
    }

    const event = await req.json().catch(() => null);
    if (!event) {
      return new Response("bad json", { status: 400, headers: corsHeaders });
    }

    const parsed = parseGelatoEvent(event);
    console.log(
      `[gelato-webhook] received status=${parsed.status} gelatoOrderId=${parsed.gelatoOrderId} ref=${parsed.shopifyOrderName} cust=${parsed.shopifyOrderId}`,
    );

    if (!parsed.status) {
      return new Response("no status", { status: 200, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 2) Hitta vår länk-rad. Sök primärt på gelato_order_id, fall tillbaka på
    //    shopify_order_id/shopify_order_name.
    let link: any = null;
    if (parsed.gelatoOrderId) {
      const r = await supabase
        .from("gelato_orders")
        .select("*")
        .eq("gelato_order_id", parsed.gelatoOrderId)
        .maybeSingle();
      link = r.data ?? null;
    }
    if (!link && parsed.shopifyOrderId) {
      const r = await supabase
        .from("gelato_orders")
        .select("*")
        .eq("shopify_order_id", parsed.shopifyOrderId)
        .maybeSingle();
      link = r.data ?? null;
    }
    if (!link && parsed.shopifyOrderName) {
      const r = await supabase
        .from("gelato_orders")
        .select("*")
        .eq("shopify_order_name", parsed.shopifyOrderName)
        .maybeSingle();
      link = r.data ?? null;
    }

    if (!link) {
      console.warn(`[gelato-webhook] no gelato_orders row matched event`);
      return new Response("no link", { status: 200, headers: corsHeaders });
    }

    // 3) Idempotens
    if (link.last_status === parsed.status) {
      return new Response("duplicate status", { status: 200, headers: corsHeaders });
    }

    const shopifyOrderGid =
      link.shopify_order_gid ?? `gid://shopify/Order/${link.shopify_order_id}`;

    const isShip = SHIP_STATUSES.has(parsed.status);
    const eventStatus = EVENT_MAP[parsed.status];

    // 4) Statuses we don't act on — bara logga
    if (!isShip && !eventStatus) {
      await supabase
        .from("gelato_orders")
        .update({
          last_status: parsed.status,
          raw: event,
          shopify_order_gid: shopifyOrderGid,
          ...(parsed.gelatoOrderId && !link.gelato_order_id
            ? { gelato_order_id: parsed.gelatoOrderId }
            : {}),
        })
        .eq("id", link.id);
      return new Response("recorded", { status: 200, headers: corsHeaders });
    }

    // 5) Säkerställ fulfillment (skapas + mejlas kund första gången)
    const fulfillmentGid = await ensureFulfillment(
      shopifyOrderGid,
      parsed.trackingInfo,
      link.shopify_fulfillment_gid ?? null,
    );

    if (!fulfillmentGid) {
      await supabase
        .from("gelato_orders")
        .update({
          last_status: parsed.status,
          raw: event,
          shopify_order_gid: shopifyOrderGid,
        })
        .eq("id", link.id);
      return new Response("no open fulfillment orders", { status: 200, headers: corsHeaders });
    }

    // 6) Post status-event om sådan mappning finns
    if (eventStatus) {
      await postEvent(fulfillmentGid, eventStatus);
    }

    // 7) Persist
    const patch: Record<string, unknown> = {
      shopify_order_gid: shopifyOrderGid,
      shopify_fulfillment_gid: fulfillmentGid,
      last_status: parsed.status,
      tracking_code: parsed.trackingInfo.number,
      tracking_url: parsed.trackingInfo.url,
      carrier: parsed.trackingInfo.company,
      raw: event,
    };
    if (parsed.gelatoOrderId && !link.gelato_order_id) {
      patch.gelato_order_id = parsed.gelatoOrderId;
    }
    if (isShip && !link.fulfilled_at) {
      patch.fulfilled_at = new Date().toISOString();
    }
    if (eventStatus === "DELIVERED" && !link.delivered_at) {
      patch.delivered_at = new Date().toISOString();
    }

    await supabase.from("gelato_orders").update(patch).eq("id", link.id);

    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error("[gelato-webhook] error", e);
    // 5xx ⇒ Gelato gör retry
    return new Response("error", { status: 500, headers: corsHeaders });
  }
});
