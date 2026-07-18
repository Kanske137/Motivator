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
import { getProductCatalog, searchGelatoProductUids, GELATO_SKU_MAP } from "../_shared/pod/gelato.ts";
import { POSTER_PRESET } from "../_shared/pod/presets.ts";
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

  let body: any = null;
  try { body = await req.clone().json(); } catch { /* no body */ }

  // Verification: does the composed Poster PRESET resolve to the SAME Gelato
  // UIDs as the frozen gelato-sku-map (flat + framed; hangers skipped)? Proves
  // the preset before sync is switched over. Body: { verifyPreset: "poster" }.
  if (body?.verifyPreset === "poster") {
    const map = (GELATO_SKU_MAP.posters ?? {}) as Record<string, { portrait: string; landscape: string }>;
    const FRAMES = new Set(["Ingen", "Svart", "Vit", "Ek", "Valnöt"]); // hangers TODO
    const mismatches: any[] = [];
    let checked = 0, matches = 0;
    for (const key of Object.keys(map)) {
      const [size, frame] = key.split("|");
      if (!FRAMES.has(frame)) continue;
      const expected = map[key].portrait;
      const res = POSTER_PRESET.resolve({ size, frame });
      if (!res) { mismatches.push({ key, reason: "preset returned null" }); checked++; continue; }
      const filters = { ...res.filters, Orientation: ["ver"] };
      checked++;
      try {
        const r = await searchGelatoProductUids({ apiKey, catalogUid: res.catalog, attributeFilters: filters, limit: 3 });
        const got = r.productUids[0] ?? null;
        if (got === expected) matches++;
        else mismatches.push({ key, catalog: res.catalog, expected, got, hits: r.productUids.length });
      } catch (e) {
        mismatches.push({ key, catalog: res.catalog, error: String(e) });
      }
    }
    return json(200, { ok: true, verify: "poster", checked, matches, mismatches });
  }

  // Diagnostic probe: resolve a productUid for a given catalog + attributeFilters
  // without importing anything. Body: { probe: { catalogUid, attributeFilters } }.
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
