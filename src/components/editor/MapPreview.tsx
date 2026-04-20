import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEditorStore } from "@/stores/editorStore";
import { getMapboxToken, styleUrl } from "@/lib/mapbox";

interface Props {
  /** Border style around the canvas, e.g. "8px solid #1a1a1a" for a black frame */
  borderCss?: string;
  /** Optional padding inside the canvas to mimic mat board */
  innerPadding?: string;
}

export function MapPreview({ borderCss, innerPadding }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const { mapCenter, mapZoom, mapStyleId, text, textFont, textVisible, orientation, currentLayout } =
    useEditorStore();
  const layout = currentLayout();

  // init map once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getMapboxToken();
      if (cancelled || !mapContainerRef.current || mapRef.current) return;
      if (!token) {
        console.error("[MapPreview] No Mapbox token available");
        return;
      }
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: styleUrl(mapStyleId),
        center: mapCenter,
        zoom: mapZoom,
        attributionControl: false,
        interactive: true,
      });
      map.on("load", () => map.resize());
      map.on("moveend", () => {
        const c = map.getCenter();
        useEditorStore.setState({
          mapCenter: [c.lng, c.lat],
          mapZoom: map.getZoom(),
        });
      });
      mapRef.current = map;
      // safety resize after a tick (container may be sized via parent layout)
      setTimeout(() => map.resize(), 100);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // react to style change
  useEffect(() => {
    if (mapRef.current) mapRef.current.setStyle(styleUrl(mapStyleId));
  }, [mapStyleId]);

  // react to programmatic center/zoom updates (e.g. geocode)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cur = map.getCenter();
    if (Math.abs(cur.lng - mapCenter[0]) > 1e-6 || Math.abs(cur.lat - mapCenter[1]) > 1e-6) {
      map.flyTo({ center: mapCenter, zoom: mapZoom, duration: 800 });
    }
  }, [mapCenter, mapZoom]);

  // resize on orientation change
  useEffect(() => {
    setTimeout(() => mapRef.current?.resize(), 80);
  }, [orientation]);

  const aspect = orientation === "portrait" ? "3 / 4" : "4 / 3";

  // first map layer position (for overlay positioning); fallback = full area
  const mapLayer = layout?.layers.find((l) => l.type === "map");
  const mapLayerStyle: React.CSSProperties = mapLayer
    ? { left: mapLayer.x, top: mapLayer.y, width: mapLayer.w, height: mapLayer.h }
    : { left: 0, top: 0, width: "100%", height: "100%" };

  return (
    <div className="w-full h-full flex items-center justify-center p-4">
      <div
        className="relative bg-card shadow-2xl"
        style={{
          aspectRatio: aspect,
          maxHeight: "100%",
          maxWidth: "100%",
          height: "auto",
          width: orientation === "portrait" ? "auto" : "100%",
          border: borderCss,
          padding: innerPadding,
        }}
      >
        <div className="relative w-full h-full overflow-hidden">
          {/* Stable map container */}
          <div ref={mapContainerRef} className="absolute" style={mapLayerStyle} />

          {/* text layer */}
          {textVisible &&
            layout?.layers
              .filter((l) => l.type === "text")
              .map((l, i) => (
                <div
                  key={`text-${i}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 text-center px-2 text-foreground pointer-events-none"
                  style={{
                    left: l.x,
                    top: l.y,
                    fontFamily: textFont,
                    width: "90%",
                  }}
                >
                  <div className="whitespace-pre-line text-sm md:text-base lg:text-lg font-medium tracking-wide leading-tight">
                    {text || "Lägg till text…"}
                  </div>
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}
