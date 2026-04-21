// Generates a high-resolution PNG print file from an artwork source + text and
// uploads it to the print-files Supabase storage bucket.
//
// Design principle: "Compose, don't rasterize."
// We let the source image (Mapbox tile or uploaded photo / AI-generated image)
// define the final canvas pixel dimensions. The SVG references the image 1:1
// — no upscaling — so resvg only has to rasterize the text + clip overlay.
// This keeps CPU well under the edge-runtime budget for any artwork type.
//
// Pipeline (identical for map / image):
//   1. Fetch source PNG → know its native (w, h)
//   2. Build SVG at exactly (w, h) with bg + <image> 1:1 + clip + text
//   3. resvg → PNG
//   4. Upload to print-files bucket → return public URL + dimensions
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { render as renderSvgToPng } from "https://deno.land/x/resvg_wasm/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type MapShape = "rect" | "square" | "circle";

type Artwork =
  | {
      kind: "map";
      styleId: string;
      center: [number, number];
      zoom: number;
      showLabels?: boolean;
    }
  | {
      kind: "image";
      sourceUrl: string;
    };

interface PrintBody {
  // New shape
  artwork?: Artwork;
  // Legacy shape (still accepted) — treated as { kind: "map", ... }
  styleId?: string;
  center?: [number, number];
  zoom?: number;
  showLabels?: boolean;

  // Common
  size: string;
  orientation: "portrait" | "landscape";
  text?: string;
  textFont?: string;
  textVisible?: boolean;
  mapShape?: MapShape;
  posterBgColor?: string;
}

// Cap on the longest pixel side. 2560 matches Mapbox @2x max (1280×2 = 2560)
// and is a comfortable upper bound for AI / photo sources too.
const MAX_LONG_SIDE = 2560;

// Returns target render-aspect dimensions (width, height) for the requested
// poster size + orientation. Used only to derive the aspect ratio the source
// image should match — the actual final pixel count comes from the source.
function aspectFromSize(
  sizeCm: string,
  orientation: "portrait" | "landscape"
): { wCm: number; hCm: number; aspect: number } {
  const [a, b] = sizeCm.split("x").map(Number);
  const wCm = orientation === "portrait" ? Math.min(a, b) : Math.max(a, b);
  const hCm = orientation === "portrait" ? Math.max(a, b) : Math.min(a, b);
  return { wCm, hCm, aspect: wCm / hCm };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&apos;"
  );
}

function bufferToBase64(buf: Uint8Array): string {
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(buf.subarray(i, Math.min(i + CHUNK, buf.length))),
    );
  }
  return btoa(binary);
}

// Read PNG width/height from IHDR chunk (bytes 16..23).
function readPngDimensions(buf: Uint8Array): { w: number; h: number } | null {
  if (buf.length < 24) return null;
  // PNG signature 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const w = dv.getUint32(16);
  const h = dv.getUint32(20);
  return { w, h };
}

// Read JPEG width/height by walking SOF markers.
function readJpegDimensions(buf: Uint8Array): { w: number; h: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    i += 2;
    // SOF0..SOF15 except DHT(0xC4), DAC(0xCC), DNL(0xDC)
    if (
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xcc && marker !== 0xc8
    ) {
      const h = (buf[i + 3] << 8) | buf[i + 4];
      const w = (buf[i + 5] << 8) | buf[i + 6];
      return { w, h };
    }
    const segLen = (buf[i] << 8) | buf[i + 1];
    if (segLen < 2) return null;
    i += segLen;
  }
  return null;
}

function readImageDimensions(buf: Uint8Array, mime: string): { w: number; h: number } | null {
  if (mime.includes("png")) return readPngDimensions(buf);
  if (mime.includes("jpeg") || mime.includes("jpg")) return readJpegDimensions(buf);
  // Try PNG first then JPEG
  return readPngDimensions(buf) ?? readJpegDimensions(buf);
}

// Mapbox Static API renders the style as-authored — including label layers.
// To honour the editor's "show labels off" choice, swap in a label-free
// variant of the style. Mapbox's stock styles do NOT ship label-free versions,
// so for full parity you should create custom no-labels styles in Mapbox Studio
// and map them here (e.g. "yourorg/light-no-labels").
const NO_LABEL_STYLE: Record<string, string> = {
  // Extend per project needs once custom no-label styles exist in Mapbox Studio.
};

function resolveMapboxStyle(styleId: string, showLabels: boolean): string {
  // Style IDs come in as bare ("light-v11") or namespaced ("mapbox/light-v11").
  const full = styleId.includes("/") ? styleId : `mapbox/${styleId}`;
  if (showLabels) return full;
  return NO_LABEL_STYLE[full] ?? NO_LABEL_STYLE[styleId] ?? full;
}

// Fetch the artwork source as raw bytes + mime type.
async function fetchArtworkSource(
  artwork: Artwork,
  aspect: number,
  mapboxToken: string
): Promise<{ buf: Uint8Array; mime: string; w: number; h: number }> {
  if (artwork.kind === "map") {
    // Largest tile that fits the aspect, capped at Mapbox @2x max (1280 per side).
    const TILE_MAX = 1280;
    const tileW = aspect >= 1 ? TILE_MAX : Math.round(TILE_MAX * aspect);
    const tileH = aspect >= 1 ? Math.round(TILE_MAX / aspect) : TILE_MAX;
    const effectiveStyle = resolveMapboxStyle(artwork.styleId, artwork.showLabels !== false);
    const url = `https://api.mapbox.com/styles/v1/${effectiveStyle}/static/${artwork.center[0]},${artwork.center[1]},${artwork.zoom},0,0/${tileW}x${tileH}@2x?access_token=${mapboxToken}&attribution=false&logo=false`;
    console.log(`[generate-print-file] mapbox style=${effectiveStyle} showLabels=${artwork.showLabels !== false}`);
    const res = await fetch(url);
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Mapbox static failed ${res.status}: ${t.slice(0, 300)}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const dims = readPngDimensions(buf) ?? { w: tileW * 2, h: tileH * 2 };
    return { buf, mime: "image/png", w: dims.w, h: dims.h };
  }

  // kind === "image"
  const res = await fetch(artwork.sourceUrl);
  if (!res.ok) {
    throw new Error(`Image source fetch failed ${res.status}: ${artwork.sourceUrl}`);
  }
  const mime = res.headers.get("content-type") ?? "image/png";
  const buf = new Uint8Array(await res.arrayBuffer());
  const dims = readImageDimensions(buf, mime);
  if (!dims) throw new Error(`Could not read image dimensions (mime=${mime})`);
  return { buf, mime, w: dims.w, h: dims.h };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();

  try {
    const body = (await req.json()) as PrintBody;

    // Normalize to Artwork (legacy → map)
    const artwork: Artwork = body.artwork
      ? body.artwork
      : {
          kind: "map",
          styleId: body.styleId!,
          center: body.center!,
          zoom: body.zoom!,
          showLabels: body.showLabels,
        };

    if (artwork.kind === "map" && (!artwork.styleId || !artwork.center || artwork.zoom == null)) {
      throw new Error("artwork.kind=map requires styleId, center, zoom");
    }
    if (artwork.kind === "image" && !artwork.sourceUrl) {
      throw new Error("artwork.kind=image requires sourceUrl");
    }

    const {
      size,
      orientation,
      text = "",
      textFont = "Inter",
      textVisible = true,
      mapShape = "rect",
      posterBgColor = "#FFFFFF",
    } = body;

    const mapboxToken = Deno.env.get("MAPBOX_PUBLIC_TOKEN") ?? "";
    if (artwork.kind === "map" && !mapboxToken) throw new Error("MAPBOX_PUBLIC_TOKEN missing");

    const { aspect } = aspectFromSize(size, orientation);

    console.log(
      `[generate-print-file] start kind=${artwork.kind} size=${size} ${orientation} aspect=${aspect.toFixed(3)} shape=${mapShape}`
    );

    // 1) Fetch source
    const src = await fetchArtworkSource(artwork, aspect, mapboxToken);
    console.log(
      `[generate-print-file] source fetched: ${src.w}x${src.h} (${src.buf.byteLength} bytes, ${src.mime})`
    );

    // 2) Use source pixels as the canvas. Optionally downscale if absurdly large.
    let w = src.w;
    let h = src.h;
    const longest = Math.max(w, h);
    if (longest > MAX_LONG_SIDE) {
      const scale = MAX_LONG_SIDE / longest;
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      console.log(`[generate-print-file] capped canvas to ${w}x${h} (was ${src.w}x${src.h})`);
    }

    const dataUrl = `data:${src.mime};base64,${bufferToBase64(src.buf)}`;

    // 3) Shape clip (centered, hugs shorter side)
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

    // 4) Text overlay
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

    // 5) SVG at source-native dimensions — image is 1:1, no upscaling.
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>${clipDef}</defs>
  <rect width="${w}" height="${h}" fill="${posterBgColor}"/>
  <image href="${dataUrl}" x="0" y="0" width="${w}" height="${h}"${clipAttr} preserveAspectRatio="xMidYMid slice"/>
  ${textSvg}
</svg>`;

    const tRender0 = Date.now();
    const pngData = await renderSvgToPng(svg);
    const tRender = Date.now() - tRender0;
    console.log(
      `[generate-print-file] PNG rasterized: ${pngData.byteLength} bytes in ${tRender}ms (canvas ${w}x${h})`
    );

    // 6) Upload
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
    const tTotal = Date.now() - t0;
    console.log(
      `[generate-print-file] DONE in ${tTotal}ms → ${pub.publicUrl}`
    );

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
