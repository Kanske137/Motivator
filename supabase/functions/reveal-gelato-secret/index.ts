// TEMPORARY one-shot function: returns the Gelato webhook URL with secret.
// Delete after use.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-reveal-token",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const provided = req.headers.get("x-reveal-token");
  const expected = Deno.env.get("REVEAL_TOKEN");
  if (!expected || provided !== expected) {
    return new Response("unauthorized", { status: 401, headers: corsHeaders });
  }

  const secret = Deno.env.get("GELATO_WEBHOOK_SECRET");
  if (!secret) {
    return new Response("missing secret", { status: 500, headers: corsHeaders });
  }

  const url = `https://ptzmnusfgdwcqpjpbyco.supabase.co/functions/v1/gelato-webhook?secret=${encodeURIComponent(secret)}`;
  return new Response(JSON.stringify({ url, secret }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
