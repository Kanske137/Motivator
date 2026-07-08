// Scheduled cleanup of the public `cart-previews` bucket. Customer add-to-cart
// snapshots accumulate (one per checkout attempt, mostly abandoned), so we delete
// customer previews older than MAX_AGE_DAYS. We KEEP the persistent artefacts:
//   - tmpl-preview-*  (a template's default preview, shown on every product page)
//   - style-thumb-*   (admin "Stil"-row thumbnails)
// Triggered daily by pg_cron; guarded by a shared secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const BUCKET = "cart-previews";
const KEEP_PREFIXES = ["tmpl-preview-", "style-thumb-"];
const MAX_AGE_DAYS = 30;
const PAGE = 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");

  const secret = Deno.env.get("CLEANUP_SECRET");
  if (secret && req.headers.get("x-cleanup-secret") !== secret) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !srk) throw new Error("service role saknas");
    const supabase = createClient(url, srk);

    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

    // Collect first (listing is stable), then delete — so pagination isn't
    // disturbed by removals mid-scan.
    const toRemove: string[] = [];
    let offset = 0;
    let scanned = 0;
    while (true) {
      const { data: files, error } = await supabase.storage.from(BUCKET).list("", {
        limit: PAGE,
        offset,
        sortBy: { column: "created_at", order: "asc" },
      });
      if (error) throw error;
      if (!files || files.length === 0) break;
      scanned += files.length;
      for (const f of files) {
        if (!f.name) continue;
        if (KEEP_PREFIXES.some((p) => f.name.startsWith(p))) continue;
        const created = f.created_at ? new Date(f.created_at).getTime() : 0;
        if (created && created < cutoff) toRemove.push(f.name);
      }
      if (files.length < PAGE) break;
      offset += PAGE;
      if (offset > 500000) break; // safety
    }

    let removed = 0;
    for (let i = 0; i < toRemove.length; i += PAGE) {
      const batch = toRemove.slice(i, i + PAGE);
      const { error } = await supabase.storage.from(BUCKET).remove(batch);
      if (!error) removed += batch.length;
      else console.warn("[cleanup-previews] remove batch failed:", error.message);
    }

    console.log(`[cleanup-previews] scanned=${scanned} removed=${removed}`);
    return new Response(JSON.stringify({ ok: true, scanned, removed }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[cleanup-previews] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
