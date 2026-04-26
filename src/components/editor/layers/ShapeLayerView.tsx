// Pure presentational renderer for `shape` layers (admin-only decorations).
// Measures its own pixel size and renders an inline SVG so strokes are sharp
// and identical between editor + customer preview + print snapshot.
import { useEffect, useRef, useState } from "react";
import type { TemplateLayer } from "@/lib/template-schema";

type ShapeLayer = Extract<TemplateLayer, { type: "shape" }>;

interface Props {
  layer: ShapeLayer;
  /** Canvas short side in CSS pixels (used to convert mm → px). */
  canvasShortPx: number;
}

const MM_TO_SHORT_SIDE_PCT = 0.5; // matches LINE_THICKNESS_MM_TO_SHORT_SIDE_PCT

export function mmToPx(mm: number, canvasShortPx: number): number {
  return Math.max(1, (mm * MM_TO_SHORT_SIDE_PCT / 100) * canvasShortPx);
}

export function ShapeLayerView({ layer, canvasShortPx }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const d = layer.defaults;
  const sw = mmToPx(d.strokeMm, canvasShortPx);
  const W = box.w;
  const H = box.h;

  return (
    <div ref={ref} className="absolute inset-0" style={{ pointerEvents: "none" }}>
      {(() => {
        if (d.kind === "line-horizontal") {
          return (
            <div
              style={{
                position: "absolute", left: 0, right: 0, top: 0,
                height: sw, background: d.color, borderRadius: 0,
                pointerEvents: "auto",
              }}
            />
          );
        }
        if (d.kind === "line-vertical") {
          return (
            <div
              style={{
                position: "absolute", top: 0, bottom: 0, left: 0,
                width: sw, background: d.color, borderRadius: 0,
                pointerEvents: "auto",
              }}
            />
          );
        }
        if (W === 0 || H === 0) return null;
        // For SVG frames: container <svg> stays pointer-events:none, but the
        // actual stroked shapes get pointer-events:stroke so only the visible
        // line catches clicks — the hollow middle falls through to layers
        // below (map/text/photo).
        const common = { stroke: d.color, strokeWidth: sw, fill: "none" } as const;
        const hit = { pointerEvents: "stroke" as const };

        if (d.kind === "frame-rect") {
          return (
            <svg width={W} height={H} className="absolute inset-0" style={{ pointerEvents: "none" }}>
              <rect x={sw / 2} y={sw / 2} width={W - sw} height={H - sw} {...common} style={hit} />
            </svg>
          );
        }
        if (d.kind === "frame-oval") {
          return (
            <svg width={W} height={H} className="absolute inset-0" style={{ pointerEvents: "none" }}>
              <ellipse cx={W / 2} cy={H / 2} rx={(W - sw) / 2} ry={(H - sw) / 2} {...common} style={hit} />
            </svg>
          );
        }
        if (d.kind === "frame-rounded") {
          const r = ((d.cornerRadiusPct ?? 5) / 100) * Math.min(W, H);
          return (
            <svg width={W} height={H} className="absolute inset-0" style={{ pointerEvents: "none" }}>
              <rect x={sw / 2} y={sw / 2} width={W - sw} height={H - sw} rx={r} ry={r} {...common} style={hit} />
            </svg>
          );
        }
        if (d.kind === "frame-double") {
          const gap = mmToPx(d.gapMm ?? 4, canvasShortPx);
          const inset = sw + gap + sw / 2;
          return (
            <svg width={W} height={H} className="absolute inset-0" style={{ pointerEvents: "none" }}>
              <rect x={sw / 2} y={sw / 2} width={W - sw} height={H - sw} {...common} style={hit} />
              <rect
                x={inset}
                y={inset}
                width={Math.max(0, W - inset * 2)}
                height={Math.max(0, H - inset * 2)}
                {...common}
                style={hit}
              />
            </svg>
          );
        }
        if (d.kind === "frame-corners") {
          const len = Math.min(W, H) * 0.15;
          const o = sw / 2;
          return (
            <svg width={W} height={H} className="absolute inset-0" style={{ pointerEvents: "none" }}>
              <g {...common} strokeLinecap="square" style={hit}>
                {/* TL */}
                <line x1={o} y1={o} x2={o + len} y2={o} />
                <line x1={o} y1={o} x2={o} y2={o + len} />
                {/* TR */}
                <line x1={W - o} y1={o} x2={W - o - len} y2={o} />
                <line x1={W - o} y1={o} x2={W - o} y2={o + len} />
                {/* BL */}
                <line x1={o} y1={H - o} x2={o + len} y2={H - o} />
                <line x1={o} y1={H - o} x2={o} y2={H - o - len} />
                {/* BR */}
                <line x1={W - o} y1={H - o} x2={W - o - len} y2={H - o} />
                <line x1={W - o} y1={H - o} x2={W - o} y2={H - o - len} />
              </g>
            </svg>
          );
        }
        return null;
      })()}
    </div>
  );
}
