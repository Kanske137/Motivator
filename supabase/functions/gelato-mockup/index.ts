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

    // Gelato Mockup API: skapa task
    const create = await fetch("https://order.gelatoapis.com/v4/mockup-tasks", {
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
      throw new Error(task?.message || "Gelato mockup request failed");
    }

    // Polla tills klar
    const taskId = task.taskId || task.id;
    const deadline = Date.now() + 30_000;
    let result = task;
    while (result.status !== "completed" && result.status !== "failed" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const poll = await fetch(`https://order.gelatoapis.com/v4/mockup-tasks/${taskId}`, {
        headers: { "X-API-KEY": GELATO_API_KEY },
      });
      result = await poll.json();
    }

    const mockupUrl = result.mockups?.[0]?.url || result.mockup?.url || null;
    return new Response(JSON.stringify({ mockupUrl, raw: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("gelato-mockup error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
