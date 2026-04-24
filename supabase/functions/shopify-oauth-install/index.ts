// Generates the Shopify install URL for the Dev Dashboard app.
// Frontend calls this to get a URL to redirect the merchant to so they can
// authorize the app on their store. We embed a CSRF nonce in `state`.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const CALLBACK_PATH = "/functions/v1/shopify-oauth-callback";

function getCallbackUrl(): string {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("SUPABASE_URL missing");
  return `${url.replace(/\/$/, "")}${CALLBACK_PATH}`;
}

function normalizeShop(input: string): string {
  let s = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!s.endsWith(".myshopify.com")) {
    // allow bare store name
    if (!s.includes(".")) s = `${s}.myshopify.com`;
  }
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) {
    throw new Error(`Invalid shop domain: ${input}`);
  }
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const clientId = Deno.env.get("SHOPIFY_APP_CLIENT_ID");
    const scopesRaw = Deno.env.get("SHOPIFY_APP_SCOPES");
    if (!clientId || !scopesRaw) {
      return new Response(
        JSON.stringify({ error: "SHOPIFY_APP_CLIENT_ID eller SHOPIFY_APP_SCOPES saknas i backend-secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const scopes = scopesRaw.split(",").map((s) => s.trim()).filter(Boolean).join(",");

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const url = new URL(req.url);
    const shopRaw = body.shop ?? url.searchParams.get("shop")
      ?? Deno.env.get("SHOPIFY_STORE_PERMANENT_DOMAIN")
      ?? "canvas-poster-creator-2wh5d.myshopify.com";

    const shop = normalizeShop(shopRaw);
    const redirectUri = getCallbackUrl();
    const state = crypto.randomUUID();

    const installUrl = `https://${shop}/admin/oauth/authorize`
      + `?client_id=${encodeURIComponent(clientId)}`
      + `&scope=${encodeURIComponent(scopes)}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}`
      + `&state=${encodeURIComponent(state)}`
      + `&grant_options[]=`; // offline access token

    console.log(`[oauth-install] shop=${shop} redirect=${redirectUri}`);

    return new Response(
      JSON.stringify({ installUrl, redirectUri, shop, state }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[oauth-install] error", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
