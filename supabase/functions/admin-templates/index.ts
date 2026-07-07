// Tenant-scoped admin CRUD for templates (product_configs).
//
// This replaces the admin browser's *direct* writes to product_configs, which
// Phase-2 RLS now denies. The embedded admin calls this with its Shopify App
// Bridge session token; requireInstallation() verifies it and hands back a
// service_role client + the caller's installation_id. EVERY query below is
// scoped by installation_id, so the function physically cannot touch another
// shop's rows.
//
// Body: { action: "list" | "create" | "save" | "delete", ... }
// Auth: header `X-Shopify-Session-Token: <App Bridge session token>`
//       (Authorization: Bearer <token> also accepted).

import {
  AuthError,
  authErrorResponse,
  requireInstallation,
} from "../_shared/require-installation.ts";

// Allow the dedicated session-token header through CORS preflight.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shopify-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface CreatePayload {
  title: string;
  handle: string;
  template_slug: string;
  enabled_product_types: string[];
  template: unknown;
  map_styles?: unknown;
  text_config?: unknown;
}

interface SavePayload {
  handle: string;
  template: unknown;
  template_slug?: string | null;
  map_styles?: unknown;
  meta?: {
    tags?: string[];
    category_gid?: string | null;
    status?: string;
    sales_channels?: string[];
    description_html?: string | null;
    seo_title?: string | null;
    seo_description?: string | null;
    is_freeform?: boolean;
  };
  /** For sibling propagation: is the addressed row a canvas product? */
  isCanvas?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // --- Auth guard: verify session token -> installation_id -----------------
  let ctx;
  try {
    ctx = await requireInstallation(req);
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
    throw e;
  }
  const { installationId, supabase } = ctx;

  const body = (await req.json().catch(() => ({}))) as { action?: string } & Record<string, unknown>;
  const action = body.action;

  try {
    switch (action) {
      // ---- list (admin: includes DRAFT/ARCHIVED, this shop only) ----------
      case "list": {
        const { data, error } = await supabase
          .from("product_configs")
          .select("*")
          .eq("installation_id", installationId)
          .order("created_at");
        if (error) throw error;
        return json({ ok: true, configs: data ?? [] });
      }

      // ---- get (single template by handle, this shop, incl. DRAFT) --------
      case "get": {
        const handle = String((body as { handle?: string }).handle ?? "").trim();
        if (!handle) return json({ ok: false, error: "handle krävs" }, 400);
        const { data, error } = await supabase
          .from("product_configs")
          .select("*")
          .eq("installation_id", installationId)
          .eq("shopify_handle", handle)
          .maybeSingle();
        if (error) throw error;
        return json({ ok: true, config: data ?? null });
      }

      // ---- create ---------------------------------------------------------
      case "create": {
        const p = body as unknown as CreatePayload;
        if (!p.title?.trim() || !p.handle?.trim()) {
          return json({ ok: false, error: "title och handle krävs" }, 400);
        }
        const { data, error } = await supabase
          .from("product_configs")
          .insert({
            installation_id: installationId,
            title: p.title.trim(),
            shopify_handle: p.handle.trim(),
            template_slug: p.template_slug ?? p.handle.trim(),
            product_type: "multi",
            is_consolidated: true,
            enabled_product_types: p.enabled_product_types ?? [],
            template: p.template ?? {},
            layouts: {},
            map_styles: p.map_styles ?? [],
            text_config: p.text_config ?? {},
            sizes: [],
            gelato_sku_map: {},
          })
          .select("id, shopify_handle")
          .maybeSingle();
        if (error) {
          // UNIQUE(installation_id, shopify_handle) violation.
          if (error.code === "23505") {
            return json({ ok: false, error: "En mall med den handle finns redan" }, 409);
          }
          throw error;
        }
        return json({ ok: true, config: data });
      }

      // ---- save (template + Shopify-meta, + sibling propagation) -----------
      case "save": {
        const p = body as unknown as SavePayload;
        if (!p.handle?.trim()) return json({ ok: false, error: "handle krävs" }, 400);

        const meta = p.meta ?? {};
        const { error } = await supabase
          .from("product_configs")
          .update({
            template: p.template ?? {},
            tags: meta.tags ?? [],
            category_gid: meta.category_gid ?? null,
            status: meta.status ?? "DRAFT",
            sales_channels: meta.sales_channels ?? ["online_store"],
            description_html: meta.description_html ?? null,
            seo_title: meta.seo_title ?? null,
            seo_description: meta.seo_description ?? null,
            is_freeform: meta.is_freeform ?? false,
            map_styles: p.map_styles ?? [],
          })
          .eq("installation_id", installationId)
          .eq("shopify_handle", p.handle.trim());
        if (error) throw error;

        // Propagate the shared template to sibling rows (same template_slug,
        // same installation), preserving each sibling's per-type blocks. Mirror
        // of the logic that used to run in the browser (DesignerPage).
        const slug = p.template_slug;
        if (slug) {
          const { data: siblings, error: sibErr } = await supabase
            .from("product_configs")
            .select("shopify_handle, template")
            .eq("installation_id", installationId)
            .eq("template_slug", slug)
            .neq("shopify_handle", p.handle.trim());
          if (sibErr) throw sibErr;

          const tpl = (p.template ?? {}) as Record<string, unknown>;
          for (const s of siblings ?? []) {
            const sib = (s.template ?? {}) as Record<string, unknown>;
            const sibOpts = (sib.productOptions ?? {}) as Record<string, unknown>;
            const tplOpts = (tpl.productOptions ?? {}) as Record<string, unknown>;
            const merged = {
              ...tpl,
              defaultLayout: p.isCanvas ? (sib.defaultLayout ?? tpl.defaultLayout) : tpl.defaultLayout,
              canvasLayout: p.isCanvas ? tpl.canvasLayout : (sib.canvasLayout ?? tpl.canvasLayout),
              productOptions: {
                ...tplOpts,
                poster: sibOpts.poster ?? tplOpts.poster,
                canvas: sibOpts.canvas ?? tplOpts.canvas,
              },
            };
            const { error: upErr } = await supabase
              .from("product_configs")
              .update({ template: merged, map_styles: p.map_styles ?? [] })
              .eq("installation_id", installationId)
              .eq("shopify_handle", s.shopify_handle);
            if (upErr) throw upErr;
          }
        }
        return json({ ok: true });
      }

      // ---- delete (DB row only; Shopify products via shopify-delete-template) --
      case "delete": {
        const handle = String((body as { handle?: string }).handle ?? "").trim();
        if (!handle) return json({ ok: false, error: "handle krävs" }, 400);
        const { error } = await supabase
          .from("product_configs")
          .delete()
          .eq("installation_id", installationId)
          .eq("shopify_handle", handle);
        if (error) throw error;
        return json({ ok: true });
      }

      default:
        return json({ ok: false, error: `Okänd action: ${action}` }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[admin-templates] action=${action} failed:`, msg);
    return json({ ok: false, error: msg }, 500);
  }
});
