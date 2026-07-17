// Imports the POD provider's public catalog into `product_bases` (Phase 3b).
//
// POST → fetches every Gelato catalog + its productAttributes via the shared
// adapter's getProductCatalog(), and upserts one row per catalog with generic
// `variant_axes`. Re-running refreshes the cache (catalog drift, plan §4).
//
// Auth (either works):
//   1. A Shopify admin session token (the admin UI's "refresh catalog" path) —
//      any installed shop may trigger a refresh; the data written is global,
//      non-tenant catalog cache.
//   2. `x-import-secret` matching POD_IMPORT_SECRET — the scheduled/ops path,
//      mirroring cleanup-previews' cron guard.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { getProductCatalog, searchGelatoProductUids } from "../_shared/pod/gelato.ts";
import {
  AuthError,
  authErrorResponse,
  requireInstallation,
} from "../_shared/require-installation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shopify-session-token, x-import-secret",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  // --- Auth: shared secret (ops/cron) OR an installed shop's session token ---
  const secret = Deno.env.get("POD_IMPORT_SECRET");
  const secretOk = Boolean(secret && req.headers.get("x-import-secret") === secret);
  if (!secretOk) {
    try {
      await requireInstallation(req);
    } catch (e) {
      if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
      throw e;
    }
  }

  const apiKey = Deno.env.get("GELATO_API_KEY");
  if (!apiKey) return json(500, { ok: false, error: "GELATO_API_KEY missing" });

  // Diagnostic probe: resolve a productUid for a given catalog + attributeFilters
  // without importing anything. Used to verify base-driven SKU resolution before
  // sync relies on it. Body: { probe: { catalogUid, attributeFilters } }.
  let body: any = null;
  try { body = await req.clone().json(); } catch { /* no body */ }
  if (body?.probe?.catalogUid) {
    try {
      const r = await searchGelatoProductUids({
        apiKey,
        catalogUid: String(body.probe.catalogUid),
        attributeFilters: body.probe.attributeFilters ?? {},
        limit: Number(body.probe.limit ?? 5),
      });
      return json(200, { ok: true, probe: body.probe, result: r });
    } catch (e) {
      return json(502, { ok: false, error: String(e) });
    }
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { bases, failed } = await getProductCatalog(apiKey);
    if (bases.length === 0) {
      return json(502, { ok: false, error: "provider returned no catalogs", failed });
    }
    for (const f of failed) {
      console.warn(`[pod-catalog-import] gelato catalog "${f.id}" skipped: ${f.error}`);
    }

    const now = new Date().toISOString();
    const rows = bases.map((b) => ({
      provider: "gelato",
      provider_product_id: b.providerProductId,
      title: b.title,
      variant_axes: b.variantAxes,
      raw: b.raw,
      imported_at: now,
    }));

    const { error } = await supabase
      .from("product_bases")
      .upsert(rows, { onConflict: "provider,provider_product_id" });
    if (error) return json(500, { ok: false, error: error.message });

    console.log(
      `[pod-catalog-import] gelato: upserted ${rows.length} bases: ${
        rows.map((r) => r.provider_product_id).join(", ")
      }`,
    );
    return json(200, {
      ok: true,
      provider: "gelato",
      imported: rows.length,
      skipped: failed,
      catalogs: rows.map((r) => ({
        id: r.provider_product_id,
        title: r.title,
        axes: (r.variant_axes as unknown[]).length,
      })),
    });
  } catch (e) {
    console.error("[pod-catalog-import] failed:", e);
    return json(502, { ok: false, error: String(e) });
  }
});
