import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEditorStore } from "@/stores/editorStore";
import { getMapboxToken, reverseGeocode, styleUrl } from "@/lib/mapbox";

interface Props {
  frameColor?: string; // CSS color for border. Empty/undefined = no border.
  frameWidthCm?: number; // physical frame width in cm (default 2)
  innerPadding?: string;
}

function parseCm(size: string | null): { w: number; h: number } | null {
  if (!size) return null;
  const m = size.match(/(\d+)\s*[xX×]\s*(\d+)/);
  if (!m) return null;
  return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
}

function applyLabelVisibility(map: mapboxgl.Map, show: boolean) {
  const apply = () => {
    try {
      const style = map.getStyle();
      if (!style?.layers) return;
      let count = 0;
      for (const layer of style.layers) {
        if (layer.type === "symbol") {
          map.setLayoutProperty(layer.id, "visibility", show ? "visible" : "none");
          count++;
        }
      }
      console.log(`[MapPreview] labels ${show ? "ON" : "OFF"} (${count} symbol layers)`);
    } catch (e) {
      console.warn("[MapPreview] applyLabelVisibility failed", e);
    }
  };
  if (map.isStyleLoaded()) apply();
  else map.once("idle", apply);
}

export function MapPreview({ frameColor, frameWidthCm = 2, innerPadding }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [borderPx, setBorderPx] = useState(0);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const programmaticRef = useRef(false);
  const reverseTimerRef = useRef<number | null>(null);

  const {
    mapCenter,
    mapZoom,
    mapStyleId,
    text,
    textFont,
    textVisible,
    orientation,
    size,
    showLabels,
    mapShape,
    posterBgColor,
    currentLayout,
    updateFromMap,
  } = useEditorStore();
  const layout = currentLayout();

  // init map
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
        scrollZoom: true,
        dragPan: true,
        doubleClickZoom: true,
        touchZoomRotate: true,
        boxZoom: false,
        pitchWithRotate: false,
      });

      map.on("load", () => {
        map.resize();
        applyLabelVisibility(map, useEditorStore.getState().showLabels);
      });
      map.on("style.load", () => {
        applyLabelVisibility(map, useEditorStore.getState().showLabels);
      });

      map.on("moveend", () => {
        if (programmaticRef.current) {
          programmaticRef.current = false;
          return;
        }
        const c = map.getCenter();
        const z = map.getZoom();
        useEditorStore.setState({ mapCenter: [c.lng, c.lat], mapZoom: z });

        // debounced reverse geocode
        if (reverseTimerRef.current) window.clearTimeout(reverseTimerRef.current);
        reverseTimerRef.current = window.setTimeout(async () => {
          const r = await reverseGeocode(c.lng, c.lat);
          if (r) {
            updateFromMap({
              placeName: r.place_name,
              center: [c.lng, c.lat],
              city: r.city,
              country: r.country,
            });
          }
        }, 400);
      });

      mapRef.current = map;
      setTimeout(() => map.resize(), 50);
      setTimeout(() => map.resize(), 250);
      setTimeout(() => map.resize(), 600);
    })();
    return () => {
      cancelled = true;
      if (reverseTimerRef.current) window.clearTimeout(reverseTimerRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // resize observer
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // style change
  useEffect(() => {
    if (mapRef.current) mapRef.current.setStyle(styleUrl(mapStyleId));
  }, [mapStyleId]);

  // labels toggle (in case style already loaded)
  useEffect(() => {
    if (mapRef.current) applyLabelVisibility(mapRef.current, showLabels);
  }, [showLabels]);

  // programmatic flyTo only when state changes from outside (e.g. search)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cur = map.getCenter();
    const curZoom = map.getZoom();
    const lngDiff = Math.abs(cur.lng - mapCenter[0]);
    const latDiff = Math.abs(cur.lat - mapCenter[1]);
    const zoomDiff = Math.abs(curZoom - mapZoom);
    if (lngDiff > 1e-4 || latDiff > 1e-4 || zoomDiff > 0.05) {
      programmaticRef.current = true;
      map.flyTo({ center: mapCenter, zoom: mapZoom, duration: 800 });
    }
  }, [mapCenter, mapZoom]);

  // resize on orientation/size changes
  useEffect(() => {
    setTimeout(() => mapRef.current?.resize(), 80);
    setTimeout(() => mapRef.current?.resize(), 320);
  }, [orientation, size, mapShape]);

  // Outer poster frame: ALWAYS uses poster aspect (independent of mapShape)
  const sizeCm = parseCm(size);
  const posterAspect = sizeCm
    ? (orientation === "portrait"
        ? Math.min(sizeCm.w, sizeCm.h) / Math.max(sizeCm.w, sizeCm.h)
        : Math.max(sizeCm.w, sizeCm.h) / Math.min(sizeCm.w, sizeCm.h))
    : (orientation === "portrait" ? 3 / 4 : 4 / 3);

  // Compute frame border in pixels relative to physical short side (Gelato ~2cm)
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const compute = () => {
      if (!frameColor || !sizeCm) {
        setBorderPx(0);
        return;
      }
      const rect = el.getBoundingClientRect();
      const shortPx = Math.min(rect.width, rect.height);
      const shortCm = Math.min(sizeCm.w, sizeCm.h);
      const px = Math.round((frameWidthCm / shortCm) * shortPx);
      setBorderPx(px);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frameColor, frameWidthCm, sizeCm?.w, sizeCm?.h]);

  const isPortrait = posterAspect < 1;
  const frameStyle: React.CSSProperties = {
    aspectRatio: `${posterAspect}`,
    width: isPortrait ? "auto" : "min(100%, 70vh)",
    height: isPortrait ? "min(100%, 78vh)" : "auto",
    maxWidth: "100%",
    maxHeight: "78vh",
    background: posterBgColor,
    borderStyle: frameColor ? "solid" : undefined,
    borderColor: frameColor,
    borderWidth: frameColor ? `${borderPx}px` : 0,
    padding: innerPadding,
    boxSizing: "border-box",
  };

  // Inner map wrapper kept ALWAYS within the poster frame.
  // Square/circle: fit a centered square that hugs the poster's shorter side.
  const isShaped = mapShape === "square" || mapShape === "circle";
  const isPortraitFrame = posterAspect <= 1;
  const mapWrapperStyle: React.CSSProperties = isShaped
    ? {
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: isPortraitFrame ? "100%" : "auto",
        height: isPortraitFrame ? "auto" : "100%",
        aspectRatio: "1 / 1",
        borderRadius: mapShape === "circle" ? "9999px" : "0",
        overflow: "hidden",
      }
    : { position: "absolute", inset: 0, overflow: "hidden" };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4 gap-2">
      {/* Hide Mapbox watermark/attrib visually (credited below) */}
      <style>{`
        .mapboxgl-ctrl-logo, .mapboxgl-ctrl-attrib { display: none !important; }
      `}</style>
      <div
        ref={frameRef}
        className="relative shadow-[0_30px_60px_-20px_rgba(0,0,0,0.25)]"
        style={frameStyle}
      >
        <div style={mapWrapperStyle}>
          <div ref={mapContainerRef} className="absolute inset-0" />
        </div>

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
      <p className="text-[10px] text-muted-foreground">© Mapbox · © OpenStreetMap</p>
    </div>
  );
}
