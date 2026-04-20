// Edge function: explore Gelato Product Catalog API to fetch all UIDs
// for posters and canvas (with all sizes, frames, depths, orientations).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GELATO_BASE = "https://product.gelatoapis.com/v3";

async function gelato(path: string, init?: RequestInit) {
  const key = Deno.env.get("GELATO_API_KEY");
  if (!key) throw new Error("GELATO_API_KEY missing");
  const res = await fetch(`${GELATO_BASE}${path}`, {
    ...init,
    headers: {
      "X-API-KEY": key,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "catalogs";

    if (action === "catalogs") {
      const r = await gelato("/catalogs");
      return new Response(JSON.stringify(r), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "catalog") {
      const uid = url.searchParams.get("uid");
      if (!uid) throw new Error("uid required");
      const r = await gelato(`/catalogs/${uid}`);
      return new Response(JSON.stringify(r), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "search") {
      // POST search to list product UIDs in a catalog with attribute filters
      const uid = url.searchParams.get("uid");
      if (!uid) throw new Error("uid required");
      const body = await req.json().catch(() => ({}));
      const r = await gelato(`/catalogs/${uid}/products:search`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return new Response(JSON.stringify(r), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
