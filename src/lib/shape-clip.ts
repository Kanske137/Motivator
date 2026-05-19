/**
 * Shared shape clipping utilities for circle/heart/star.
 *
 * Heart and star are designed in a 0..1 unit-square coordinate system.
 * They render at their natural 1:1 aspect ratio inscribed inside the
 * SHORTEST side of the host rect (same principle as the inscribed circle).
 *
 * - `buildShapeClipPath(shape, w, h)` returns a CSS `clip-path` string in
 *   pixel coordinates centered on the host element.
 * - `useShapeClip(shape)` is a ResizeObserver-backed hook that produces the
 *   clip-path string reactively.
 * - `drawShapeOnCanvas(ctx, shape, x, y, w, h)` draws the same shape on a
 *   Canvas2D context (used by the print-snapshot pipeline) so the rendered
 *   PNG matches the editor pixel-for-pixel.
 */
import { useEffect, useRef, useState } from "react";

export type ClipShape = "rect" | "circle" | "heart" | "star";

// ---------- Heart ----------
// Soft, puffy heart filling 0..1 box.
const HEART_PATH: Array<{ type: "M" | "C"; pts: number[] }> = [
  { type: "M", pts: [0.5, 0.95] },
  { type: "C", pts: [0.45, 0.88, 0.0, 0.65, 0.0, 0.32] },
  { type: "C", pts: [0.0, 0.1, 0.18, 0.0, 0.32, 0.0] },
  { type: "C", pts: [0.42, 0.0, 0.48, 0.08, 0.5, 0.22] },
  { type: "C", pts: [0.52, 0.08, 0.58, 0.0, 0.68, 0.0] },
  { type: "C", pts: [0.82, 0.0, 1.0, 0.1, 1.0, 0.32] },
  { type: "C", pts: [1.0, 0.65, 0.55, 0.88, 0.5, 0.95] },
];

// ---------- Star ----------
// 5-pointed star with strongly rounded tips/valleys via quadratic curves.
// Coordinates are pre-normalised so the *rendered* curve bounding-box spans
// the full 0..1 box (control points may fall slightly outside, that's fine —
// quadratic curves never reach their control point). This makes the star
// take up the same visual area as the circle and heart shapes.
const STAR_CORNERS: Array<{ entry: [number, number]; cp: [number, number]; exit: [number, number] }> = [
  { entry: [0.434, 0.121], cp: [0.5, -0.071],  exit: [0.566, 0.121] },
  { entry: [0.58, 0.164],  cp: [0.646, 0.356], exit: [0.845, 0.356] },
  { entry: [0.89, 0.356],  cp: [1.089, 0.356], exit: [0.929, 0.476] },
  { entry: [0.894, 0.502], cp: [0.735, 0.622], exit: [0.793, 0.814] },
  { entry: [0.805, 0.857], cp: [0.864, 1.048], exit: [0.7, 0.929] },
  { entry: [0.663, 0.903], cp: [0.5, 0.783],   exit: [0.337, 0.903] },
  { entry: [0.3, 0.929],   cp: [0.137, 1.048], exit: [0.195, 0.857] },
  { entry: [0.207, 0.814], cp: [0.265, 0.622], exit: [0.106, 0.502] },
  { entry: [0.071, 0.476], cp: [-0.089, 0.356],exit: [0.111, 0.356] },
  { entry: [0.155, 0.356], cp: [0.354, 0.356], exit: [0.42, 0.164] },
];

function fmt(n: number): string {
  // Trim trailing zeros, keep up to 3 decimals.
  return Number(n.toFixed(3)).toString();
}

/** Build SVG path data for heart, sized to a `s × s` box at offset (ox, oy). */
function heartSvgPath(ox: number, oy: number, s: number): string {
  const sx = (v: number) => fmt(ox + v * s);
  const sy = (v: number) => fmt(oy + v * s);
  let d = "";
  for (const seg of HEART_PATH) {
    if (seg.type === "M") d += `M${sx(seg.pts[0])},${sy(seg.pts[1])} `;
    else {
      d += `C${sx(seg.pts[0])},${sy(seg.pts[1])} ${sx(seg.pts[2])},${sy(seg.pts[3])} ${sx(seg.pts[4])},${sy(seg.pts[5])} `;
    }
  }
  return d + "Z";
}

/** Build SVG path data for star, sized to a `s × s` box at offset (ox, oy). */
function starSvgPath(ox: number, oy: number, s: number): string {
  const sx = (v: number) => fmt(ox + v * s);
  const sy = (v: number) => fmt(oy + v * s);
  const c0 = STAR_CORNERS[0];
  let d = `M${sx(c0.entry[0])},${sy(c0.entry[1])} `;
  for (let i = 0; i < STAR_CORNERS.length; i++) {
    const c = STAR_CORNERS[i];
    d += `Q${sx(c.cp[0])},${sy(c.cp[1])} ${sx(c.exit[0])},${sy(c.exit[1])} `;
    const next = STAR_CORNERS[(i + 1) % STAR_CORNERS.length];
    d += `L${sx(next.entry[0])},${sy(next.entry[1])} `;
  }
  return d + "Z";
}

/**
 * Build a CSS clip-path string for the given shape, sized in pixels and
 * centered inside `widthPx × heightPx`. Heart/star are inscribed inside the
 * shortest side (`s = min(w, h)`) and centered, preserving their natural
 * 1:1 aspect ratio — same principle as the inscribed circle.
 *
 * Returns `undefined` for `rect` (no clipping) or when the host has no size.
 */
export function buildShapeClipPath(
  shape: ClipShape,
  widthPx: number,
  heightPx: number,
): string | undefined {
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx)) return undefined;
  if (widthPx <= 0 || heightPx <= 0) return undefined;
  if (shape === "rect") return undefined;

  if (shape === "circle") {
    const r = Math.min(widthPx, heightPx) / 2;
    return `circle(${fmt(r)}px at 50% 50%)`;
  }

  const s = Math.min(widthPx, heightPx);
  const ox = (widthPx - s) / 2;
  const oy = (heightPx - s) / 2;

  if (shape === "heart") return `path("${heartSvgPath(ox, oy, s)}")`;
  if (shape === "star") return `path("${starSvgPath(ox, oy, s)}")`;
  return undefined;
}

/**
 * Hook: measures the host element and produces a pixel-accurate CSS
 * `clip-path` for `shape`, centered in the host with natural 1:1 aspect.
 */
export function useShapeClip(shape: ClipShape): {
  ref: React.RefObject<HTMLDivElement>;
  clipPath: string | undefined;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [clipPath, setClipPath] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (shape === "rect") {
      setClipPath(undefined);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setClipPath(buildShapeClipPath(shape, r.width, r.height));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shape]);

  return { ref, clipPath };
}

/**
 * Add the shape's path to `ctx` (no fill/stroke) and call `ctx.clip()`.
 * Heart/star are centered in a `min(w,h) × min(w,h)` square — matches
 * `buildShapeClipPath` exactly so editor preview === print snapshot.
 */
export function drawShapeOnCanvas(
  ctx: CanvasRenderingContext2D,
  shape: ClipShape,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.beginPath();
  if (shape === "rect") {
    ctx.rect(x, y, w, h);
  } else if (shape === "circle") {
    const r = Math.min(w, h) / 2;
    ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
  } else if (shape === "heart" || shape === "star") {
    const s = Math.min(w, h);
    const ox = x + (w - s) / 2;
    const oy = y + (h - s) / 2;
    const sx = (v: number) => ox + v * s;
    const sy = (v: number) => oy + v * s;
    if (shape === "heart") {
      for (const seg of HEART_PATH) {
        if (seg.type === "M") ctx.moveTo(sx(seg.pts[0]), sy(seg.pts[1]));
        else
          ctx.bezierCurveTo(
            sx(seg.pts[0]), sy(seg.pts[1]),
            sx(seg.pts[2]), sy(seg.pts[3]),
            sx(seg.pts[4]), sy(seg.pts[5]),
          );
      }
    } else {
      const c0 = STAR_CORNERS[0];
      ctx.moveTo(sx(c0.entry[0]), sy(c0.entry[1]));
      for (let i = 0; i < STAR_CORNERS.length; i++) {
        const c = STAR_CORNERS[i];
        ctx.quadraticCurveTo(sx(c.cp[0]), sy(c.cp[1]), sx(c.exit[0]), sy(c.exit[1]));
        const next = STAR_CORNERS[(i + 1) % STAR_CORNERS.length];
        ctx.lineTo(sx(next.entry[0]), sy(next.entry[1]));
      }
    }
    ctx.closePath();
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.clip();
}
