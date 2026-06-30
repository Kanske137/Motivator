// TEMPORARY one-shot function: returns Gelato webhook URL with secret.
// Auth: any authenticated Lovable preview user (JWT verified in-function).
// Delete after use.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response("unauthorized", { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const token = auth.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) {
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
