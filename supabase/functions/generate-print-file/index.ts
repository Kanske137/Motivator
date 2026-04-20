// Generates a high-resolution print file from a map state + text and uploads
// it to the print-files Supabase storage bucket.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PrintBody {
  styleId: string;
  center: [number, number]; // [lng, lat]
  zoom: number;
  size: string; // "30x40"
  orientation: "portrait" | "landscape";
  text?: string;
}

// Approximate DPI: 300 dpi at given cm size
function pxFromSize(sizeCm: string, orientation: "portrait" | "landscape"): { w: number; h: number } {
  const [a, b] = sizeCm.split("x").map(Number);
  const wCm = orientation === "portrait" ? a : b;
  const hCm = orientation === "portrait" ? b : a;
  // Mapbox static images caps at 1280x1280 free tier; we request the max and let the print
  // pipeline upscale separately if needed.
  const dpiPx = (cm: number) => Math.min(1280, Math.round((cm / 2.54) * 300));
  return { w: dpiPx(wCm), h: dpiPx(hCm) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const token = Deno.env.get("MAPBOX_PUBLIC_TOKEN");
    if (!token) throw new Error("MAPBOX_PUBLIC_TOKEN missing");

    const body = (await req.json()) as PrintBody;
    const { w, h } = pxFromSize(body.size, body.orientation);
    const styleUrl = `https://api.mapbox.com/styles/v1/mapbox/${body.styleId}/static/${body.center[0]},${body.center[1]},${body.zoom},0,0/${w}x${h}@2x?access_token=${token}&attribution=false&logo=false`;

    const mapRes = await fetch(styleUrl);
    if (!mapRes.ok) {
      const text = await mapRes.text();
      throw new Error(`Mapbox static failed: ${mapRes.status} ${text.slice(0, 200)}`);
    }
    const buf = new Uint8Array(await mapRes.arrayBuffer());

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const filename = `prints/${crypto.randomUUID()}-${body.size}-${body.orientation}.png`;
    const { error: upErr } = await supabase.storage.from("print-files").upload(filename, buf, {
      contentType: "image/png",
      upsert: false,
    });
    if (upErr) throw upErr;

    const { data: pub } = supabase.storage.from("print-files").getPublicUrl(filename);

    return new Response(JSON.stringify({ url: pub.publicUrl, width: w * 2, height: h * 2 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
