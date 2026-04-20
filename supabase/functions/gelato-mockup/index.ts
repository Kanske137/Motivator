// Edge function: skapa mockup via Gelato Mockup Generator API
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const HOSTS = [
  "https://order.gelatoapis.com/v1",
  "https://api.gelatoapis.com/v1",
  "https://mockup.gelatoapis.com/v1",
];

async function tryFetch(url: string, init: RequestInit) {
  console.log("[gelato-mockup] fetch:", init.method || "GET", url);
  const res = await fetch(url, init);
  console.log("[gelato-mockup] status:", res.status, url);
  return res;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const GELATO_API_KEY = Deno.env.get("GELATO_API_KEY");
    if (!GELATO_API_KEY) throw new Error("GELATO_API_KEY not configured");

    const { productUid, imageUrl } = await req.json();
    console.log("[gelato-mockup] request:", { productUid, imageUrl });
    if (!productUid || !imageUrl) {
      return new Response(JSON.stringify({ error: "productUid and imageUrl required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const headers = {
      "X-API-KEY": GELATO_API_KEY,
      "Content-Type": "application/json",
    };
    const body = JSON.stringify({
      productUid,
      files: [{ type: "default", url: imageUrl }],
    });

    // Try hosts in order until one resolves DNS / responds
    let create: Response | null = null;
    let usedBase: string | null = null;
    let lastErr: unknown = null;
    for (const base of HOSTS) {
      try {
        create = await tryFetch(`${base}/mockups`, { method: "POST", headers, body });
        usedBase = base;
        break;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[gelato-mockup] host failed:", base, msg);
      }
    }

    if (!create || !usedBase) {
      const msg = lastErr instanceof Error ? lastErr.message : "all hosts failed";
      console.error("[gelato-mockup] all hosts failed:", msg);
      return new Response(
        JSON.stringify({ mockupUrl: null, fallback: true, error: msg }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const task = await create.json();
    console.log("[gelato-mockup] create body:", JSON.stringify(task).slice(0, 500));

    if (!create.ok) {
      console.error("[gelato-mockup] create failed", task);
      return new Response(
        JSON.stringify({ mockupUrl: null, fallback: true, error: task?.message || "mockup_unavailable", host: usedBase }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Poll until done (use same host that succeeded)
    const taskId = task.taskId || task.id;
    console.log("[gelato-mockup] polling taskId:", taskId, "on", usedBase);
    const deadline = Date.now() + 30_000;
    let result = task;
    while (taskId && result.status !== "completed" && result.status !== "failed" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const poll = await tryFetch(`${usedBase}/mockups/${taskId}`, { headers });
        result = await poll.json();
        console.log("[gelato-mockup] poll status:", result.status);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[gelato-mockup] poll error:", msg);
        break;
      }
    }

    const mockupUrl =
      result.mockups?.[0]?.url ||
      result.mockup?.url ||
      result.previewUrl ||
      result.url ||
      null;

    return new Response(JSON.stringify({ mockupUrl, host: usedBase, raw: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("gelato-mockup error:", msg);
    return new Response(JSON.stringify({ mockupUrl: null, fallback: true, error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
