// Returns whether the Shopify app is installed for the configured shop.
// Used by the admin UI to show "Installed ✓" vs "Install app".
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

function getShop(): string {
  const d = Deno.env.get("SHOPIFY_STORE_PERMANENT_DOMAIN")
    ?? Deno.env.get("SHOPIFY_STORE_DOMAIN")
    ?? "wdxugd-yq.myshopify.com";
  return d.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const shop = getShop();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await supabase
      .from("shopify_app_installations")
      .select("shop_domain, scopes, installed_at, updated_at")
      .eq("shop_domain", shop)
      .maybeSingle();

    if (error) throw error;

    return new Response(
      JSON.stringify({
        shop,
        installed: !!data,
        scopes: data?.scopes ?? null,
        installedAt: data?.installed_at ?? null,
        updatedAt: data?.updated_at ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
