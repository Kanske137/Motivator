// Engångsbackfill: hämtar Shopify-ordrar med displayFulfillmentStatus = UNFULFILLED,
// slår upp deras Gelato-status via Gelato Order API, och kör samma fulfillment-
// och event-flöde som webhooken om de redan är shipped/delivered.
//
// Idempotent — säker att köra om. Anropas manuellt (kräver Bearer-JWT).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { shopifyAdmin } from "../_shared/shopify-admin.ts";
import { parseGelatoOrderResponse } from "../_shared/pod/gelato.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHIP_STATUSES = new Set(["shipped"]);
const EVENT_MAP: Record<string, string> = {
  in_transit: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
};

const UNFULFILLED_ORDERS = `
  query($cursor: String) {
    orders(first: 50, after: $cursor, query: "fulfillment_status:unfulfilled") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        displayFulfillmentStatus
        fulfillmentOrders(first: 10) {
          nodes { id status supportedActions { action } }
        }
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

async function fetchGelatoOrder(gelatoOrderId: string): Promise<any | null> {
  const key = Deno.env.get("GELATO_API_KEY");
  if (!key) throw new Error("GELATO_API_KEY missing");
  const r = await fetch(`https://order.gelatoapis.com/v4/orders/${gelatoOrderId}`, {
    headers: { "X-API-KEY": key },
  });
  if (!r.ok) {
    console.warn(`[gelato-backfill] Gelato API ${r.status} for ${gelatoOrderId}`);
    return null;
  }
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const summary = {
      scanned: 0,
      matched: 0,
      fulfilled: 0,
      eventsPosted: 0,
      skipped: 0,
      errors: [] as string[],
    };

    let cursor: string | null = null;
    let pages = 0;
    while (pages < 20) {
      pages++;
      const data = await shopifyAdmin<any>(UNFULFILLED_ORDERS, { cursor });
      const nodes = data.orders.nodes ?? [];
      for (const order of nodes) {
        summary.scanned++;
        const numericId = String(order.id).replace("gid://shopify/Order/", "");

        const { data: link } = await supabase
          .from("pod_orders")
          .select("*")
          .eq("shopify_order_id", numericId)
          .maybeSingle();
        if (!link?.provider_order_id) {
          summary.skipped++;
          continue;
        }
        summary.matched++;

        let gelato: any;
        try {
          gelato = await fetchGelatoOrder(link.provider_order_id);
        } catch (e) {
          summary.errors.push(`gelato fetch ${link.provider_order_id}: ${String(e)}`);
          continue;
        }
        if (!gelato) {
          summary.skipped++;
          continue;
        }

        const { status, trackingInfo } = parseGelatoOrderResponse(gelato);
        const isShip = SHIP_STATUSES.has(status);
        const eventStatus = EVENT_MAP[status];
        if (!isShip && !eventStatus) {
          summary.skipped++;
          continue;
        }

        // ensure fulfillment
        let fulfillmentGid = link.shopify_fulfillment_gid ?? null;
        if (!fulfillmentGid) {
          const openFOs = (order.fulfillmentOrders.nodes ?? [])
            .filter(
              (fo: any) =>
                fo.status === "OPEN" &&
                fo.supportedActions.some((a: any) => a.action === "CREATE_FULFILLMENT"),
            )
            .map((fo: any) => ({ fulfillmentOrderId: fo.id }));
          if (openFOs.length === 0) {
            summary.skipped++;
            continue;
          }
          try {
            const r = await shopifyAdmin<any>(CREATE_FULFILLMENT, {
              fulfillment: {
                lineItemsByFulfillmentOrder: openFOs,
                trackingInfo,
                notifyCustomer: true,
              },
            });
            const errs = r.fulfillmentCreate.userErrors ?? [];
            if (errs.length) {
              summary.errors.push(`fulfillmentCreate ${order.name}: ${JSON.stringify(errs)}`);
              continue;
            }
            fulfillmentGid = r.fulfillmentCreate.fulfillment?.id ?? null;
            if (fulfillmentGid) summary.fulfilled++;
          } catch (e) {
            summary.errors.push(`fulfillmentCreate ${order.name}: ${String(e)}`);
            continue;
          }
        }

        if (fulfillmentGid && eventStatus) {
          try {
            await shopifyAdmin<any>(CREATE_EVENT, {
              fulfillmentEvent: {
                fulfillmentId: fulfillmentGid,
                status: eventStatus,
                happenedAt: new Date().toISOString(),
              },
            });
            summary.eventsPosted++;
          } catch (e) {
            summary.errors.push(`event ${order.name}: ${String(e)}`);
          }
        }

        const patch: Record<string, unknown> = {
          shopify_order_gid: order.id,
          shopify_fulfillment_gid: fulfillmentGid,
          last_status: status,
          tracking_code: trackingInfo.number,
          tracking_url: trackingInfo.url,
          carrier: trackingInfo.company,
          raw: gelato,
        };
        if (isShip && !link.fulfilled_at) patch.fulfilled_at = new Date().toISOString();
        if (eventStatus === "DELIVERED" && !link.delivered_at) patch.delivered_at = new Date().toISOString();

        await supabase.from("pod_orders").update(patch).eq("id", link.id);
      }

      if (!data.orders.pageInfo.hasNextPage) break;
      cursor = data.orders.pageInfo.endCursor;
    }

    return new Response(JSON.stringify(summary, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[gelato-backfill] error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
