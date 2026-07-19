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
import { getPreset, resolvePreset } from "../_shared/pod/presets.ts";
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
  if (body?.verifyPreset) {
    // Iterate ANY preset's size × catalog-axis and report how many resolve to a
    // live Gelato UID. `values` limits the catalog-axis values tested (default
    // the first) to stay under the edge CPU budget.
    const preset = getPreset(String(body.verifyPreset));
    if (!preset) return json(400, { ok: false, error: "unknown preset" });
    const sizeAxis = preset.axes.find((a) => a.key === "size")!;
    const catAxis = preset.axes.find((a) => a.key === preset.catalogAxis)!;
    const want: string[] = body.values ?? [catAxis.values[0]?.key];
    const catVals = catAxis.values.filter((c) => want.includes(c.key));
    // Fill every OTHER (non-size, non-catalog) axis with its first value so the
    // combo is fully pinned (e.g. poster paper).
    const fixed: Record<string, string> = {};
    for (const ax of preset.axes) {
      if (ax.key !== "size" && ax.key !== preset.catalogAxis) fixed[ax.key] = ax.values[0]?.key;
    }
    const noProduct: string[] = []; const errors: any[] = [];
    let checked = 0, resolved = 0;
    for (const s of sizeAxis.values) {
      for (const c of catVals) {
        const res = resolvePreset(preset, { ...fixed, size: s.key, [preset.catalogAxis]: c.key });
        if (!res) { noProduct.push(`${s.key}|${c.key}`); continue; }
        checked++;
        try {
          const r = await searchGelatoProductUids({
            apiKey, catalogUid: res.catalog,
            attributeFilters: { ...res.filters, Orientation: ["ver"] }, limit: 2,
          });
          if (r.productUids[0]) resolved++;
          else noProduct.push(`${s.key}|${c.key}`);
        } catch (e) { errors.push({ key: `${s.key}|${c.key}`, error: String(e) }); }
      }
    }
    return json(200, {
      ok: true, verify: preset.id,
      sizes: sizeAxis.values.length, catalogValues: catAxis.values.map((c) => c.key),
      checked, resolved, noProductCount: noProduct.length, errors,
      noProductSample: noProduct.slice(0, 20),
    });
  }

  // Shop-info probe: read the stored admin token server-side and report the
  // shop's currency (diagnosing why sync priced in the wrong currency). Body:
  // { shopInfo: "<shop_domain>" }. Token never leaves the backend.
  if (body?.shopInfo) {
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: inst } = await supabase
        .from("shopify_app_installations")
        .select("access_token")
        .eq("shop_domain", String(body.shopInfo))
        .maybeSingle();
      if (!inst?.access_token) return json(404, { ok: false, error: "installation not found" });
      const res = await fetch(
        `https://${body.shopInfo}/admin/api/2025-01/graphql.json`,
        {
          method: "POST",
          headers: { "X-Shopify-Access-Token": inst.access_token, "Content-Type": "application/json" },
          body: JSON.stringify({ query: "{ shop { currencyCode name currencyFormats { moneyFormat } } }" }),
        },
      );
      const text = await res.text();
      let parsed: any = text; try { parsed = JSON.parse(text); } catch { /* raw */ }
      return json(res.ok ? 200 : 502, { ok: res.ok, status: res.status, shop: parsed?.data?.shop ?? parsed, errors: parsed?.errors });
    } catch (e) {
      return json(502, { ok: false, error: String(e) });
    }
  }

  // Cost probe: fetch Gelato's wholesale prices for a productUid (the foundation
  // of the cost/margin pricing UI). Body: { costProbe: "<productUid>" }.
  if (body?.costProbe) {
    try {
      const q = new URLSearchParams();
      if (body.currency) q.set("currency", String(body.currency));
      if (body.country) q.set("country", String(body.country));
      const qs = q.toString() ? `?${q.toString()}` : "";
      const res = await fetch(
        `https://product.gelatoapis.com/v3/products/${encodeURIComponent(String(body.costProbe))}/prices${qs}`,
        { headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" } },
      );
      const text = await res.text();
      let parsed: unknown = text; try { parsed = JSON.parse(text); } catch { /* raw */ }
      return json(res.ok ? 200 : 502, { ok: res.ok, status: res.status, prices: parsed });
    } catch (e) {
      return json(502, { ok: false, error: String(e) });
    }
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
