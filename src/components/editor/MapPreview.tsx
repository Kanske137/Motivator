import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEditorStore } from "@/stores/editorStore";
import { getMapboxToken, reverseGeocode, styleUrl } from "@/lib/mapbox";

interface Props {
  frameColor?: string; // CSS color for border. Empty/undefined = no border.
  frameWidthCm?: number; // physical frame width in cm (default 2)
  innerPadding?: string;
  /** Canvas wrap depth in cm (>0 → editor area is extended to include wrap zone). */
  wrapCm?: number;
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

export function MapPreview({ frameColor, frameWidthCm = 2, innerPadding, wrapCm = 0 }: Props) {
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

  // Outer poster/canvas frame. For canvas (wrapCm>0) the editor renders the
  // FULL print area (front + wrap on all sides) so users see what wraps onto
  // the sides of the physical canvas.
  const sizeCm = parseCm(size);
  const frontW = sizeCm ? (orientation === "portrait" ? Math.min(sizeCm.w, sizeCm.h) : Math.max(sizeCm.w, sizeCm.h)) : 30;
  const frontH = sizeCm ? (orientation === "portrait" ? Math.max(sizeCm.w, sizeCm.h) : Math.min(sizeCm.w, sizeCm.h)) : 40;
  const editorW = frontW + 2 * wrapCm;
  const editorH = frontH + 2 * wrapCm;
  const posterAspect = editorW / editorH;
  const frontInsetX = wrapCm > 0 ? wrapCm / editorW : 0;
  const frontInsetY = wrapCm > 0 ? wrapCm / editorH : 0;

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
  // For canvas (wrapCm>0) the shape applies only to the FRONT zone — the wrap
  // strip around it always shows the rectangular map continuation.
  const isShaped = mapShape === "square" || mapShape === "circle";
  const isPortraitFrame = posterAspect <= 1;
  const isWrap = wrapCm > 0;

  // Map ALWAYS covers the full editor area (rect) when in wrap mode so the
  // wrap zone shows continuous map. Shape clip is applied as a separate overlay.
  const mapWrapperStyle: React.CSSProperties = isShaped && !isWrap
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

  // Front zone (where the visible front lives in canvas mode). For posters
  // this equals the whole editor.
  const frontZoneStyle: React.CSSProperties = {
    position: "absolute",
    left: `${frontInsetX * 100}%`,
    top: `${frontInsetY * 100}%`,
    right: `${frontInsetX * 100}%`,
    bottom: `${frontInsetY * 100}%`,
  };

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

        {/* Canvas wrap mode: shape clip via SVG mask within front zone only */}
        {isWrap && isShaped && (
          <div
            className="absolute pointer-events-none"
            style={{
              ...frontZoneStyle,
              background: posterBgColor,
              WebkitMaskImage:
                mapShape === "circle"
                  ? "radial-gradient(circle at 50% 50%, transparent 0, transparent 49.5%, #000 50%)"
                  : "linear-gradient(#000,#000)",
              WebkitMaskSize:
                mapShape === "square"
                  ? `${Math.min(100, (Math.min(frontW, frontH) / Math.max(frontW, frontH)) * 100)}% ${Math.min(100, (Math.min(frontW, frontH) / Math.max(frontW, frontH)) * 100)}%`
                  : "100% 100%",
              WebkitMaskPosition: "center",
              WebkitMaskRepeat: "no-repeat",
              maskImage:
                mapShape === "circle"
                  ? "radial-gradient(circle at 50% 50%, transparent 0, transparent 49.5%, #000 50%)"
                  : "linear-gradient(#000,#000)",
              maskSize:
                mapShape === "square"
                  ? `${Math.min(100, (Math.min(frontW, frontH) / Math.max(frontW, frontH)) * 100)}% ${Math.min(100, (Math.min(frontW, frontH) / Math.max(frontW, frontH)) * 100)}%`
                  : "100% 100%",
              maskPosition: "center",
              maskRepeat: "no-repeat",
            }}
          />
        )}

        {/* Visible front indicator (canvas wrap mode only) */}
        {isWrap && (
          <div
            className="absolute pointer-events-none border-2 border-dashed border-foreground/40"
            style={frontZoneStyle}
          >
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full bg-background/90 backdrop-blur-sm px-2 py-0.5 text-[10px] uppercase tracking-wider rounded text-foreground/70 whitespace-nowrap">
              Synlig framsida · kanterna wrappas
            </span>
          </div>
        )}

        {textVisible &&
          layout?.layers
            .filter((l) => l.type === "text")
            .map((l, i) => {
              // Parse l.x/l.y as % within FRONT zone, then map to editor coords
              const xPct = parseFloat(String(l.x)) / 100;
              const yPct = parseFloat(String(l.y)) / 100;
              const leftPct = (frontInsetX + xPct * (1 - 2 * frontInsetX)) * 100;
              const topPct = (frontInsetY + yPct * (1 - 2 * frontInsetY)) * 100;
              return (
                <div
                  key={`text-${i}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 text-center px-2 text-foreground pointer-events-none"
                  style={{
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    fontFamily: textFont,
                    width: `${(1 - 2 * frontInsetX) * 90}%`,
                  }}
                >
                  <div className="whitespace-pre-line text-sm md:text-base lg:text-lg font-medium tracking-wide leading-tight">
                    {text || "Lägg till text…"}
                  </div>
                </div>
              );
            })}
      </div>
      <p className="text-[10px] text-muted-foreground">© Mapbox · © OpenStreetMap</p>
    </div>
  );
}
