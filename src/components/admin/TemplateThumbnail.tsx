// Tiny non-interactive preview of a template's portrait default layout.
// Renders inside admin config cards. Reuses MapLayerPreview / TextLayerPreview
// so the visual matches the editable canvas.
import { useMemo } from "react";
import type { Template } from "@/lib/template-schema";
import MapLayerPreview from "./MapLayerPreview";
import TextLayerPreview from "./TextLayerPreview";
import { ShapeLayerView } from "@/components/editor/layers/ShapeLayerView";

interface Props {
  template: Template | null;
  width?: number;
  height?: number;
  /** "poster" | "canvas" — when "canvas" and the template has a canvasLayout,
   *  render the wrap-extended layout and overlay a dashed front-zone marker. */
  productType?: string | null;
}

export default function TemplateThumbnail({ template, width = 120, height = 160, productType }: Props) {
  const isCanvas = productType === "canvas";
  const useCanvasLayout = isCanvas && !!template?.canvasLayout;
  const layoutBlock = useCanvasLayout ? template?.canvasLayout : template?.defaultLayout;
  const layout = layoutBlock?.portrait ?? null;
  const layers = useMemo(
    () => (layout ? [...layout.layers].sort((a, b) => a.zIndex - b.zIndex) : []),
    [layout],
  );

  // For canvas with canvasLayout: layer % cover the FULL surface (front + 2× wrap).
  // Compute the front-zone rect inside the thumbnail so we can draw a dashed marker.
  const designDepthCm = template?.productOptions?.canvas?.canvasDesignDepthCm ?? 2;
  const frontInsetPct = useCanvasLayout
    ? // assume design surface = front + 2× depth at admin's design size; we
      // approximate the inset proportionally (depth / (front+2*depth)).
      // Front fraction is unknown without size, so use a stable visual: 2cm wrap
      // on a 30cm side ≈ 2/(30+4) ≈ 6%. Use designDepth as scaling hint.
      Math.min(20, Math.max(4, (designDepthCm / (designDepthCm * 2 + 30)) * 100))
    : 0;

  if (!layout) {
    return (
      <div
        className="rounded border border-dashed bg-muted flex items-center justify-center text-[10px] text-muted-foreground"
        style={{ width, height }}
      >
        Tom
      </div>
    );
  }

  return (
    <div
      className="relative rounded border overflow-hidden shadow-sm shrink-0"
      style={{ width, height, background: layout.background.color }}
    >
      {layers.map((layer) => {
        const style: React.CSSProperties = {
          position: "absolute",
          left: `${layer.xPct}%`,
          top: `${layer.yPct}%`,
          width: `${layer.wPct}%`,
          height: `${layer.hPct}%`,
          zIndex: layer.zIndex,
        };
        const w = (layer.wPct / 100) * width;
        const h = (layer.hPct / 100) * height;
        if (layer.type === "map") {
          return (
            <div key={layer.id} style={style}>
              <MapLayerPreview defaults={layer.defaults} width={w} height={h} />
            </div>
          );
        }
        if (layer.type === "text") {
          return (
            <div key={layer.id} style={style}>
              <TextLayerPreview defaults={layer.defaults} height={h} />
            </div>
          );
        }
        if (layer.type === "line") {
          return (
            <div
              key={layer.id}
              style={{ ...style, background: layer.defaults.color }}
            />
          );
        }
        if (layer.type === "margin") {
          // Thumbnail is a tiny preview — render border thickness as % of width.
          const pct = layer.defaults.thicknessPct;
          return (
            <div
              key={layer.id}
              style={{
                ...style,
                border: `${Math.max(1, pct / 4)}px solid ${layer.defaults.color}`,
                background: "transparent",
              }}
            />
          );
        }
        if (layer.type === "shape") {
          return (
            <div key={layer.id} style={style}>
              <ShapeLayerView layer={layer} canvasShortPx={Math.min(width, height)} />
            </div>
          );
        }
        if (layer.type === "image") {
          return (
            <div key={layer.id} style={style}>
              {layer.defaults.url ? (
                <img
                  src={layer.defaults.url}
                  alt=""
                  className="w-full h-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full bg-muted/40" />
              )}
            </div>
          );
        }
        if (layer.type === "photo") {
          const clipPath =
            layer.defaults.shape === "circle" ? "circle(50% at 50% 50%)" : undefined;
          const src = layer.defaults.placeholderUrl;
          return (
            <div key={layer.id} style={{ ...style, overflow: "hidden", clipPath }}>
              {src ? (
                <img
                  src={src}
                  alt=""
                  className={`w-full h-full ${
                    layer.defaults.fit === "contain" ? "object-contain" : "object-cover"
                  }`}
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full bg-muted/40 border border-dashed border-foreground/20" />
              )}
            </div>
          );
        }
        if (layer.type === "aiPhoto") {
          const clipPath =
            layer.defaults.shape === "circle" ? "circle(50% at 50% 50%)" : undefined;
          const src = layer.defaults.referenceImageUrl;
          return (
            <div key={layer.id} style={{ ...style, overflow: "hidden", clipPath }}>
              {src ? (
                <img
                  src={src}
                  alt=""
                  className={`w-full h-full ${
                    layer.defaults.fit === "contain" ? "object-contain" : "object-cover"
                  }`}
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full bg-accent/40 border border-dashed border-primary/30" />
              )}
            </div>
          );
        }
        return null;
      })}
      {useCanvasLayout && (
        <div
          className="absolute pointer-events-none border border-dashed border-primary/70"
          style={{
            left: `${frontInsetPct}%`,
            top: `${frontInsetPct}%`,
            right: `${frontInsetPct}%`,
            bottom: `${frontInsetPct}%`,
          }}
          aria-hidden
        />
      )}
    </div>
  );
}
