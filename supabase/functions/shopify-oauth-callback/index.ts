// Shopify OAuth callback. Verifies HMAC, exchanges `code` for an offline
// access token, and persists it in `shopify_app_installations` so the rest
// of the backend can use it for Admin API calls.
//
// On success we redirect the merchant back to the app with ?installed=1.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const APP_REDIRECT_FALLBACK = "https://motivator-8uw.pages.dev/admin/configs";

async function verifyHmac(params: URLSearchParams, secret: string): Promise<boolean> {
  const hmacFromShopify = params.get("hmac");
  if (!hmacFromShopify) return false;

  const filtered: [string, string][] = [];
  for (const [k, v] of params) {
    if (k === "hmac" || k === "signature") continue;
    filtered.push([k, v]);
  }
  filtered.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = filtered.map(([k, v]) => `${k}=${v}`).join("&");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");

  // constant-time compare
  if (hex.length !== hmacFromShopify.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ hmacFromShopify.charCodeAt(i);
  return diff === 0;
}

function htmlRedirect(url: string, message: string): Response {
  const safeMsg = message.replace(/[<>]/g, "");
  const body = `<!doctype html><meta charset="utf-8"><title>Shopify install</title>
<meta http-equiv="refresh" content="2;url=${url}">
<body style="font-family:system-ui;padding:2rem;text-align:center">
<h1>${safeMsg}</h1>
<p>Du skickas tillbaka till appen…</p>
<p><a href="${url}">Klicka här om inget händer</a></p>
</body>`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const params = url.searchParams;

  try {
    const clientId = Deno.env.get("SHOPIFY_APP_CLIENT_ID");
    const clientSecret = Deno.env.get("SHOPIFY_APP_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return new Response("Missing SHOPIFY_APP_CLIENT_ID/SECRET", { status: 500 });
    }

    const shop = params.get("shop") ?? "";
    const code = params.get("code") ?? "";
    if (!shop || !code) {
      return new Response("Missing shop or code", { status: 400 });
    }
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      return new Response("Invalid shop", { status: 400 });
    }

    const hmacOk = await verifyHmac(params, clientSecret);
    if (!hmacOk) {
      console.error("[oauth-callback] HMAC verification failed");
      return new Response("HMAC verification failed", { status: 401 });
    }

    // Exchange code -> offline access token.
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    const tokenJson = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokenJson?.access_token) {
      console.error("[oauth-callback] token exchange failed", tokenRes.status, tokenJson);
      return new Response(
        `Token exchange failed (${tokenRes.status}): ${JSON.stringify(tokenJson).slice(0, 300)}`,
        { status: 502 },
      );
    }

    const accessToken: string = tokenJson.access_token;
    const scopes: string = tokenJson.scope ?? "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await supabase
      .from("shopify_app_installations")
      .upsert(
        { shop_domain: shop, access_token: accessToken, scopes, installed_at: new Date().toISOString() },
        { onConflict: "shop_domain" },
      );
    if (error) {
      console.error("[oauth-callback] db upsert failed", error);
      return new Response(`DB error: ${error.message}`, { status: 500 });
    }

    console.log(`[oauth-callback] installed shop=${shop} scopes=${scopes}`);

    const back = `${APP_REDIRECT_FALLBACK}?installed=1&shop=${encodeURIComponent(shop)}`;
    return htmlRedirect(back, "Shopify-app installerad ✓");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[oauth-callback] error", msg);
    return new Response(`Internal error: ${msg}`, { status: 500 });
  }
});
