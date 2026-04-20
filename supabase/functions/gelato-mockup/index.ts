// Edge function: skapa mockup via Gelato Mockup Generator API
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const GELATO_API_KEY = Deno.env.get("GELATO_API_KEY");
    if (!GELATO_API_KEY) throw new Error("GELATO_API_KEY not configured");

    const { productUid, imageUrl } = await req.json();
    if (!productUid || !imageUrl) {
      return new Response(JSON.stringify({ error: "productUid and imageUrl required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gelato Mockup API lever på egen subdomän
    const MOCKUP_BASE = "https://mockup.gelatoapis.com/v1";

    const create = await fetch(`${MOCKUP_BASE}/mockups`, {
      method: "POST",
      headers: {
        "X-API-KEY": GELATO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        productUid,
        files: [{ type: "default", url: imageUrl }],
      }),
    });

    const task = await create.json();
    if (!create.ok) {
      console.error("Gelato mockup create failed", task);
      // Fallback: returnera null så klienten visar tryckfilen istället
      return new Response(
        JSON.stringify({ mockupUrl: null, fallback: true, error: task?.message || "mockup_unavailable" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Polla tills klar
    const taskId = task.taskId || task.id;
    const deadline = Date.now() + 30_000;
    let result = task;
    while (taskId && result.status !== "completed" && result.status !== "failed" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const poll = await fetch(`${MOCKUP_BASE}/mockups/${taskId}`, {
        headers: { "X-API-KEY": GELATO_API_KEY },
      });
      result = await poll.json();
    }

    const mockupUrl =
      result.mockups?.[0]?.url ||
      result.mockup?.url ||
      result.previewUrl ||
      result.url ||
      null;

    return new Response(JSON.stringify({ mockupUrl, raw: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("gelato-mockup error:", msg);
    // Returnera 200 med fallback så klienten inte kraschar
    return new Response(JSON.stringify({ mockupUrl: null, fallback: true, error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
