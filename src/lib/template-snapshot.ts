// Multi-layer snapshot renderer. Loops template layers in zIndex order and
// composites them onto a single 2D canvas at the requested print resolution.
//
// Each layer type has its own draw step:
//   - map     → spin up a headless Mapbox GL instance, await idle, drawImage
//   - text    → ctx.fillText with the layer's font/colour/align/sizePct
//   - image   → load + drawImage with shape clipping
//   - line    → strokeRect / strokeLine
//   - margin  → strokeRect inset
//
// Map layers are rendered SEQUENTIALLY (one Mapbox instance at a time) to
// avoid GPU context exhaustion on weaker devices. The customer's live values
// (mapCenter/mapZoom/mapStyleId/etc.) override the LIVE layer's defaults; all
// other map layers stay locked to their template defaults.
import mapboxgl from "mapbox-gl";
import { getMapboxToken, styleUrl } from "./mapbox";
import type { Template, TemplateLayer } from "./template-schema";
import type { LayerValue } from "@/stores/editorStore";
import { getActiveMarginInsetsPct, expandRectForRemovedMargin } from "./layer-utils";

export interface TemplateSnapshotInput {
  template: Template;
  orientation: "portrait" | "landscape";
  size: string; // "30x40"

  // Per-layer values keyed by layer id. When provided, these override the
  // legacy live* fields. Falls back to layer.defaults when missing.
  layerValues?: Record<string, LayerValue>;

  /** Customer-driven rect overrides (size slider / drag) keyed by layer id. */
  layerTransforms?: Record<string, { xPct?: number; yPct?: number; wPct?: number; hPct?: number }>;

  // Legacy live customer state — overrides defaults on the FIRST map/text
  // layer when `layerValues` is not supplied.
  liveMapCenter: [number, number];
  liveMapZoom: number;
  liveMapStyleId: string;
  liveMapShape: "circle" | "heart" | "star";
  liveShowLabels: boolean;
  liveText: string;
  liveTextFont: string;
  liveTextVisible: boolean;
  livePosterBgColor: string;

  // Output sizing
  wrapCm?: number;
  bleedCm?: number;
  hires?: boolean;
  maxPxOverride?: number;

  // Optional frame / canvas-wrap overlay (drawn ON TOP of layers — preview/cart only).
  frameColor?: string;
  frameWidthCm?: number;
  canvasWrap?: boolean;

  /** Customer-uploaded photo or AI result. Rendered into every `photo` layer. */
  photoOverlayUrl?: string;

  /** Per-aiPhoto-layer face-swap result URLs. Falls back to the layer's
   *  admin-set referenceImageUrl when no result is present. */
  aiPhotoResults?: Record<string, string>;

  /** Customer toggle: when false, the white margin layer is omitted and all
   *  other layers are expanded proportionally to fill the freed area. */
  whiteMarginEnabled?: boolean;
}

export interface TemplateSnapshotResult {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  sizeBytes: number;
}

function pickHiresMaxPx(): number {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  if (isMobile) return 2800;
  if (dpr >= 2) return 4800;
  return 4200;
}

function parseSize(size: string, orientation: "portrait" | "landscape") {
  const m = size.match(/(\d+)\s*x\s*(\d+)/i);
  if (!m) return { wCm: 30, hCm: 40 };
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  const wCm = orientation === "portrait" ? Math.min(a, b) : Math.max(a, b);
  const hCm = orientation === "portrait" ? Math.max(a, b) : Math.min(a, b);
  return { wCm, hCm };
}

function createOffscreen(w: number, h: number): HTMLDivElement {
  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.left = "-99999px";
  el.style.top = "0";
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.pointerEvents = "none";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  return el;
}

/** Apply shape clip via Path2D. Mirrors the SVG paths used in MapPreview. */
function clipForShape(
  ctx: CanvasRenderingContext2D,
  shape: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.beginPath();
  if (shape === "circle") {
    // Perfect circle inscribed within the rect (diameter = shortest side),
    // centered. Matches editor's `useCircleClip` / px-radius CSS clip-path.
    const r = Math.min(w, h) / 2;
    ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
  } else if (shape === "heart") {
    const sx = (vx: number) => x + vx * w;
    const sy = (vy: number) => y + vy * h;
    ctx.moveTo(sx(0.5), sy(1));
    ctx.bezierCurveTo(sx(0.5), sy(1), sx(0), sy(0.65), sx(0), sy(0.3));
    ctx.bezierCurveTo(sx(0), sy(0.1), sx(0.2), sy(0), sx(0.35), sy(0));
    ctx.bezierCurveTo(sx(0.42), sy(0), sx(0.48), sy(0.05), sx(0.5), sy(0.15));
    ctx.bezierCurveTo(sx(0.52), sy(0.05), sx(0.58), sy(0), sx(0.65), sy(0));
    ctx.bezierCurveTo(sx(0.8), sy(0), sx(1), sy(0.1), sx(1), sy(0.3));
    ctx.bezierCurveTo(sx(1), sy(0.65), sx(0.5), sy(1), sx(0.5), sy(1));
    ctx.closePath();
  } else if (shape === "star") {
    const sx = (vx: number) => x + vx * w;
    const sy = (vy: number) => y + vy * h;
    const pts: Array<[number, number]> = [
      [0.5, 0], [0.618, 0.345], [0.976, 0.345], [0.690, 0.560], [0.794, 0.905],
      [0.5, 0.690], [0.206, 0.905], [0.310, 0.560], [0.024, 0.345], [0.382, 0.345],
    ];
    ctx.moveTo(sx(pts[0][0]), sy(pts[0][1]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i][0]), sy(pts[i][1]));
    ctx.closePath();
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.clip();
}

/** Render a single map layer onto the output canvas at the given pixel rect. */
async function drawMapLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  opts: {
    center: [number, number];
    zoom: number;
    styleId: string;
    showLabels: boolean;
    shape: string;
  },
): Promise<void> {
  const container = createOffscreen(rect.w, rect.h);
  const mapDiv = document.createElement("div");
  mapDiv.style.width = `${rect.w}px`;
  mapDiv.style.height = `${rect.h}px`;
  container.appendChild(mapDiv);

  let map: mapboxgl.Map | null = null;
  try {
    map = new mapboxgl.Map({
      container: mapDiv,
      style: styleUrl(opts.styleId),
      center: opts.center,
      zoom: opts.zoom,
      interactive: false,
      attributionControl: false,
      preserveDrawingBuffer: true,
      fadeDuration: 0,
    });

    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error("Map render timeout")), 15000);
      map!.once("error", (e) => {
        window.clearTimeout(t);
        reject(new Error(`Mapbox error: ${(e as any)?.error?.message ?? "unknown"}`));
      });
      map!.on("idle", () => {
        window.clearTimeout(t);
        resolve();
      });
    });

    try {
      const style = map.getStyle();
      if (style?.layers) {
        for (const sl of style.layers) {
          if (sl.type === "symbol") {
            map.setLayoutProperty(sl.id, "visibility", opts.showLabels ? "visible" : "none");
          }
        }
      }
      // Wait an extra idle cycle for tiles to redraw after toggling labels.
      await new Promise<void>((resolve) => {
        const t = window.setTimeout(() => resolve(), 1500);
        map!.once("idle", () => {
          window.clearTimeout(t);
          resolve();
        });
      });
    } catch (e) {
      console.warn("[template-snapshot] label toggle failed", e);
    }

    const mapCanvas = map.getCanvas();
    ctx.save();
    clipForShape(ctx, opts.shape, rect.x, rect.y, rect.w, rect.h);
    ctx.drawImage(mapCanvas, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  } finally {
    try {
      map?.remove();
    } catch {
      /* noop */
    }
    if (container.parentNode) container.parentNode.removeChild(container);
  }
}

function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  layer: Extract<TemplateLayer, { type: "text" }>,
  liveText: string,
  liveFont: string,
): void {
  const d = layer.defaults;
  const text = liveText || d.text;
  if (!text.trim()) return;
  const lines = text.split("\n");
  const fontPx = Math.max(8, Math.round(rect.h * (d.fontSizePct / 100)));
  const lineH = Math.round(fontPx * 1.15);
  ctx.save();
  ctx.fillStyle = d.color;
  ctx.font = `500 ${fontPx}px ${liveFont || d.font}, Inter, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = d.align === "left" ? "left" : d.align === "right" ? "right" : "center";
  const tx = d.align === "left" ? rect.x : d.align === "right" ? rect.x + rect.w : rect.x + rect.w / 2;
  const totalH = lineH * lines.length;
  const firstY = rect.y + rect.h / 2 - totalH / 2 + lineH / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, tx, firstY + i * lineH);
  });
  ctx.restore();
}

async function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  layer: Extract<TemplateLayer, { type: "image" }>,
): Promise<void> {
  const url = layer.defaults.url;
  if (!url) return;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Image layer load failed"));
    i.src = url;
  });
  ctx.save();
  clipForShape(ctx, layer.defaults.shape, rect.x, rect.y, rect.w, rect.h);
  if (layer.defaults.fit === "contain") {
    const ar = img.width / img.height;
    const rar = rect.w / rect.h;
    let dw = rect.w;
    let dh = rect.h;
    if (ar > rar) {
      dh = rect.w / ar;
    } else {
      dw = rect.h * ar;
    }
    const dx = rect.x + (rect.w - dw) / 2;
    const dy = rect.y + (rect.h - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    // cover
    const ar = img.width / img.height;
    const rar = rect.w / rect.h;
    let sw = img.width;
    let sh = img.height;
    if (ar > rar) {
      sw = img.height * rar;
    } else {
      sh = img.width / rar;
    }
    const sx = (img.width - sw) / 2;
    const sy = (img.height - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

async function drawPhotoLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  url: string,
  shape: "rect" | "circle" | "heart" | "star",
  fit: "cover" | "contain",
  offsetX: number,
  offsetY: number,
): Promise<void> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Photo layer load failed"));
    i.src = url;
  });
  ctx.save();
  clipForShape(ctx, shape, rect.x, rect.y, rect.w, rect.h);
  if (fit === "contain") {
    const ar = img.width / img.height;
    const rar = rect.w / rect.h;
    let dw = rect.w;
    let dh = rect.h;
    if (ar > rar) dh = rect.w / ar;
    else dw = rect.h * ar;
    ctx.drawImage(img, rect.x + (rect.w - dw) / 2, rect.y + (rect.h - dh) / 2, dw, dh);
  } else {
    // Cover: pick the source-image rect that maps 1:1 to the layer rect.
    // scale = max(layerW/imgW, layerH/imgH) — same as CSS object-fit: cover.
    // Source crop in image pixels: sw = layerW/scale, sh = layerH/scale.
    // Pan offsets are percent of LAYER size in editor → convert to source px.
    const scale = Math.max(rect.w / img.width, rect.h / img.height);
    const sw = rect.w / scale;
    const sh = rect.h / scale;
    const overflowXPx = img.width - sw; // source pixels of horizontal overflow
    const overflowYPx = img.height - sh;
    const maxOffsetXPct = (overflowXPx / sw) * 50; // matches editor clamp
    const maxOffsetYPct = (overflowYPx / sh) * 50;
    const clampedX = Math.max(-maxOffsetXPct, Math.min(maxOffsetXPct, offsetX));
    const clampedY = Math.max(-maxOffsetYPct, Math.min(maxOffsetYPct, offsetY));
    // Editor: positive offsetX shifts the image to the right → source crop
    // moves left → subtract from sx.
    const srcOffsetX = (clampedX / 100) * sw;
    const srcOffsetY = (clampedY / 100) * sh;
    const sx = overflowXPx / 2 - srcOffsetX;
    const sy = overflowYPx / 2 - srcOffsetY;
    ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

function drawLineLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  layer: Extract<TemplateLayer, { type: "line" }>,
  _pxPerMm: number,
  frontShortPx: number,
): void {
  const d = layer.defaults;
  // Same formula as editor + customer preview (LINE_THICKNESS_MM_TO_SHORT_SIDE_PCT
  // = 0.5 → thickness = thicknessMm * 0.5% of front short side). Renders the
  // line FLUSH against one edge of its bounding rect so corners meet pixel-
  // perfectly when extendLineToMeetCorners has run in the admin.
  const thick = Math.max(1, (d.thicknessMm * 0.5 / 100) * frontShortPx);
  ctx.save();
  ctx.fillStyle = d.color;
  if (d.orientation === "horizontal") {
    ctx.fillRect(rect.x, rect.y, rect.w, thick);
  } else {
    ctx.fillRect(rect.x, rect.y, thick, rect.h);
  }
  ctx.restore();
}

function drawMarginLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  layer: Extract<TemplateLayer, { type: "margin" }>,
  _pxPerMm: number,
  canvasShortPx: number,
): void {
  const d = layer.defaults;
  // thicknessPct is % of the canvas SHORT side → symmetric on all 4 sides.
  const thick = Math.max(1, Math.round((d.thicknessPct / 100) * canvasShortPx));
  ctx.save();
  ctx.fillStyle = d.color;
  // Top
  ctx.fillRect(rect.x, rect.y, rect.w, thick);
  // Bottom
  ctx.fillRect(rect.x, rect.y + rect.h - thick, rect.w, thick);
  // Left
  ctx.fillRect(rect.x, rect.y, thick, rect.h);
  // Right
  ctx.fillRect(rect.x + rect.w - thick, rect.y, thick, rect.h);
  ctx.restore();
}

function drawShapeLayer(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  layer: Extract<TemplateLayer, { type: "shape" }>,
  frontShortPx: number,
): void {
  const d = layer.defaults;
  // Same mm-to-px formula as line/Shape view.
  const sw = Math.max(1, (d.strokeMm * 0.5 / 100) * frontShortPx);
  ctx.save();
  ctx.strokeStyle = d.color;
  ctx.fillStyle = d.color;
  ctx.lineWidth = sw;
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";

  if (d.kind === "line-horizontal") {
    ctx.fillRect(rect.x, rect.y, rect.w, sw);
  } else if (d.kind === "line-vertical") {
    ctx.fillRect(rect.x, rect.y, sw, rect.h);
  } else if (d.kind === "frame-rect") {
    ctx.strokeRect(rect.x + sw / 2, rect.y + sw / 2, rect.w - sw, rect.h - sw);
  } else if (d.kind === "frame-oval") {
    ctx.beginPath();
    ctx.ellipse(
      rect.x + rect.w / 2, rect.y + rect.h / 2,
      Math.max(0, (rect.w - sw) / 2), Math.max(0, (rect.h - sw) / 2),
      0, 0, Math.PI * 2,
    );
    ctx.stroke();
  } else if (d.kind === "frame-rounded") {
    const r = ((d.cornerRadiusPct ?? 5) / 100) * Math.min(rect.w, rect.h);
    const x = rect.x + sw / 2;
    const y = rect.y + sw / 2;
    const w = rect.w - sw;
    const h = rect.h - sw;
    ctx.beginPath();
    if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect === "function") {
      (ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void })
        .roundRect(x, y, w, h, r);
    } else {
      // Manual fallback
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
    }
    ctx.stroke();
  } else if (d.kind === "frame-double") {
    const gap = Math.max(1, ((d.gapMm ?? 4) * 0.5 / 100) * frontShortPx);
    ctx.strokeRect(rect.x + sw / 2, rect.y + sw / 2, rect.w - sw, rect.h - sw);
    const inset = sw + gap + sw / 2;
    const innerW = Math.max(0, rect.w - inset * 2);
    const innerH = Math.max(0, rect.h - inset * 2);
    if (innerW > 0 && innerH > 0) ctx.strokeRect(rect.x + inset, rect.y + inset, innerW, innerH);
  } else if (d.kind === "frame-corners") {
    const len = Math.min(rect.w, rect.h) * 0.15;
    const o = sw / 2;
    const x1 = rect.x + o, y1 = rect.y + o;
    const x2 = rect.x + rect.w - o, y2 = rect.y + rect.h - o;
    ctx.beginPath();
    // TL
    ctx.moveTo(x1, y1); ctx.lineTo(x1 + len, y1);
    ctx.moveTo(x1, y1); ctx.lineTo(x1, y1 + len);
    // TR
    ctx.moveTo(x2, y1); ctx.lineTo(x2 - len, y1);
    ctx.moveTo(x2, y1); ctx.lineTo(x2, y1 + len);
    // BL
    ctx.moveTo(x1, y2); ctx.lineTo(x1 + len, y2);
    ctx.moveTo(x1, y2); ctx.lineTo(x1, y2 - len);
    // BR
    ctx.moveTo(x2, y2); ctx.lineTo(x2 - len, y2);
    ctx.moveTo(x2, y2); ctx.lineTo(x2, y2 - len);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Render the full template (all layers, in zIndex order) to a PNG/JPEG dataURL.
 * Map layers are rendered sequentially to avoid WebGL context exhaustion.
 */
export async function renderTemplateSnapshot(input: TemplateSnapshotInput): Promise<string> {
  const token = await getMapboxToken();
  if (!token) throw new Error("Mapbox token missing");
  mapboxgl.accessToken = token;

  const { wCm: frontWcm, hCm: frontHcm } = parseSize(input.size, input.orientation);
  const wrapCm = Math.max(0, input.wrapCm ?? 0);
  const bleedCm = Math.max(0, input.bleedCm ?? 0);
  const extraCm = wrapCm + bleedCm;
  const wCm = frontWcm + 2 * extraCm;
  const hCm = frontHcm + 2 * extraCm;

  const PX_PER_CM = input.hires ? 48 : 24;
  const MAX_PX = input.maxPxOverride ?? (input.hires ? pickHiresMaxPx() : 1800);
  const longestPx = Math.max(wCm, hCm) * PX_PER_CM;
  const scale = longestPx > MAX_PX ? MAX_PX / longestPx : 1;
  const w = Math.round(wCm * PX_PER_CM * scale);
  const h = Math.round(hCm * PX_PER_CM * scale);
  const pxPerMm = (PX_PER_CM * scale) / 10;

  // Front-zone rect (where layer % coords live)
  const frontPxX = Math.round(extraCm * PX_PER_CM * scale);
  const frontPxY = Math.round(extraCm * PX_PER_CM * scale);
  const frontPxW = Math.round(frontWcm * PX_PER_CM * scale);
  const frontPxH = Math.round(frontHcm * PX_PER_CM * scale);

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D ctx unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Background — full extended area (wrap inherits bg)
  ctx.fillStyle = input.livePosterBgColor || "#ffffff";
  ctx.fillRect(0, 0, w, h);

  // Sort layers by zIndex
  const layout = input.template.defaultLayout[input.orientation];
  const allLayers = [...layout.layers].sort((a, b) => a.zIndex - b.zIndex);
  const marginEnabled = input.whiteMarginEnabled !== false;
  const marginInsets = getActiveMarginInsetsPct(allLayers, frontWcm, frontHcm);
  const marginRemovedInsets = !marginEnabled ? marginInsets : null;
  const layers = marginEnabled ? allLayers : allLayers.filter((l) => l.type !== "margin");

  // First map / text layer — used when no `layerValues` is provided so legacy
  // callers (cart pipeline) still produce the same output.
  const liveMapId = layers.find((l) => l.type === "map")?.id ?? null;
  const liveTextId = layers.find((l) => l.type === "text")?.id ?? null;

  for (const layer of layers) {
    const t = input.layerTransforms?.[layer.id];
    const baseRect = {
      xPct: t?.xPct ?? layer.xPct,
      yPct: t?.yPct ?? layer.yPct,
      wPct: t?.wPct ?? layer.wPct,
      hPct: t?.hPct ?? layer.hPct,
    };
    const eff = marginRemovedInsets && layer.type !== "margin"
      ? expandRectForRemovedMargin(baseRect, marginRemovedInsets)
      : baseRect;
    const rect = {
      x: frontPxX + (eff.xPct / 100) * frontPxW,
      y: frontPxY + (eff.yPct / 100) * frontPxH,
      w: (eff.wPct / 100) * frontPxW,
      h: (eff.hPct / 100) * frontPxH,
    };

    if (layer.type === "map") {
      const lv = input.layerValues?.[layer.id];
      const mv = lv && lv.kind === "map" ? lv : null;
      const isLive = layer.id === liveMapId;
      const center: [number, number] = mv
        ? mv.center
        : isLive
        ? input.liveMapCenter
        : [layer.defaults.center[0]!, layer.defaults.center[1]!];
      const zoom = mv ? mv.zoom : isLive ? input.liveMapZoom : layer.defaults.zoom;
      const styleId = mv ? mv.styleId : isLive ? input.liveMapStyleId : layer.defaults.styleId;
      const showLabels = mv ? mv.showLabels : isLive ? input.liveShowLabels : layer.defaults.showLabels;
      const shape = mv ? mv.shape : isLive ? input.liveMapShape : layer.defaults.shape;
      await drawMapLayer(ctx, rect, { center, zoom, styleId, showLabels, shape });
    } else if (layer.type === "text") {
      const lv = input.layerValues?.[layer.id];
      const tv = lv && lv.kind === "text" ? lv : null;
      const isLive = layer.id === liveTextId;
      const visible = tv ? tv.visible : isLive ? input.liveTextVisible : true;
      if (!visible) continue;
      const text = tv ? tv.text : isLive ? input.liveText : layer.defaults.text;
      const font = tv ? tv.font : isLive ? input.liveTextFont : layer.defaults.font;
      drawTextLayer(ctx, rect, layer, text, font);
    } else if (layer.type === "image") {
      try {
        await drawImageLayer(ctx, rect, layer);
      } catch (e) {
        console.warn("[template-snapshot] image layer failed", e);
      }
    } else if (layer.type === "photo") {
      const url = input.photoOverlayUrl ?? layer.defaults.placeholderUrl;
      if (url) {
        const lv = input.layerValues?.[layer.id];
        const pv = lv && lv.kind === "photo" ? lv : null;
        const shape = pv?.shape ?? layer.defaults.shape;
        const offsetX = pv?.offsetX ?? 0;
        const offsetY = pv?.offsetY ?? 0;
        try {
          await drawPhotoLayer(ctx, rect, url, shape, layer.defaults.fit, offsetX, offsetY);
        } catch (e) {
          console.warn("[template-snapshot] photo layer failed", e);
        }
      }
    } else if (layer.type === "aiPhoto") {
      const url = input.aiPhotoResults?.[layer.id] ?? layer.defaults.referenceImageUrl;
      if (url) {
        const lv = input.layerValues?.[layer.id];
        const av = lv && lv.kind === "aiPhoto" ? lv : null;
        const shape = (av?.shape ?? layer.defaults.shape) as "rect" | "circle" | "heart" | "star";
        const offsetX = av?.offsetX ?? 0;
        const offsetY = av?.offsetY ?? 0;
        try {
          await drawPhotoLayer(ctx, rect, url, shape, layer.defaults.fit, offsetX, offsetY);
        } catch (e) {
          console.warn("[template-snapshot] aiPhoto layer failed", e);
        }
      }
    } else if (layer.type === "line") {
      drawLineLayer(ctx, rect, layer, pxPerMm, Math.min(frontPxW, frontPxH));
    } else if (layer.type === "shape") {
      drawShapeLayer(ctx, rect, layer, Math.min(frontPxW, frontPxH));
    } else if (layer.type === "margin") {
      // Margin frames the FRONT zone only — never the wrap/bleed band. This
      // matches the editor's dashed "Synlig framsida" rectangle and keeps the
      // 3D canvas wrap symmetric (motif extends out into the wrap unchanged).
      const frontRect = { x: frontPxX, y: frontPxY, w: frontPxW, h: frontPxH };
      const shortPx = Math.min(frontPxW, frontPxH);
      drawMarginLayer(ctx, frontRect, layer, pxPerMm, shortPx);
    }
  }

  // Frame / canvas-wrap overlay (preview/cart only — never on hires print).
  const hasFrame = !!input.frameColor && input.frameColor.trim() !== "";
  if (!input.hires && extraCm === 0 && hasFrame && (input.frameWidthCm ?? 0) > 0) {
    const fw = Math.max(1, Math.round((input.frameWidthCm ?? 1.2) * PX_PER_CM * scale));
    ctx.save();
    ctx.fillStyle = input.frameColor!;
    ctx.fillRect(0, 0, w, fw);
    ctx.fillRect(0, h - fw, w, fw);
    ctx.fillRect(0, 0, fw, h);
    ctx.fillRect(w - fw, 0, fw, h);
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = Math.max(1, Math.round(fw * 0.06));
    ctx.strokeRect(fw, fw, w - 2 * fw, h - 2 * fw);
    ctx.restore();
  } else if (!input.hires && input.canvasWrap && extraCm === 0) {
    const edge = Math.max(2, Math.round(0.25 * PX_PER_CM * scale));
    ctx.save();
    const grad = (x0: number, y0: number, x1: number, y1: number) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, "rgba(0,0,0,0.22)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      return g;
    };
    ctx.fillStyle = grad(0, 0, 0, edge);
    ctx.fillRect(0, 0, w, edge);
    ctx.fillStyle = grad(0, h, 0, h - edge);
    ctx.fillRect(0, h - edge, w, edge);
    ctx.fillStyle = grad(0, 0, edge, 0);
    ctx.fillRect(0, 0, edge, h);
    ctx.fillStyle = grad(w, 0, w - edge, 0);
    ctx.fillRect(w - edge, 0, edge, h);
    ctx.restore();
  }

  const dataUrl = out.toDataURL("image/jpeg", 0.95);
  if (!dataUrl || dataUrl.length < 1000) {
    throw new Error("Empty template snapshot");
  }
  return dataUrl;
}

/**
 * Hires snapshot with one retry at 70 % size if the first attempt fails
 * (typically WebGL context loss on weaker GPUs / very large posters).
 */
export async function renderHiresTemplateSnapshotSafe(
  input: TemplateSnapshotInput,
): Promise<TemplateSnapshotResult> {
  const t0 = performance.now();
  let lastErr: unknown = null;
  const initialMax = pickHiresMaxPx();
  const attempts = [initialMax, Math.round(initialMax * 0.7)];
  for (const maxPx of attempts) {
    try {
      const dataUrl = await renderTemplateSnapshot({
        ...input,
        hires: true,
        maxPxOverride: maxPx,
        // Never bake frame/wrap into print files.
        frameColor: undefined,
        frameWidthCm: undefined,
        canvasWrap: false,
      });
      const base64 = dataUrl.split(",")[1] ?? "";
      const sizeBytes = Math.round((base64.length * 3) / 4);
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.width, h: img.height });
        img.onerror = () => reject(new Error("dim probe failed"));
        img.src = dataUrl;
      });
      const ms = Math.round(performance.now() - t0);
      console.info(
        `[print-pipeline] template snapshot ok: ${dims.w}×${dims.h}px, ${(sizeBytes / 1024 / 1024).toFixed(2)}MB, ${ms}ms (maxPx=${maxPx})`,
      );
      return { dataUrl, widthPx: dims.w, heightPx: dims.h, sizeBytes };
    } catch (e) {
      console.warn(`[print-pipeline] template snapshot failed at maxPx=${maxPx}, retrying…`, e);
      lastErr = e;
    }
  }
  throw new Error(
    `Hi-res template snapshot failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}
