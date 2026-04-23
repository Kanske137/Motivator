// Gelato Mockup Generator integration.
// Input: { productUid, printFileUrl, designId? }
// Output: { ok: true, urls: [{ id, label, url }] } or { ok: false, error }
//
// Caching: SHA-1 of (productUid + "|" + printFileUrl) → mockup-cache bucket as JSON.
// Same design + product = instant cache hit.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface MockupOut {
  id: string;
  label: string;
  url: string;
}

async function sha1(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function callGelatoMockups(
  productUid: string,
  printFileUrl: string,
): Promise<MockupOut[]> {
  const key = Deno.env.get("GELATO_API_KEY");
  if (!key) throw new Error("GELATO_API_KEY missing");

  // Gelato Mockup endpoint. Per docs: POST /v1/mockups
  // Body: { productUid, files: [{ type: "default", url }] }
  // Returns: { mockups: [{ url, mockupName, ... }] }
  const res = await fetch("https://product.gelatoapis.com/v1/mockups", {
    method: "POST",
    headers: {
      "X-API-KEY": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      productUid,
      files: [{ type: "default", url: printFileUrl }],
    }),
  });

  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep as text
  }

  if (!res.ok) {
    throw new Error(
      `Gelato mockups ${res.status}: ${
        typeof body === "string" ? body.slice(0, 400) : JSON.stringify(body).slice(0, 400)
      }`,
    );
  }

  const list = (body?.mockups ?? body?.data ?? body?.results ?? []) as any[];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`Gelato returned no mockups: ${JSON.stringify(body).slice(0, 300)}`);
  }

  return list
    .map((m, i) => {
      const url: string | undefined =
        m?.url ?? m?.mockupUrl ?? m?.imageUrl ?? m?.previewUrl;
      if (!url) return null;
      const label: string =
        m?.mockupName ?? m?.name ?? m?.title ?? `Mockup ${i + 1}`;
      const id: string = m?.id ?? m?.mockupId ?? `mockup-${i}`;
      return { id: String(id), label: String(label), url } as MockupOut;
    })
    .filter((x): x is MockupOut => !!x);
}

async function fetchSceneIds(productUid: string): Promise<any> {
  const key = Deno.env.get("GELATO_API_KEY");
  if (!key) throw new Error("GELATO_API_KEY missing");
  // Try Gelato's product mockups discovery endpoints in order of likelihood.
  const candidates = [
    `https://product.gelatoapis.com/v3/mockups/scenes?productUid=${encodeURIComponent(productUid)}`,
    `https://product.gelatoapis.com/v1/mockups/scenes?productUid=${encodeURIComponent(productUid)}`,
    `https://mockup.gelatoapis.com/v1/scenes?productUid=${encodeURIComponent(productUid)}`,
    `https://ecommerce.gelatoapis.com/v1/mockup-scenes?productUid=${encodeURIComponent(productUid)}`,
    `https://product.gelatoapis.com/v3/products/${productUid}/mockup-scenes`,
  ];
  const results: any[] = [];
  for (const url of candidates) {
    try {
      const r = await fetch(url, { headers: { "X-API-KEY": key } });
      const t = await r.text();
      results.push({ url, status: r.status, body: t.slice(0, 1500) });
    } catch (e) {
      results.push({ url, error: String(e) });
    }
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const u = new URL(req.url);
    const body = await req.json().catch(() => ({}));

    if (u.searchParams.get("debug") === "scenes" || body?.debug === "scenes") {
      const productUid = (u.searchParams.get("productUid") ?? body?.productUid ?? "") as string;
      const data = await fetchSceneIds(productUid);
      return new Response(JSON.stringify(data, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const productUid: unknown = body?.productUid;
    const printFileUrl: unknown = body?.printFileUrl;

    if (typeof productUid !== "string" || !productUid) {
      return new Response(
        JSON.stringify({ ok: false, error: "productUid (string) required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (
      typeof printFileUrl !== "string" ||
      !/^https?:\/\//i.test(printFileUrl)
    ) {
      return new Response(
        JSON.stringify({ ok: false, error: "printFileUrl (https URL) required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cacheKey = await sha1(`${productUid}|${printFileUrl}`);
    const cachePath = `${cacheKey}.json`;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Cache check
    const { data: cached } = await supabase.storage
      .from("mockup-cache")
      .download(cachePath);
    if (cached) {
      try {
        const json = JSON.parse(await cached.text());
        if (Array.isArray(json) && json.length > 0) {
          return new Response(
            JSON.stringify({ ok: true, urls: json, cached: true }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      } catch {
        // bad cache → ignore, regenerate
      }
    }

    // 2. Call Gelato
    const mockups = await callGelatoMockups(productUid, printFileUrl);

    // 3. Cache (best-effort, don't fail request if cache write fails)
    try {
      await supabase.storage
        .from("mockup-cache")
        .upload(cachePath, new Blob([JSON.stringify(mockups)], { type: "application/json" }), {
          contentType: "application/json",
          upsert: true,
        });
    } catch (e) {
      console.warn("[gelato-mockups] cache write failed:", e);
    }

    return new Response(
      JSON.stringify({ ok: true, urls: mockups, cached: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[gelato-mockups] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
