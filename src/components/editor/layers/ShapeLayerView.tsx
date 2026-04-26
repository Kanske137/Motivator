// Pure presentational renderer for `shape` layers (admin-only decorations).
// Uses an inline SVG sized to the layer rect and stroked in true pixels
// (computed from canvas short side + mm) so editor + customer preview match
// the print pipeline 1:1.
import type { TemplateLayer } from "@/lib/template-schema";

type ShapeLayer = Extract<TemplateLayer, { type: "shape" }>;

interface Props {
  layer: ShapeLayer;
  /** Canvas short side in CSS pixels. Used to convert mm → px. */
  canvasShortPx: number;
}

const MM_TO_SHORT_SIDE_PCT = 0.5; // matches LINE_THICKNESS_MM_TO_SHORT_SIDE_PCT

export function mmToPx(mm: number, canvasShortPx: number): number {
  return Math.max(1, (mm * MM_TO_SHORT_SIDE_PCT / 100) * canvasShortPx);
}

export function ShapeLayerView({ layer, canvasShortPx }: Props) {
  const d = layer.defaults;
  const sw = mmToPx(d.strokeMm, canvasShortPx);
  // We render via SVG with viewBox = layer pixel rect, stroked in px.
  // Width/height come from the parent (Rnd / wrapStyle 100%/100%).
  const common = { stroke: d.color, strokeWidth: sw, fill: "none" } as const;

  if (d.kind === "line-horizontal" || d.kind === "line-vertical") {
    // Render line flush against ONE edge (top / left), like LineLayerView.
    const style: React.CSSProperties =
      d.kind === "line-horizontal"
        ? { position: "absolute", left: 0, right: 0, top: 0, height: sw, background: d.color, borderRadius: 0 }
        : { position: "absolute", top: 0, bottom: 0, left: 0, width: sw, background: d.color, borderRadius: 0 };
    return <div className="absolute inset-0 pointer-events-none"><div style={style} /></div>;
  }

  return (
    <svg
      className="absolute inset-0 w-full h-full overflow-visible pointer-events-none"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      {d.kind === "frame-rect" && (
        <rect
          x={sw / 2} y={sw / 2}
          width={`calc(100% - ${sw}px)`} height={`calc(100% - ${sw}px)`}
          {...common}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {d.kind === "frame-oval" && (
        <ellipse
          cx="50%" cy="50%"
          rx={`calc(50% - ${sw / 2}px)`} ry={`calc(50% - ${sw / 2}px)`}
          {...common}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {d.kind === "frame-rounded" && (
        <rect
          x={sw / 2} y={sw / 2}
          width={`calc(100% - ${sw}px)`} height={`calc(100% - ${sw}px)`}
          rx={`${d.cornerRadiusPct ?? 5}%`} ry={`${d.cornerRadiusPct ?? 5}%`}
          {...common}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {d.kind === "frame-double" && (() => {
        const gap = mmToPx(d.gapMm ?? 4, canvasShortPx);
        const inset = sw + gap + sw / 2;
        return (
          <>
            <rect
              x={sw / 2} y={sw / 2}
              width={`calc(100% - ${sw}px)`} height={`calc(100% - ${sw}px)`}
              {...common} vectorEffect="non-scaling-stroke"
            />
            <rect
              x={inset} y={inset}
              width={`calc(100% - ${inset * 2}px)`} height={`calc(100% - ${inset * 2}px)`}
              {...common} vectorEffect="non-scaling-stroke"
            />
          </>
        );
      })()}
      {d.kind === "frame-corners" && (() => {
        // Decorative bracket corners — short L-strokes at each corner.
        // Length = 12% of shape's short edge proxy (we don't know exact px
        // here so use viewBox %). Looks consistent across rectangular shapes.
        const len = "12";
        const o = sw / 2; // offset
        const W = `calc(100% - ${o}px)`;
        const H = `calc(100% - ${o}px)`;
        // Use 4 polylines via SVG with absolute coords using % via foreignObject would be heavy; use 8 lines.
        return (
          <g {...common} strokeLinecap="square" vectorEffect="non-scaling-stroke">
            {/* TL */}
            <line x1={o} y1={o} x2={`${len}%`} y2={o} />
            <line x1={o} y1={o} x2={o} y2={`${len}%`} />
            {/* TR */}
            <line x1={W} y1={o} x2={`calc(100% - ${len}%)`} y2={o} />
            <line x1={W} y1={o} x2={W} y2={`${len}%`} />
            {/* BL */}
            <line x1={o} y1={H} x2={`${len}%`} y2={H} />
            <line x1={o} y1={H} x2={o} y2={`calc(100% - ${len}%)`} />
            {/* BR */}
            <line x1={W} y1={H} x2={`calc(100% - ${len}%)`} y2={H} />
            <line x1={W} y1={H} x2={W} y2={`calc(100% - ${len}%)`} />
          </g>
        );
      })()}
    </svg>
  );
}
