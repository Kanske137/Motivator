// Generates a high-resolution print file from a map state + text and uploads
// it to the print-files Supabase storage bucket.
//
// Renders an SVG composition that mirrors the editor preview:
//   - poster background color
//   - map clipped to mapShape (rect/square/circle)
//   - optional labels (via Mapbox style raster)
//   - optional text overlay (when textVisible)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type MapShape = "rect" | "square" | "circle";

interface PrintBody {
  styleId: string;
  center: [number, number]; // [lng, lat]
  zoom: number;
  size: string; // "30x40"
  orientation: "portrait" | "landscape";
  text?: string;
  textFont?: string;
  textVisible?: boolean;
  showLabels?: boolean;
  mapShape?: MapShape;
  posterBgColor?: string;
}

function pxFromSize(sizeCm: string, orientation: "portrait" | "landscape"): { w: number; h: number } {
  const [a, b] = sizeCm.split("x").map(Number);
  const wCm = orientation === "portrait" ? Math.min(a, b) : Math.max(a, b);
  const hCm = orientation === "portrait" ? Math.max(a, b) : Math.min(a, b);
  // 300 DPI capped at Mapbox 1280px hard limit per dimension
  const dpiPx = (cm: number) => Math.min(1280, Math.round((cm / 2.54) * 300));
  return { w: dpiPx(wCm), h: dpiPx(hCm) };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&apos;"
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const token = Deno.env.get("MAPBOX_PUBLIC_TOKEN");
    if (!token) throw new Error("MAPBOX_PUBLIC_TOKEN missing");

    const body = (await req.json()) as PrintBody;
    const {
      styleId,
      center,
      zoom,
      size,
      orientation,
      text = "",
      textFont = "Inter",
      textVisible = true,
      showLabels = false,
      mapShape = "rect",
      posterBgColor = "#FFFFFF",
    } = body;

    const { w, h } = pxFromSize(size, orientation);

    // Map: square that hugs the shorter side of the poster when shaped, else fills poster
    const mapSize = mapShape === "rect" ? { w, h } : { w: Math.min(w, h), h: Math.min(w, h) };

    // Mapbox static. attribution=false&logo=false. Labels = whether style symbols render.
    // We can't toggle layers via static API; instead we pick a no-labels variant when available.
    // Approach: keep the chosen style; a future improvement could swap to a "no-labels" tileset.
    const styleParam = styleId;
    const mapUrl = `https://api.mapbox.com/styles/v1/mapbox/${styleParam}/static/${center[0]},${center[1]},${zoom},0,0/${mapSize.w}x${mapSize.h}@2x?access_token=${token}&attribution=false&logo=false`;

    console.log(
      `[generate-print-file] ${size} ${orientation} ${w}x${h} shape=${mapShape} bg=${posterBgColor} labels=${showLabels} textVisible=${textVisible}`
    );

    const mapRes = await fetch(mapUrl);
    if (!mapRes.ok) {
      const t = await mapRes.text();
      console.error(`[generate-print-file] Mapbox failed ${mapRes.status}: ${t.slice(0, 300)}`);
      throw new Error(`Mapbox static failed: ${mapRes.status}`);
    }
    const mapBuf = new Uint8Array(await mapRes.arrayBuffer());
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < mapBuf.length; i += CHUNK) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(mapBuf.subarray(i, Math.min(i + CHUNK, mapBuf.length))),
      );
    }
    const mapDataUrl = `data:image/png;base64,${btoa(binary)}`;

    // Build SVG that mirrors the editor frame
    const mapX = (w - mapSize.w * 2) / 2;
    const mapY = (h - mapSize.h * 2) / 2;
    // Map image is @2x → its natural pixel size is mapSize*2; we draw at mapSize (logical) scaled to fit poster.
    // Simpler: draw it at (mapSize.w, mapSize.h) and let the print pixels = same scale as poster.
    const drawW = mapSize.w * 2;
    const drawH = mapSize.h * 2;
    const dx = (w - drawW) / 2;
    const dy = (h - drawH) / 2;

    let clipDef = "";
    let clipAttr = "";
    if (mapShape === "circle") {
      clipDef = `<clipPath id="mc"><circle cx="${dx + drawW / 2}" cy="${dy + drawH / 2}" r="${Math.min(drawW, drawH) / 2}"/></clipPath>`;
      clipAttr = ` clip-path="url(#mc)"`;
    } else if (mapShape === "square") {
      const sq = Math.min(drawW, drawH);
      const sx = dx + (drawW - sq) / 2;
      const sy = dy + (drawH - sq) / 2;
      clipDef = `<clipPath id="mc"><rect x="${sx}" y="${sy}" width="${sq}" height="${sq}"/></clipPath>`;
      clipAttr = ` clip-path="url(#mc)"`;
    }

    // Text block — multi-line, centered horizontally, anchored near bottom (~82% y) to mimic editor layout
    let textSvg = "";
    if (textVisible && text.trim()) {
      const lines = text.split("\n");
      const fontSize = Math.round(Math.min(w, h) * 0.045);
      const lineHeight = Math.round(fontSize * 1.2);
      const totalH = lineHeight * lines.length;
      const baseY = Math.round(h * 0.86) - totalH + lineHeight;
      const tspans = lines
        .map(
          (ln, i) =>
            `<tspan x="${w / 2}" y="${baseY + i * lineHeight}">${escapeXml(ln)}</tspan>`
        )
        .join("");
      textSvg = `<text text-anchor="middle" font-family="${escapeXml(textFont)}, Inter, sans-serif" font-size="${fontSize}" font-weight="500" fill="#1a1a1a" letter-spacing="1">${tspans}</text>`;
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>${clipDef}</defs>
  <rect width="${w}" height="${h}" fill="${posterBgColor}"/>
  <image href="${mapDataUrl}" x="${dx}" y="${dy}" width="${drawW}" height="${drawH}"${clipAttr} preserveAspectRatio="xMidYMid slice"/>
  ${textSvg}
</svg>`;

    // Upload SVG (browsers + canvas can render SVG via <img>)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const filename = `prints/${crypto.randomUUID()}-${size}-${orientation}.svg`;
    const upload = async (attempt: number): Promise<string> => {
      const { error: upErr } = await supabase.storage.from("print-files").upload(
        filename,
        new TextEncoder().encode(svg),
        { contentType: "image/svg+xml", upsert: false }
      );
      if (upErr) {
        console.error(`[generate-print-file] upload attempt ${attempt} failed:`, upErr.message);
        if (attempt < 2) return upload(attempt + 1);
        throw upErr;
      }
      return filename;
    };
    await upload(1);

    const { data: pub } = supabase.storage.from("print-files").getPublicUrl(filename);
    console.log(`[generate-print-file] public URL: ${pub.publicUrl}`);

    return new Response(JSON.stringify({ url: pub.publicUrl, width: w, height: h }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[generate-print-file] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
