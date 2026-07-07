// Tenant-scoped admin settings — currently the per-merchant global price rules
// (the future home for POD selection and other "overall settings" too).
//
// Auth: header X-Shopify-Session-Token. Body: { action, ... }.
// Actions:
//   prices-list                              -> { ok, prices: [...] }
//   prices-upsert { prices: [PriceRow] }     -> { ok, count }
//   prices-delete { provider?, material, size, variant } -> { ok }
//
// PriceRow = { provider?, material, size, variant, price }.
// Keyed generically (provider/material/size/variant are free text) so new POD
// providers / materials / variants just become new rows.

import {
  AuthError,
  authErrorResponse,
  requireInstallation,
} from "../_shared/require-installation.ts";

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

interface PriceRow {
  provider?: string;
  material: string;
  size: string;
  variant: string;
  price: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
      case "prices-list": {
        const { data, error } = await supabase
          .from("pricing_rules")
          .select("provider, material, size, variant, price")
          .eq("installation_id", installationId)
          .order("material")
          .order("size")
          .order("variant");
        if (error) throw error;
        return json({ ok: true, prices: data ?? [] });
      }

      case "prices-upsert": {
        const rows = (body.prices ?? []) as PriceRow[];
        if (!Array.isArray(rows) || rows.length === 0) {
          return json({ ok: false, error: "prices krävs" }, 400);
        }
        const now = new Date().toISOString();
        const toUpsert = rows
          .filter((r) => r && r.material && r.size && r.variant && typeof r.price === "number")
          .map((r) => ({
            installation_id: installationId,
            provider: r.provider ?? "gelato",
            material: String(r.material),
            size: String(r.size),
            variant: String(r.variant),
            price: r.price,
            updated_at: now,
          }));
        if (toUpsert.length === 0) return json({ ok: false, error: "inga giltiga rader" }, 400);
        const { error } = await supabase
          .from("pricing_rules")
          .upsert(toUpsert, { onConflict: "installation_id,provider,material,size,variant" });
        if (error) throw error;
        return json({ ok: true, count: toUpsert.length });
      }

      case "prices-delete": {
        const p = body as { provider?: string; material?: string; size?: string; variant?: string };
        if (!p.material || !p.size || !p.variant) {
          return json({ ok: false, error: "material, size, variant krävs" }, 400);
        }
        const { error } = await supabase
          .from("pricing_rules")
          .delete()
          .eq("installation_id", installationId)
          .eq("provider", p.provider ?? "gelato")
          .eq("material", p.material)
          .eq("size", p.size)
          .eq("variant", p.variant);
        if (error) throw error;
        return json({ ok: true });
      }

      default:
        return json({ ok: false, error: `Okänd action: ${action}` }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[admin-settings] action=${action} failed:`, msg);
    return json({ ok: false, error: msg }, 500);
  }
});
