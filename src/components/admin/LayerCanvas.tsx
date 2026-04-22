// Drag & drop canvas for the admin designer.
//
// Coordinates: every layer stores xPct/yPct/wPct/hPct in % of THIS canvas
// (which represents the FRONT zone of the print). react-rnd works in pixels,
// so we convert via the canvas' measured size on every drag/resize tick.
//
// Snap: 5% grid is always on. Alignment guides appear under drag when an edge
// or centre lines up with another layer / canvas centre / canvas edge.
import { useEffect, useMemo, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import type { Aspect, TemplateLayer } from "@/lib/template-schema";
import { clampLayerBounds, snapPct } from "@/lib/layer-utils";
import AlignmentGuides from "./AlignmentGuides";

const SNAP_PCT = 5;
const GUIDE_TOLERANCE_PCT = 1.5;

interface Props {
  aspect: Aspect;
  background: string;
  layers: TemplateLayer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (next: TemplateLayer) => void;
}

const aspectToRatio: Record<Aspect, string> = {
  "3:4": "3 / 4",
  "4:3": "4 / 3",
  "1:1": "1 / 1",
};

export default function LayerCanvas({
  aspect,
  background,
  layers,
  selectedId,
  onSelect,
  onChange,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });

  // Track the canvas pixel size so we can convert px<->%
  useEffect(() => {
    if (!wrapRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, []);

  const sortedLayers = useMemo(
    () => [...layers].sort((a, b) => a.zIndex - b.zIndex),
    [layers],
  );

  function pxToPct(px: number, axis: "x" | "y"): number {
    const total = axis === "x" ? size.w : size.h;
    return total === 0 ? 0 : (px / total) * 100;
  }

  /** Compute alignment guides for the layer currently being moved. */
  function computeGuides(moving: TemplateLayer): { v: number[]; h: number[] } {
    const v: number[] = [];
    const h: number[] = [];
    const movingCenters = {
      x: [moving.xPct, moving.xPct + moving.wPct / 2, moving.xPct + moving.wPct],
      y: [moving.yPct, moving.yPct + moving.hPct / 2, moving.yPct + moving.hPct],
    };

    // Canvas edges + centre
    const canvasX = [0, 50, 100];
    const canvasY = [0, 50, 100];
    canvasX.forEach((cx) => {
      if (movingCenters.x.some((mx) => Math.abs(mx - cx) <= GUIDE_TOLERANCE_PCT)) v.push(cx);
    });
    canvasY.forEach((cy) => {
      if (movingCenters.y.some((my) => Math.abs(my - cy) <= GUIDE_TOLERANCE_PCT)) h.push(cy);
    });

    // Other layers
    layers
      .filter((l) => l.id !== moving.id)
      .forEach((other) => {
        const xs = [other.xPct, other.xPct + other.wPct / 2, other.xPct + other.wPct];
        const ys = [other.yPct, other.yPct + other.hPct / 2, other.yPct + other.hPct];
        xs.forEach((x) => {
          if (movingCenters.x.some((mx) => Math.abs(mx - x) <= GUIDE_TOLERANCE_PCT)) v.push(x);
        });
        ys.forEach((y) => {
          if (movingCenters.y.some((my) => Math.abs(my - y) <= GUIDE_TOLERANCE_PCT)) h.push(y);
        });
      });

    return {
      v: Array.from(new Set(v.map((n) => Math.round(n * 10) / 10))),
      h: Array.from(new Set(h.map((n) => Math.round(n * 10) / 10))),
    };
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-md border shadow-sm"
        style={{ aspectRatio: aspectToRatio[aspect], background }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        {/* 5% grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)",
            backgroundSize: `${SNAP_PCT}% ${SNAP_PCT}%`,
          }}
        />

        {sortedLayers.map((layer) => {
          const isSelected = selectedId === layer.id;
          return (
            <Rnd
              key={layer.id}
              bounds="parent"
              size={{
                width: `${layer.wPct}%`,
                height: `${layer.hPct}%`,
              }}
              position={{
                x: (layer.xPct / 100) * size.w,
                y: (layer.yPct / 100) * size.h,
              }}
              onDragStart={() => onSelect(layer.id)}
              onDrag={(_e, d) => {
                const next = clampLayerBounds({
                  ...layer,
                  xPct: snapPct(pxToPct(d.x, "x")),
                  yPct: snapPct(pxToPct(d.y, "y")),
                });
                setGuides(computeGuides(next));
              }}
              onDragStop={(_e, d) => {
                const next = clampLayerBounds({
                  ...layer,
                  xPct: snapPct(pxToPct(d.x, "x")),
                  yPct: snapPct(pxToPct(d.y, "y")),
                });
                setGuides({ v: [], h: [] });
                onChange(next);
              }}
              onResizeStart={() => onSelect(layer.id)}
              onResize={(_e, _dir, ref, _delta, position) => {
                const next = clampLayerBounds({
                  ...layer,
                  wPct: snapPct(pxToPct(ref.offsetWidth, "x")),
                  hPct: snapPct(pxToPct(ref.offsetHeight, "y")),
                  xPct: snapPct(pxToPct(position.x, "x")),
                  yPct: snapPct(pxToPct(position.y, "y")),
                });
                setGuides(computeGuides(next));
              }}
              onResizeStop={(_e, _dir, ref, _delta, position) => {
                const next = clampLayerBounds({
                  ...layer,
                  wPct: snapPct(pxToPct(ref.offsetWidth, "x")),
                  hPct: snapPct(pxToPct(ref.offsetHeight, "y")),
                  xPct: snapPct(pxToPct(position.x, "x")),
                  yPct: snapPct(pxToPct(position.y, "y")),
                });
                setGuides({ v: [], h: [] });
                onChange(next);
              }}
              style={{ zIndex: layer.zIndex + 1 }}
              className={
                isSelected
                  ? "ring-2 ring-primary ring-offset-1"
                  : "ring-1 ring-border hover:ring-primary/50"
              }
            >
              <div
                className="w-full h-full bg-card/70 backdrop-blur-[1px] flex items-center justify-center text-xs text-muted-foreground select-none cursor-move"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(layer.id);
                }}
              >
                <span className="px-2 text-center truncate">
                  {layer.type === "map" && "🗺 "}
                  {layer.type === "text" && "T "}
                  {layer.type === "image" && "🖼 "}
                  {layer.type === "line" && "▬ "}
                  {layer.type === "margin" && "▢ "}
                  {layer.name}
                </span>
              </div>
            </Rnd>
          );
        })}

        <AlignmentGuides vertical={guides.v} horizontal={guides.h} />
      </div>
    </div>
  );
}
