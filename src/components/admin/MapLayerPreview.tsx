// Mini Mapbox static-image preview used inside admin LayerCanvas tiles.
// Clipped to the layer's shape via SVG clipPath. Falls back to a flat
// gradient placeholder while the token is loading or if it fails.
import { useMemo } from "react";
import { useMapboxToken } from "@/hooks/useMapboxToken";
import type { MapDefaults } from "@/lib/template-schema";

interface Props {
  defaults: MapDefaults;
  width: number; // px hint for the mapbox tile resolution
  height: number;
}

const MAX_PX = 600;

export default function MapLayerPreview({ defaults, width, height }: Props) {
  const { data: token } = useMapboxToken();

  const url = useMemo(() => {
    if (!token) return null;
    const w = Math.min(MAX_PX, Math.max(120, Math.round(width)));
    const h = Math.min(MAX_PX, Math.max(120, Math.round(height)));
    const [lng, lat] = defaults.center;
    const labels = defaults.showLabels ? "" : "/static";
    void labels;
    return `https://api.mapbox.com/styles/v1/mapbox/${defaults.styleId}/static/${lng},${lat},${defaults.zoom},0/${w}x${h}@2x?access_token=${token}&logo=false&attribution=false`;
  }, [token, defaults, width, height]);

  const clipId = useMemo(() => `clip-${Math.random().toString(36).slice(2)}`, []);
  const clipPath = (() => {
    switch (defaults.shape) {
      case "circle":
        return "circle(50% at 50% 50%)";
      case "square":
        return "inset(0 round 0)";
      case "heart":
        return `url(#${clipId})`;
      case "rect":
      default:
        return undefined;
    }
  })();

  return (
    <div className="relative w-full h-full overflow-hidden">
      {defaults.shape === "heart" && (
        <svg width="0" height="0" className="absolute">
          <defs>
            <clipPath id={clipId} clipPathUnits="objectBoundingBox">
              <path d="M0.5,1 C0.5,1 0,0.65 0,0.3 C0,0.1 0.2,0 0.35,0 C0.42,0 0.48,0.05 0.5,0.15 C0.52,0.05 0.58,0 0.65,0 C0.8,0 1,0.1 1,0.3 C1,0.65 0.5,1 0.5,1 Z" />
            </clipPath>
          </defs>
        </svg>
      )}
      {url ? (
        <img
          src={url}
          alt=""
          className="w-full h-full object-cover"
          style={{ clipPath }}
          draggable={false}
        />
      ) : (
        <div
          className="w-full h-full bg-gradient-to-br from-muted to-muted-foreground/30"
          style={{ clipPath }}
        />
      )}
    </div>
  );
}
