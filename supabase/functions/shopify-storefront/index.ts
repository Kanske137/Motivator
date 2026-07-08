// Edge function: multi-tenant proxy to the Shopify Storefront API GraphQL.
// The caller passes `shop`; we resolve that installation, fetch (or lazily
// create + cache) a Storefront API access token for it via the Admin API, and
// proxy the query to that shop's storefront. This is how the editor shows each
// merchant's real, market-contextual variant prices.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { makeShopifyAdmin } from "../_shared/shopify-admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STOREFRONT_API_VERSION = "2025-07";

const CREATE_STOREFRONT_TOKEN = /* GraphQL */ `
  mutation {
    storefrontAccessTokenCreate(input: { title: "Wallery Customizer" }) {
      storefrontAccessToken { accessToken }
      userErrors { field message }
    }
  }
`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { query, variables, shop } = await req.json();
    if (!query) return json({ error: "query required" }, 400);
    if (!shop) return json({ error: "shop required" }, 400);

    const url = Deno.env.get("SUPABASE_URL");
    const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !srk) throw new Error("Supabase service role saknas");
    const supabase = createClient(url, srk);

    const { data: inst, error: instErr } = await supabase
      .from("shopify_app_installations")
      .select("access_token, storefront_access_token")
      .eq("shop_domain", shop)
      .maybeSingle();
    if (instErr) throw new Error(`installation lookup: ${instErr.message}`);
    if (!inst) return json({ error: `no installation for shop ${shop}` }, 404);

    // Fetch or lazily create + cache this shop's Storefront access token.
    let sfToken: string | null = inst.storefront_access_token;
    if (!sfToken) {
      const admin = makeShopifyAdmin(shop, inst.access_token);
      const res = await admin<{
        storefrontAccessTokenCreate: {
          storefrontAccessToken: { accessToken: string } | null;
          userErrors: { field: string[]; message: string }[];
        };
      }>(CREATE_STOREFRONT_TOKEN);
      sfToken = res?.storefrontAccessTokenCreate?.storefrontAccessToken?.accessToken ?? null;
      if (!sfToken) {
        const errs = res?.storefrontAccessTokenCreate?.userErrors ?? [];
        throw new Error(`could not create storefront token: ${JSON.stringify(errs)}`);
      }
      await supabase
        .from("shopify_app_installations")
        .update({ storefront_access_token: sfToken })
        .eq("shop_domain", shop);
    }

    const api = `https://${shop}/api/${STOREFRONT_API_VERSION}/graphql.json`;
    const r = await fetch(api, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": sfToken,
      },
      body: JSON.stringify({ query, variables: variables || {} }),
    });
    const text = await r.text();
    if (r.status !== 200) {
      console.warn(`[shopify-storefront] upstream ${r.status} shop=${shop} body=${text.slice(0, 200)}`);
    }
    return new Response(text, {
      status: r.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("shopify-storefront error:", msg);
    return json({ error: msg }, 500);
  }
});
