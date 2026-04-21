// Generates a high-resolution PNG print file from an artwork source + text.
//
// Architecture: "Compose, don't rasterize"
// - Source image (Mapbox tile / uploaded photo / AI image) defines canvas pixels.
// - We use ImageScript (pure-TS, no WASM SVG parser) for direct pixel ops:
//   decode → optional clip mask → optional text overlay → encode.
// - CPU cost scales with overlay area, NOT total image area, so 20+ MP photos
//   work fine. resvg-WASM was the bottleneck (re-rasterized whole canvas).
// - Pass-through fast path: kind=image + rect + no text → upload source as-is.
//
// Pipeline (kind-agnostic):
//   1. Fetch source bytes (+ native dims)
//   2. If pass-through eligible → upload source bytes directly, return URL
//   3. Else: decode → composite bg → apply circle/square mask → draw text
//   4. Encode PNG → upload → return URL
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image, decode } from "https://deno.land/x/[email protected]/mod.ts";

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
  artwork?: Artwork;
  // Legacy
  styleId?: string;
  center?: [number, number];
  zoom?: number;
  showLabels?: boolean;

  size: string;
  orientation: "portrait" | "landscape";
  text?: string;
  textFont?: string;
  textVisible?: boolean;
  mapShape?: MapShape;
  posterBgColor?: string;
}

// Cap on the longest pixel side. Keeps CPU bounded for the compose path.
const MAX_LONG_SIDE = 2400;

// Mapbox label-free style mapping. Stock Mapbox styles ship with labels;
// supply custom Mapbox Studio "no-labels" variants here for full parity.
const NO_LABEL_STYLE: Record<string, string> = {
  // Extend per project needs once custom no-label styles exist in Mapbox Studio.
};

// Font is loaded lazily on first compose request and cached for warm invocations.
let cachedFont: Uint8Array | null = null;
async function loadFont(): Promise<Uint8Array> {
  if (cachedFont) return cachedFont;
  // Inter Regular from Google Fonts CDN (TTF). ~140 KB, cached on warm starts.
  const url = "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Regular.otf";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed ${res.status}`);
  cachedFont = new Uint8Array(await res.arrayBuffer());
  return cachedFont;
}

function aspectFromSize(
  sizeCm: string,
  orientation: "portrait" | "landscape"
): { aspect: number } {
  const [a, b] = sizeCm.split("x").map(Number);
  const wCm = orientation === "portrait" ? Math.min(a, b) : Math.max(a, b);
  const hCm = orientation === "portrait" ? Math.max(a, b) : Math.min(a, b);
  return { aspect: wCm / hCm };
}

function resolveMapboxStyle(styleId: string, showLabels: boolean): string {
  const full = styleId.includes("/") ? styleId : `mapbox/${styleId}`;
  if (showLabels) return full;
  return NO_LABEL_STYLE[full] ?? NO_LABEL_STYLE[styleId] ?? full;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const v = h.length === 3
    ? h.split("").map((c) => c + c).join("")
    : h.padEnd(6, "0");
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function rgbaUint(r: number, g: number, b: number, a = 255): number {
  return ((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff);
}

async function fetchArtworkSource(
  artwork: Artwork,
  aspect: number,
  mapboxToken: string
): Promise<{ buf: Uint8Array; mime: string }> {
  if (artwork.kind === "map") {
    const TILE_MAX = 1200;
    const tileW = aspect >= 1 ? TILE_MAX : Math.round(TILE_MAX * aspect);
    const tileH = aspect >= 1 ? Math.round(TILE_MAX / aspect) : TILE_MAX;
    const effectiveStyle = resolveMapboxStyle(
      artwork.styleId,
      artwork.showLabels !== false
    );
    const url =
      `https://api.mapbox.com/styles/v1/${effectiveStyle}/static/` +
      `${artwork.center[0]},${artwork.center[1]},${artwork.zoom},0,0/` +
      `${tileW}x${tileH}@2x?access_token=${mapboxToken}&attribution=false&logo=false`;
    console.log(
      `[generate-print-file] mapbox style=${effectiveStyle} showLabels=${artwork.showLabels !== false}`
    );
    const res = await fetch(url);
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Mapbox static failed ${res.status}: ${t.slice(0, 300)}`);
    }
    return { buf: new Uint8Array(await res.arrayBuffer()), mime: "image/png" };
  }
  const res = await fetch(artwork.sourceUrl);
  if (!res.ok) throw new Error(`Image source fetch failed ${res.status}`);
  const mime = res.headers.get("content-type") ?? "image/png";
  return { buf: new Uint8Array(await res.arrayBuffer()), mime };
}

// Apply a circular or square clip by writing the bg color to all pixels
// outside the shape. Single linear scan — O(w*h), no allocation.
function applyShapeClip(
  img: Image,
  shape: MapShape,
  bgColor: { r: number; g: number; b: number }
) {
  if (shape === "rect") return;
  const w = img.width;
  const h = img.height;
  const bg = rgbaUint(bgColor.r, bgColor.g, bgColor.b, 255);

  if (shape === "circle") {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2;
    const r2 = r * r;
    for (let y = 0; y < h; y++) {
      const dy = y - cy;
      const dy2 = dy * dy;
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        if (dx * dx + dy2 > r2) {
          img.setPixelAt(x + 1, y + 1, bg);
        }
      }
    }
    return;
  }

  // square
  const sq = Math.min(w, h);
  const sx = (w - sq) / 2;
  const sy = (h - sq) / 2;
  const ex = sx + sq;
  const ey = sy + sq;
  for (let y = 0; y < h; y++) {
    if (y >= sy && y < ey) {
      // Fill left strip
      for (let x = 0; x < sx; x++) img.setPixelAt(x + 1, y + 1, bg);
      // Fill right strip
      for (let x = ex; x < w; x++) img.setPixelAt(x + 1, y + 1, bg);
    } else {
      for (let x = 0; x < w; x++) img.setPixelAt(x + 1, y + 1, bg);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();

  try {
    const body = (await req.json()) as PrintBody;

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const hasText = textVisible && text.trim().length > 0;
    const needsCompose = mapShape !== "rect" || hasText || artwork.kind === "map";
    // Note: maps always need compose (label/style fetched fresh), images can pass through.

    // 1) Fetch source
    const src = await fetchArtworkSource(artwork, aspect, mapboxToken);
    console.log(
      `[generate-print-file] source fetched: ${src.buf.byteLength} bytes (${src.mime})`
    );

    // 2) Pass-through fast path: image + rect + no text → upload source bytes as-is
    if (!needsCompose && artwork.kind === "image") {
      const ext = src.mime.includes("jpeg") ? "jpg" : "png";
      const filename = `prints/${crypto.randomUUID()}-${size}-${orientation}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("print-files")
        .upload(filename, src.buf, { contentType: src.mime, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("print-files").getPublicUrl(filename);
      // Decode just to read dims for response
      const decoded = await decode(src.buf);
      const w = (decoded as Image).width;
      const h = (decoded as Image).height;
      console.log(
        `[generate-print-file] PASS-THROUGH done in ${Date.now() - t0}ms → ${pub.publicUrl} (${w}x${h})`
      );
      return new Response(JSON.stringify({ url: pub.publicUrl, width: w, height: h }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) Compose path
    const tDecode0 = Date.now();
    const decoded = await decode(src.buf);
    let img = decoded as Image;
    console.log(
      `[generate-print-file] decoded ${img.width}x${img.height} in ${Date.now() - tDecode0}ms`
    );

    // Cap canvas size for CPU safety
    const longest = Math.max(img.width, img.height);
    if (longest > MAX_LONG_SIDE) {
      const scale = MAX_LONG_SIDE / longest;
      const nw = Math.round(img.width * scale);
      const nh = Math.round(img.height * scale);
      const tResize0 = Date.now();
      img = img.resize(nw, nh);
      console.log(
        `[generate-print-file] resized to ${nw}x${nh} in ${Date.now() - tResize0}ms`
      );
    }

    const w = img.width;
    const h = img.height;
    const bgRgb = hexToRgb(posterBgColor);

    // Shape clip — paint outside-shape pixels with bg color
    if (mapShape !== "rect") {
      const tClip0 = Date.now();
      applyShapeClip(img, mapShape, bgRgb);
      console.log(`[generate-print-file] clipped to ${mapShape} in ${Date.now() - tClip0}ms`);
    }

    // Text overlay (rendered as separate transparent image, composited)
    if (hasText) {
      const tText0 = Date.now();
      const fontBuf = await loadFont();
      const lines = text.split("\n");
      const fontSize = Math.round(w * 0.035);
      const lineGap = Math.round(fontSize * 0.3);

      // Render each line, then composite centered
      let yCursor = Math.round(h * 0.88);
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.trim()) {
          yCursor -= fontSize + lineGap;
          continue;
        }
        const textImg = Image.renderText(fontBuf, fontSize, line, rgbaUint(26, 26, 26, 255));
        const tx = Math.round((w - textImg.width) / 2);
        const ty = yCursor - textImg.height;
        img.composite(textImg, tx, ty);
        yCursor -= textImg.height + lineGap;
      }
      console.log(`[generate-print-file] text drawn in ${Date.now() - tText0}ms`);
    }

    // Encode → PNG
    const tEnc0 = Date.now();
    const pngData = await img.encode();
    console.log(
      `[generate-print-file] encoded ${pngData.byteLength} bytes in ${Date.now() - tEnc0}ms (canvas ${w}x${h})`
    );

    // Upload
    const filename = `prints/${crypto.randomUUID()}-${size}-${orientation}.png`;
    const { error: upErr } = await supabase.storage
      .from("print-files")
      .upload(filename, pngData, { contentType: "image/png", upsert: false });
    if (upErr) throw upErr;

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
