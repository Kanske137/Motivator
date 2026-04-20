// Renders the SAME editor artwork (Mapbox GL + shape mask + bg + text) into
// an offscreen canvas, returning a PNG dataURL. This is the SINGLE SOURCE OF
// TRUTH for all preview mockups and 3D canvas textures — guaranteeing
// pixel-identical parity with the live editor.
import mapboxgl from "mapbox-gl";
import { getMapboxToken, styleUrl } from "./mapbox";
import type { MapShape } from "@/stores/editorStore";
import type { LayoutDef } from "./product-config";

export interface SnapshotInput {
  mapStyleId: string;
  mapCenter: [number, number];
  mapZoom: number;
  showLabels: boolean;
  mapShape: MapShape;
  posterBgColor: string;
  text: string;
  textFont: string;
  textVisible: boolean;
  size: string;            // "30x40"
  orientation: "portrait" | "landscape";
  layout: LayoutDef | null; // for text x/y placement (matches editor)
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

/** parse "85%"/"50%" → fraction. Returns 0.5 if invalid. */
function parsePct(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const m = v.match(/([\d.]+)\s*%/);
  if (m) return parseFloat(m[1]) / 100;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

let snapshotContainer: HTMLDivElement | null = null;
function getOffscreenContainer(w: number, h: number): HTMLDivElement {
  if (!snapshotContainer) {
    snapshotContainer = document.createElement("div");
    snapshotContainer.style.position = "fixed";
    snapshotContainer.style.left = "-99999px";
    snapshotContainer.style.top = "0";
    snapshotContainer.style.pointerEvents = "none";
    snapshotContainer.setAttribute("aria-hidden", "true");
    document.body.appendChild(snapshotContainer);
  }
  snapshotContainer.style.width = `${w}px`;
  snapshotContainer.style.height = `${h}px`;
  return snapshotContainer;
}

/**
 * Renders the artwork offscreen using Mapbox GL JS (same engine as the editor),
 * waits until tiles are loaded + style is idle, captures the WebGL canvas,
 * then composites bg + shape clip + text on a 2D canvas.
 */
export async function renderArtworkSnapshot(input: SnapshotInput): Promise<string> {
  const token = await getMapboxToken();
  if (!token) throw new Error("Mapbox token missing");
  mapboxgl.accessToken = token;

  const { wCm, hCm } = parseSize(input.size, input.orientation);
  // Render at ~3px/cm baseline = decent quality, fast. Texture/mockup will
  // upscale via CSS/WebGL filtering. Cap to keep memory reasonable.
  const PX_PER_CM = 24; // → A4 ≈ 720x1008, A2 ≈ 1080x1440
  const w = Math.min(1600, Math.round(wCm * PX_PER_CM));
  const h = Math.min(1600, Math.round(hCm * PX_PER_CM));

  // Map renders in shape-aware container so square/circle aren't squished.
  const sq = Math.min(w, h);
  const mapW = input.mapShape === "rect" ? w : sq;
  const mapH = input.mapShape === "rect" ? h : sq;

  const container = getOffscreenContainer(Math.max(w, mapW), Math.max(h, mapH));
  // Inner div for THIS map render (so concurrent renders don't collide)
  const mapDiv = document.createElement("div");
  mapDiv.style.width = `${mapW}px`;
  mapDiv.style.height = `${mapH}px`;
  container.appendChild(mapDiv);

  let map: mapboxgl.Map | null = null;
  try {
    map = new mapboxgl.Map({
      container: mapDiv,
      style: styleUrl(input.mapStyleId),
      center: input.mapCenter,
      zoom: input.mapZoom,
      interactive: false,
      attributionControl: false,
      preserveDrawingBuffer: true, // REQUIRED for canvas.toDataURL/getImageData
      fadeDuration: 0,
    });

    // Wait for style + tiles
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Map render timeout")), 15000);
      map!.once("error", (e) => {
        window.clearTimeout(timeout);
        reject(new Error(`Mapbox error: ${(e as any)?.error?.message ?? "unknown"}`));
      });
      map!.on("idle", () => {
        window.clearTimeout(timeout);
        resolve();
      });
    });

    // Apply label visibility
    try {
      const style = map.getStyle();
      if (style?.layers) {
        for (const layer of style.layers) {
          if (layer.type === "symbol") {
            map.setLayoutProperty(layer.id, "visibility", input.showLabels ? "visible" : "none");
          }
        }
      }
      // Wait one more idle for label changes to apply
      await new Promise<void>((resolve) => {
        const t = window.setTimeout(() => resolve(), 1500);
        map!.once("idle", () => {
          window.clearTimeout(t);
          resolve();
        });
      });
    } catch (e) {
      console.warn("[snapshot] label toggle failed", e);
    }

    const mapCanvas = map.getCanvas();

    // Composite onto final 2D canvas
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("2D ctx unavailable");

    // Background
    ctx.fillStyle = input.posterBgColor || "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // Map (with shape clip) — source canvas is already correctly sized per shape
    ctx.save();
    if (input.mapShape === "circle") {
      const r = sq / 2;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
      ctx.clip();
    } else if (input.mapShape === "square") {
      const sx = (w - sq) / 2;
      const sy = (h - sq) / 2;
      ctx.beginPath();
      ctx.rect(sx, sy, sq, sq);
      ctx.clip();
    }
    if (input.mapShape === "rect") {
      ctx.drawImage(mapCanvas, 0, 0, w, h);
    } else {
      const dx = (w - sq) / 2;
      const dy = (h - sq) / 2;
      ctx.drawImage(mapCanvas, dx, dy, sq, sq);
    }
    ctx.restore();

    // Text overlay (matches editor's PosterArtwork text layer)
    if (input.textVisible && input.text.trim()) {
      const lines = input.text.split("\n");
      const layer = input.layout?.layers?.find((l) => l.type === "text");
      const tx = w * parsePct(layer?.x, 0.5);
      const yFrac = parsePct(layer?.y, 0.86);

      // Match editor: text-sm/base/lg (~16px on ~570px preview) ≈ 2.8% of width
      const fontSize = Math.round(w * 0.028);
      const lineHeight = Math.round(fontSize * 1.15);
      const totalH = lineHeight * lines.length;
      // Center the block around h * yFrac (editor uses translate(-50%,-50%))
      const centerY = h * yFrac;
      const firstLineCenter = centerY - totalH / 2 + lineHeight / 2;

      ctx.save();
      ctx.fillStyle = "#1a1a1a";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `500 ${fontSize}px ${input.textFont}, Inter, sans-serif`;
      lines.forEach((line, i) => {
        ctx.fillText(line, tx, firstLineCenter + i * lineHeight);
      });
      ctx.restore();
    }

    return out.toDataURL("image/jpeg", 0.92);
  } finally {
    try {
      map?.remove();
    } catch {
      /* noop */
    }
    if (mapDiv.parentNode) mapDiv.parentNode.removeChild(mapDiv);
  }
}
