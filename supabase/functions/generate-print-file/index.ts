// Generates a high-resolution PNG print file from a map state + text and uploads
// it to the print-files Supabase storage bucket.
//
// Pipeline:
//   1. Build SVG composition (bg + clipped Mapbox raster + text overlay)
//   2. Rasterize SVG to PNG via @resvg/resvg-wasm (Gelato accepts PNG @300 DPI)
//   3. Upload PNG to print-files bucket and return public URL
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resvg, initWasm } from "https://esm.sh/@resvg/[email protected]";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type MapShape = "rect" | "square" | "circle";

interface PrintBody {
  styleId: string;
  center: [number, number];
  zoom: number;
  size: string;
  orientation: "portrait" | "landscape";
  text?: string;
  textFont?: string;
  textVisible?: boolean;
  showLabels?: boolean;
  mapShape?: MapShape;
  posterBgColor?: string;
}

// Returns target print-file pixel dimensions at ~300 DPI.
// Mapbox static API caps at 1280px @2x — so the tile we fetch is smaller
// than the final PNG and is upscaled inside the SVG.
function pxFromSize(sizeCm: string, orientation: "portrait" | "landscape"): { w: number; h: number } {
  const [a, b] = sizeCm.split("x").map(Number);
  const wCm = orientation === "portrait" ? Math.min(a, b) : Math.max(a, b);
  const hCm = orientation === "portrait" ? Math.max(a, b) : Math.min(a, b);
  // Cap final PNG side to 4500px to keep memory/runtime sane (still > 300DPI for 30x40)
  const dpiPx = (cm: number) => Math.min(4500, Math.round((cm / 2.54) * 300));
  return { w: dpiPx(wCm), h: dpiPx(hCm) };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&apos;"
  );
}

let wasmReady: Promise<void> | null = null;
async function ensureResvg(): Promise<void> {
  if (!wasmReady) {
    wasmReady = (async () => {
      const wasmRes = await fetch("https://esm.sh/@resvg/[email protected]/index_bg.wasm");
      const wasmBuf = await wasmRes.arrayBuffer();
      await initWasm(wasmBuf);
    })();
  }
  return wasmReady;
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
      showLabels: _showLabels = false,
      mapShape = "rect",
      posterBgColor = "#FFFFFF",
    } = body;

    const { w, h } = pxFromSize(size, orientation);

    // Mapbox static tile — capped @2x at 1280px per side. We fetch at the
    // largest tile size that fits the poster aspect, then upscale in SVG.
    const TILE_MAX = 1280;
    const aspect = w / h;
    const tileW = aspect >= 1 ? TILE_MAX : Math.round(TILE_MAX * aspect);
    const tileH = aspect >= 1 ? Math.round(TILE_MAX / aspect) : TILE_MAX;
    const mapUrl = `https://api.mapbox.com/styles/v1/mapbox/${styleId}/static/${center[0]},${center[1]},${zoom},0,0/${tileW}x${tileH}@2x?access_token=${token}&attribution=false&logo=false`;

    console.log(
      `[generate-print-file] ${size} ${orientation} target=${w}x${h} tile=${tileW}x${tileH} shape=${mapShape} bg=${posterBgColor} text=${textVisible}`
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

    // Shape clip (centered on poster rect, hugging shorter side)
    let clipDef = "";
    let clipAttr = "";
    if (mapShape === "circle") {
      const r = Math.min(w, h) / 2;
      clipDef = `<clipPath id="mc"><circle cx="${w / 2}" cy="${h / 2}" r="${r}"/></clipPath>`;
      clipAttr = ` clip-path="url(#mc)"`;
    } else if (mapShape === "square") {
      const sq = Math.min(w, h);
      const sx = (w - sq) / 2;
      const sy = (h - sq) / 2;
      clipDef = `<clipPath id="mc"><rect x="${sx}" y="${sy}" width="${sq}" height="${sq}"/></clipPath>`;
      clipAttr = ` clip-path="url(#mc)"`;
    }

    // Text overlay
    let textSvg = "";
    if (textVisible && text.trim()) {
      const lines = text.split("\n");
      const fontSize = Math.round(w * 0.035);
      const lineHeight = Math.round(fontSize * 1.25);
      const totalH = lineHeight * lines.length;
      const baseY = Math.round(h * 0.88) - totalH + lineHeight;
      const tspans = lines
        .map(
          (ln, i) =>
            `<tspan x="${w / 2}" y="${baseY + i * lineHeight}">${escapeXml(ln)}</tspan>`
        )
        .join("");
      textSvg = `<text text-anchor="middle" font-family="${escapeXml(textFont)}, Inter, sans-serif" font-size="${fontSize}" font-weight="400" fill="#1a1a1a" letter-spacing="${(fontSize * 0.05).toFixed(2)}">${tspans}</text>`;
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>${clipDef}</defs>
  <rect width="${w}" height="${h}" fill="${posterBgColor}"/>
  <image href="${mapDataUrl}" x="0" y="0" width="${w}" height="${h}"${clipAttr} preserveAspectRatio="xMidYMid slice"/>
  ${textSvg}
</svg>`;

    // Rasterize SVG → PNG via resvg-wasm
    await ensureResvg();
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: w },
      background: posterBgColor,
      font: { loadSystemFonts: false, defaultFontFamily: "Inter" },
    });
    const pngData = resvg.render().asPng();
    console.log(`[generate-print-file] PNG rasterized: ${pngData.byteLength} bytes`);

    // Upload PNG
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const filename = `prints/${crypto.randomUUID()}-${size}-${orientation}.png`;
    const upload = async (attempt: number): Promise<string> => {
      const { error: upErr } = await supabase.storage.from("print-files").upload(
        filename,
        pngData,
        { contentType: "image/png", upsert: false }
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
