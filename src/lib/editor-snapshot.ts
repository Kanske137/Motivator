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
  /** Canvas wrap depth in cm. When > 0, output texture is extended with wrap+bleed
   *  zones around the visible front, so 3D preview can sample wrap-around faces
   *  exactly like Gelato's print file. */
  wrapCm?: number;
  /** Bleed in cm added outside the wrap zone (Gelato canvas = 0.3 cm). */
  bleedCm?: number;
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

function createOffscreenContainer(w: number, h: number): HTMLDivElement {
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

/**
 * Renders the artwork offscreen using Mapbox GL JS (same engine as the editor),
 * waits until tiles are loaded + style is idle, captures the WebGL canvas,
 * then composites bg + shape clip + text on a 2D canvas.
 */
export async function renderArtworkSnapshot(input: SnapshotInput): Promise<string> {
  const token = await getMapboxToken();
  if (!token) throw new Error("Mapbox token missing");
  mapboxgl.accessToken = token;

  const { wCm: frontWcm, hCm: frontHcm } = parseSize(input.size, input.orientation);
  const wrapCm = Math.max(0, input.wrapCm ?? 0);
  const bleedCm = Math.max(0, input.bleedCm ?? 0);
  const extraCm = wrapCm + bleedCm; // per side
  const wCm = frontWcm + 2 * extraCm;
  const hCm = frontHcm + 2 * extraCm;

  // Render at ~24px/cm baseline. Scale UNIFORMLY so longest side <= MAX_PX,
  // preserving aspect ratio.
  const PX_PER_CM = 24;
  const MAX_PX = 1800;
  const longestPx = Math.max(wCm, hCm) * PX_PER_CM;
  const scale = longestPx > MAX_PX ? MAX_PX / longestPx : 1;
  const w = Math.round(wCm * PX_PER_CM * scale);
  const h = Math.round(hCm * PX_PER_CM * scale);
  // Pixel offsets of the inner FRONT zone (where motif clip + text live)
  const frontPxX = Math.round(extraCm * PX_PER_CM * scale);
  const frontPxY = Math.round(extraCm * PX_PER_CM * scale);
  const frontPxW = Math.round(frontWcm * PX_PER_CM * scale);
  const frontPxH = Math.round(frontHcm * PX_PER_CM * scale);

  // Map renders in shape-aware container. With wrap, the map ALWAYS covers the
  // full extended canvas as a rect (wrap continues the map outside the front).
  const useShapeClip = extraCm === 0 && input.mapShape !== "rect";
  const sq = Math.min(frontPxW, frontPxH);
  const mapW = useShapeClip ? Math.min(w, h) : w;
  const mapH = useShapeClip ? Math.min(w, h) : h;

  const container = createOffscreenContainer(Math.max(w, mapW), Math.max(h, mapH));
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
      // Wait two idle cycles for label changes + tile redraw to settle
      for (let i = 0; i < 2; i++) {
        await new Promise<void>((resolve) => {
          const t = window.setTimeout(() => resolve(), 1500);
          map!.once("idle", () => {
            window.clearTimeout(t);
            resolve();
          });
        });
      }
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

    // Background fills the entire extended print area (wrap+bleed inherit bg)
    ctx.fillStyle = input.posterBgColor || "#ffffff";
    ctx.fillRect(0, 0, w, h);

    if (extraCm > 0) {
      // WRAP MODE (canvas): map fills entire extended area for wrap continuity.
      ctx.drawImage(mapCanvas, 0, 0, w, h);

      // If front uses non-rect shape, repaint front zone with bg then re-draw
      // the map only within the shape clip — so the visible front matches editor.
      if (input.mapShape !== "rect") {
        ctx.save();
        ctx.fillStyle = input.posterBgColor || "#ffffff";
        ctx.fillRect(frontPxX, frontPxY, frontPxW, frontPxH);
        const fsq = Math.min(frontPxW, frontPxH);
        const fcx = frontPxX + frontPxW / 2;
        const fcy = frontPxY + frontPxH / 2;
        ctx.beginPath();
        if (input.mapShape === "circle") {
          ctx.arc(fcx, fcy, fsq / 2, 0, Math.PI * 2);
        } else {
          ctx.rect(fcx - fsq / 2, fcy - fsq / 2, fsq, fsq);
        }
        ctx.clip();
        // Draw map aligned to full extended area (same as wrap) so the visible
        // shape contains the same pixels as the wrap continuation around it.
        ctx.drawImage(mapCanvas, 0, 0, w, h);
        ctx.restore();
      }
    } else {
      // POSTER MODE (no wrap): existing shape-aware clipping
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
    }

    // Text overlay — always positioned within the FRONT zone so the visible
    // front matches the editor exactly (wrap mode just offsets the front).
    if (input.textVisible && input.text.trim()) {
      const lines = input.text.split("\n");
      const layer = input.layout?.layers?.find((l) => l.type === "text");
      const tx = frontPxX + frontPxW * parsePct(layer?.x, 0.5);
      const yFrac = parsePct(layer?.y, 0.86);

      // Match editor: ~2.8% of FRONT width
      const fontSize = Math.round(frontPxW * 0.028);
      const lineHeight = Math.round(fontSize * 1.15);
      const totalH = lineHeight * lines.length;
      const centerY = frontPxY + frontPxH * yFrac;
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
    if (container.parentNode) container.parentNode.removeChild(container);
  }
}
