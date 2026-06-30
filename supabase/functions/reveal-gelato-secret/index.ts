// TEMPORARY one-shot function: returns Gelato webhook URL with secret.
// No auth — will be deleted immediately after the value is retrieved.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const secret = Deno.env.get("GELATO_WEBHOOK_SECRET");
  if (!secret) {
    return new Response("missing", { status: 500, headers: corsHeaders });
  }
  const url = `https://ptzmnusfgdwcqpjpbyco.supabase.co/functions/v1/gelato-webhook?secret=${encodeURIComponent(secret)}`;
  return new Response(JSON.stringify({ url, secret }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
