import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEditorStore } from "@/stores/editorStore";
import { getMapboxToken, styleUrl } from "@/lib/mapbox";

interface Props {
  borderCss?: string;
  innerPadding?: string;
}

export function MapPreview({ borderCss, innerPadding }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const { mapCenter, mapZoom, mapStyleId, text, textFont, textVisible, orientation, currentLayout } =
    useEditorStore();
  const layout = currentLayout();

  // init map once container is mounted
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getMapboxToken();
      if (cancelled || !mapContainerRef.current || mapRef.current) return;
      if (!token) {
        console.error("[MapPreview] No Mapbox token available");
        return;
      }
      const rect = mapContainerRef.current.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) {
        console.warn("[MapPreview] Container has no size yet", rect);
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
      // multiple resize ticks to catch late layout
      setTimeout(() => map.resize(), 50);
      setTimeout(() => map.resize(), 250);
      setTimeout(() => map.resize(), 600);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // observe container size changes (orientation, sidebar, etc.)
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (mapRef.current) mapRef.current.setStyle(styleUrl(mapStyleId));
  }, [mapStyleId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cur = map.getCenter();
    if (Math.abs(cur.lng - mapCenter[0]) > 1e-6 || Math.abs(cur.lat - mapCenter[1]) > 1e-6) {
      map.flyTo({ center: mapCenter, zoom: mapZoom, duration: 800 });
    }
  }, [mapCenter, mapZoom]);

  useEffect(() => {
    setTimeout(() => mapRef.current?.resize(), 80);
  }, [orientation]);

  const isPortrait = orientation === "portrait";
  // Stable preview frame: explicit max sizes so the canvas always has real dims.
  const frameStyle: React.CSSProperties = {
    aspectRatio: isPortrait ? "3 / 4" : "4 / 3",
    width: "min(100%, 70vh * 3 / 4)",
    maxWidth: "100%",
    maxHeight: "85vh",
    border: borderCss,
    padding: innerPadding,
  };
  if (!isPortrait) {
    frameStyle.width = "min(100%, 90vh * 4 / 3)";
  }

  return (
    <div className="w-full h-full flex items-center justify-center p-4 min-h-[60vh]">
      <div className="relative bg-card shadow-2xl" style={frameStyle}>
        <div className="absolute inset-0 overflow-hidden">
          {/* Stable, always-rendered map container that fills the preview */}
          <div ref={mapContainerRef} className="absolute inset-0" />

          {/* text overlays */}
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
