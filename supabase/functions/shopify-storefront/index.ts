// Edge function: proxy till Shopify Storefront API GraphQL.
// Håller storefront-token + domän server-side.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const SHOPIFY_API_VERSION = "2025-07";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const TOKEN = Deno.env.get("SHOPIFY_STOREFRONT_ACCESS_TOKEN");
    const DOMAIN = Deno.env.get("SHOPIFY_STORE_PERMANENT_DOMAIN");
    if (!TOKEN) throw new Error("SHOPIFY_STOREFRONT_ACCESS_TOKEN not configured");
    if (!DOMAIN) throw new Error("SHOPIFY_STORE_PERMANENT_DOMAIN not configured");

    const { query, variables } = await req.json();
    if (!query) {
      return new Response(JSON.stringify({ error: "query required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const r = await fetch(`https://${DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": TOKEN,
      },
      body: JSON.stringify({ query, variables: variables || {} }),
    });

    const data = await r.json();
    return new Response(JSON.stringify(data), {
      status: r.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("shopify-storefront error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
