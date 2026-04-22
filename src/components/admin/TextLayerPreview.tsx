// Mini text-layer preview rendered inside the admin LayerCanvas tile.
// Uses the layer's actual font/size/color/align so admin sees what the
// customer will see.
import type { TextDefaults } from "@/lib/template-schema";

interface Props {
  defaults: TextDefaults;
  height: number; // px height of the layer tile (drives font size)
}

export default function TextLayerPreview({ defaults, height }: Props) {
  const fontSizePx = Math.max(8, (defaults.fontSizePct / 100) * height);
  const justify =
    defaults.align === "left" ? "flex-start" : defaults.align === "right" ? "flex-end" : "center";

  return (
    <div
      className="w-full h-full flex items-center px-2 select-none"
      style={{ justifyContent: justify }}
    >
      <span
        style={{
          fontFamily: `"${defaults.font}", system-ui, sans-serif`,
          fontSize: `${fontSizePx}px`,
          color: defaults.color,
          textAlign: defaults.align,
          lineHeight: 1.05,
        }}
        className="truncate"
      >
        {defaults.text || "TEXT"}
      </span>
    </div>
  );
}
