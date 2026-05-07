// Deletes a template (product_config) and its corresponding Shopify products.
// Resolves Shopify products by handle — both base handle and -poster/-canvas/-aluminum/-acrylic
// suffixed variants the sync function may have created.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { ensureShopifyAuth, shopifyAdmin } from "../_shared/shopify-admin.ts";

const PRODUCT_BY_HANDLE_QUERY = /* GraphQL */ `
  query ProductByHandle($handle: String!) {
    productByHandle(handle: $handle) { id title handle }
  }
`;

const PRODUCT_DELETE_MUTATION = /* GraphQL */ `
  mutation productDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors { field message }
    }
  }
`;

interface DeleteRequest {
  handle?: string;
  product_config_id?: string;
  confirm?: string;
}

const SUFFIXES = ["", "-poster", "-canvas", "-aluminum", "-acrylic"];

function baseHandle(h: string): string {
  return h.replace(/-(poster|posters|canvas|aluminum|acrylic)$/i, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as DeleteRequest;
    if (body.confirm !== "RADERA") {
      return new Response(
        JSON.stringify({ ok: false, error: "Bekräftelse saknas (confirm=RADERA krävs)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = Deno.env.get("SUPABASE_URL");
    const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !srk) throw new Error("Supabase service role saknas");
    const supabase = createClient(url, srk);

    // Look up the template.
    const query = supabase.from("product_configs").select("id,shopify_handle,title");
    const { data: cfg, error: cfgErr } = body.product_config_id
      ? await query.eq("id", body.product_config_id).maybeSingle()
      : await query.eq("shopify_handle", body.handle ?? "").maybeSingle();

    if (cfgErr) throw new Error(`Kunde inte läsa product_configs: ${cfgErr.message}`);
    if (!cfg) {
      return new Response(
        JSON.stringify({ ok: false, error: "Mallen hittades inte" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve all candidate Shopify handles for this template.
    const root = baseHandle(cfg.shopify_handle);
    const candidates = Array.from(
      new Set([cfg.shopify_handle, ...SUFFIXES.map((s) => `${root}${s}`)]),
    ).filter(Boolean);

    let shopifyDeleted: string[] = [];
    let shopifyErrors: string[] = [];

    try {
      await ensureShopifyAuth();
      for (const handle of candidates) {
        try {
          const data = await shopifyAdmin<{ productByHandle: { id: string; handle: string } | null }>(
            PRODUCT_BY_HANDLE_QUERY,
            { handle },
          );
          const productId = data.productByHandle?.id;
          if (!productId) continue;
          const del = await shopifyAdmin<{
            productDelete: { deletedProductId: string | null; userErrors: { message: string }[] };
          }>(PRODUCT_DELETE_MUTATION, { input: { id: productId } });
          if (del.productDelete.userErrors?.length) {
            shopifyErrors.push(
              `${handle}: ${del.productDelete.userErrors.map((e) => e.message).join("; ")}`,
            );
          } else if (del.productDelete.deletedProductId) {
            shopifyDeleted.push(handle);
          }
        } catch (e) {
          shopifyErrors.push(`${handle}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (authErr) {
      shopifyErrors.push(
        `Shopify auth misslyckades: ${authErr instanceof Error ? authErr.message : String(authErr)}`,
      );
    }

    // Delete sync state then config (separate so FK-ish ordering is safe even
    // without a real FK).
    const { error: stateErr } = await supabase
      .from("shopify_sync_state")
      .delete()
      .eq("product_config_id", cfg.id);
    if (stateErr) {
      console.warn("[shopify-delete-template] sync_state delete failed", stateErr);
    }

    const { error: cfgDelErr } = await supabase
      .from("product_configs")
      .delete()
      .eq("id", cfg.id);
    if (cfgDelErr) throw new Error(`Kunde inte radera mallen: ${cfgDelErr.message}`);

    return new Response(
      JSON.stringify({
        ok: true,
        configDeleted: true,
        shopifyDeleted,
        shopifyErrors,
        title: cfg.title,
        handle: cfg.shopify_handle,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Okänt fel";
    console.error("[shopify-delete-template] error", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
