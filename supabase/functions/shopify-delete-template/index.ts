// Deletes a template (product_config) and its corresponding Shopify products,
// scoped to the calling shop's installation. Resolves Shopify products by handle
// — both base handle and -poster/-canvas/-aluminum/-acrylic suffixed variants.
import {
  AuthError,
  authErrorResponse,
  requireInstallation,
} from "../_shared/require-installation.ts";
import { makeShopifyAdmin } from "../_shared/shopify-admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shopify-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  // Verify the Shopify session token -> this shop's installation + Admin token.
  let ctx;
  try {
    ctx = await requireInstallation(req);
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { installationId, shop, accessToken, supabase } = ctx;
  const admin = makeShopifyAdmin(shop, accessToken);

  try {
    const body = (await req.json().catch(() => ({}))) as DeleteRequest;
    if (body.confirm !== "RADERA") {
      return new Response(
        JSON.stringify({ ok: false, error: "Bekräftelse saknas (confirm=RADERA krävs)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Look up the template — scoped to this shop's installation.
    const query = supabase
      .from("product_configs")
      .select("id,shopify_handle,title")
      .eq("installation_id", installationId);
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

    const shopifyDeleted: string[] = [];
    const shopifyErrors: string[] = [];

    for (const handle of candidates) {
      try {
        const data = await admin<{ productByHandle: { id: string; handle: string } | null }>(
          PRODUCT_BY_HANDLE_QUERY,
          { handle },
        );
        const productId = data.productByHandle?.id;
        if (!productId) continue;
        const del = await admin<{
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

    // Delete sync state then config (scoped to the installation).
    const { error: stateErr } = await supabase
      .from("shopify_sync_state")
      .delete()
      .eq("installation_id", installationId)
      .eq("product_config_id", cfg.id);
    if (stateErr) {
      console.warn("[shopify-delete-template] sync_state delete failed", stateErr);
    }

    const { error: cfgDelErr } = await supabase
      .from("product_configs")
      .delete()
      .eq("installation_id", installationId)
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
