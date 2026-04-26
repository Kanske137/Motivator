// Tiny non-interactive preview of a template's portrait default layout.
// Renders inside admin config cards. Reuses MapLayerPreview / TextLayerPreview
// so the visual matches the editable canvas.
import { useMemo } from "react";
import type { Template } from "@/lib/template-schema";
import MapLayerPreview from "./MapLayerPreview";
import TextLayerPreview from "./TextLayerPreview";

interface Props {
  template: Template | null;
  width?: number;
  height?: number;
}

export default function TemplateThumbnail({ template, width = 120, height = 160 }: Props) {
  const layout = template?.defaultLayout.portrait ?? null;
  const layers = useMemo(
    () => (layout ? [...layout.layers].sort((a, b) => a.zIndex - b.zIndex) : []),
    [layout],
  );

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
        return (
          <div
            key={layer.id}
            style={{ ...style, background: "hsl(var(--muted))" }}
          />
        );
      })}
    </div>
  );
}
