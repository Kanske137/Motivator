// Discovery: hämta tillgängliga mockup-scener för en Gelato-produkt
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const HOSTS = [
  "https://product.gelatoapis.com/v3",
  "https://product.gelatoapis.com/v2",
  "https://product.gelatoapis.com/v1",
  "https://api.gelatoapis.com/v1",
  "https://order.gelatoapis.com/v1",
];

const ENDPOINTS = (uid: string) => [
  `/products/${encodeURIComponent(uid)}`,
  `/products/${encodeURIComponent(uid)}/mockups`,
  `/products/${encodeURIComponent(uid)}/mockup-scenes`,
  `/mockup-scenes?productUid=${encodeURIComponent(uid)}`,
  `/mockups?productUid=${encodeURIComponent(uid)}`,
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const GELATO_API_KEY = Deno.env.get("GELATO_API_KEY");
    if (!GELATO_API_KEY) throw new Error("GELATO_API_KEY not configured");

    const { productUid } = await req.json();
    if (!productUid) {
      return new Response(JSON.stringify({ error: "productUid required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const headers = { "X-API-KEY": GELATO_API_KEY, "Content-Type": "application/json" };
    const attempts: Array<{ url: string; status: number; bodyPreview: string }> = [];

    for (const base of HOSTS) {
      for (const path of ENDPOINTS(productUid)) {
        const url = `${base}${path}`;
        try {
          const r = await fetch(url, { headers });
          const txt = await r.text();
          attempts.push({ url, status: r.status, bodyPreview: txt.slice(0, 1500) });
          console.log("[list-scenes]", r.status, url);
          if (r.ok) {
            // Try to extract scenes / UUIDs
            let parsed: unknown = null;
            try { parsed = JSON.parse(txt); } catch { /* not json */ }
            return new Response(
              JSON.stringify({ ok: true, url, status: r.status, data: parsed ?? txt, attempts }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          attempts.push({ url, status: 0, bodyPreview: msg });
          console.warn("[list-scenes] fetch failed", url, msg);
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: false, error: "no endpoint returned scenes", attempts }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
