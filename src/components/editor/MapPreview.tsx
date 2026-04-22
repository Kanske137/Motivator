import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEditorStore } from "@/stores/editorStore";
import { getMapboxToken, reverseGeocode, styleUrl } from "@/lib/mapbox";
import type { TemplateLayer } from "@/lib/template-schema";

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
      for (const layer of style.layers) {
        if (layer.type === "symbol") {
          map.setLayoutProperty(layer.id, "visibility", show ? "visible" : "none");
        }
      }
    } catch (e) {
      console.warn("[MapPreview] applyLabelVisibility failed", e);
    }
  };
  if (map.isStyleLoaded()) apply();
  else map.once("idle", apply);
}

/** Heart clipPath used for both map and image layers. Stable id per render. */
function HeartClipDef({ id }: { id: string }) {
  return (
    <svg width="0" height="0" className="absolute pointer-events-none">
      <defs>
        <clipPath id={id} clipPathUnits="objectBoundingBox">
          <path d="M0.5,1 C0.5,1 0,0.65 0,0.3 C0,0.1 0.2,0 0.35,0 C0.42,0 0.48,0.05 0.5,0.15 C0.52,0.05 0.58,0 0.65,0 C0.8,0 1,0.1 1,0.3 C1,0.65 0.5,1 0.5,1 Z" />
        </clipPath>
      </defs>
    </svg>
  );
}

function shapeClipPath(shape: string, heartId: string): string | undefined {
  switch (shape) {
    case "circle":
      return "circle(50% at 50% 50%)";
    case "heart":
      return `url(#${heartId})`;
    case "square":
    case "rect":
    default:
      return undefined;
  }
}

export function MapPreview({ frameColor, frameWidthCm = 2, innerPadding, wrapCm = 0 }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [borderPx, setBorderPx] = useState(0);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const programmaticRef = useRef(false);
  const reverseTimerRef = useRef<number | null>(null);
  const heartIdRef = useRef(`heart-${Math.random().toString(36).slice(2)}`);

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
    templateLayers,
    updateFromMap,
  } = useEditorStore();

  const layers = templateLayers();

  // Pick the first map layer to drive the live Mapbox instance position/shape.
  // (Future: support multiple maps via per-layer instances.)
  const mapLayer = useMemo<TemplateLayer | null>(
    () => layers.find((l) => l.type === "map") ?? null,
    [layers],
  );

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

  // labels toggle
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
  }, [orientation, size, mapShape, mapLayer?.xPct, mapLayer?.yPct, mapLayer?.wPct, mapLayer?.hPct]);

  // Outer poster/canvas frame
  const sizeCm = parseCm(size);
  const frontW = sizeCm ? (orientation === "portrait" ? Math.min(sizeCm.w, sizeCm.h) : Math.max(sizeCm.w, sizeCm.h)) : 30;
  const frontH = sizeCm ? (orientation === "portrait" ? Math.max(sizeCm.w, sizeCm.h) : Math.min(sizeCm.w, sizeCm.h)) : 40;
  const editorW = frontW + 2 * wrapCm;
  const editorH = frontH + 2 * wrapCm;
  const posterAspect = editorW / editorH;
  const frontInsetX = wrapCm > 0 ? wrapCm / editorW : 0;
  const frontInsetY = wrapCm > 0 ? wrapCm / editorH : 0;

  // Compute frame border in pixels
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

  // Helper: convert a layer's % rect (in front-zone coords) into editor-coord %.
  const layerToEditorRect = (l: TemplateLayer) => {
    const left = (frontInsetX + (l.xPct / 100) * (1 - 2 * frontInsetX)) * 100;
    const top = (frontInsetY + (l.yPct / 100) * (1 - 2 * frontInsetY)) * 100;
    const width = (l.wPct / 100) * (1 - 2 * frontInsetX) * 100;
    const height = (l.hPct / 100) * (1 - 2 * frontInsetY) * 100;
    return { left, top, width, height };
  };

  // Map-layer wrapper position. The customer's chosen shape (mapShape) wins
  // over the template default to keep the live shape-toggle responsive.
  const mapLayerRect = mapLayer ? layerToEditorRect(mapLayer) : { left: 0, top: 0, width: 100, height: 100 };
  const isWrap = wrapCm > 0;
  const isShaped = mapShape === "square" || mapShape === "circle" || mapShape === "heart";

  // For "square" and "circle" we keep aspect-ratio 1:1, centered inside the
  // map-layer rect. For "heart" we let it fill the rect (the SVG path scales).
  const mapWrapperStyle: React.CSSProperties = (() => {
    const base: React.CSSProperties = {
      position: "absolute",
      left: `${mapLayerRect.left}%`,
      top: `${mapLayerRect.top}%`,
      width: `${mapLayerRect.width}%`,
      height: `${mapLayerRect.height}%`,
      overflow: "hidden",
    };
    if (mapShape === "circle") {
      // Center a square that fits the rect, then round it.
      const minSide = Math.min(mapLayerRect.width, mapLayerRect.height);
      return {
        ...base,
        width: `${minSide}%`,
        height: undefined,
        aspectRatio: "1 / 1",
        left: `${mapLayerRect.left + (mapLayerRect.width - minSide) / 2}%`,
        top: `calc(${mapLayerRect.top}% + (${mapLayerRect.height}% - ${minSide}%) / 2 * (${editorH} / ${editorW}))`,
        borderRadius: "9999px",
      };
    }
    if (mapShape === "square") {
      const minSide = Math.min(mapLayerRect.width, mapLayerRect.height);
      return {
        ...base,
        width: `${minSide}%`,
        height: undefined,
        aspectRatio: "1 / 1",
        left: `${mapLayerRect.left + (mapLayerRect.width - minSide) / 2}%`,
        top: `calc(${mapLayerRect.top}% + (${mapLayerRect.height}% - ${minSide}%) / 2 * (${editorH} / ${editorW}))`,
      };
    }
    if (mapShape === "heart") {
      return { ...base, clipPath: shapeClipPath("heart", heartIdRef.current) };
    }
    return base;
  })();
  void isShaped;

  // Front zone indicator (canvas wrap mode only)
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
        {mapShape === "heart" && <HeartClipDef id={heartIdRef.current} />}

        {/* Map layer */}
        {mapLayer && (
          <div style={mapWrapperStyle}>
            <div ref={mapContainerRef} className="absolute inset-0" />
          </div>
        )}

        {/* Visible front indicator (canvas wrap mode only) */}
        {isWrap && (
          <div
            className="absolute pointer-events-none border-2 border-dashed border-foreground/40"
            style={frontZoneStyle}
          >
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full bg-background/90 backdrop-blur-sm px-2 py-0.5 text-[10px] uppercase tracking-wider rounded text-foreground/70 whitespace-nowrap">
              Synlig framsida · innehållet här viks om på sidorna
            </span>
          </div>
        )}

        {/* Text layers — driven by template defaults (font sizing, color, alignment) */}
        {textVisible &&
          layers
            .filter((l): l is Extract<TemplateLayer, { type: "text" }> => l.type === "text")
            .map((l) => {
              const rect = layerToEditorRect(l);
              const d = l.defaults;
              // Use customer's font choice if they've changed it; else template default
              const font = textFont || d.font;
              const color = d.color;
              const align = d.align;
              return (
                <div
                  key={l.id}
                  className="absolute pointer-events-none whitespace-pre-line leading-tight"
                  style={{
                    left: `${rect.left}%`,
                    top: `${rect.top}%`,
                    width: `${rect.width}%`,
                    height: `${rect.height}%`,
                    fontFamily: font,
                    color,
                    textAlign: align,
                    // fontSizePct is % of the LAYER's height
                    fontSize: `calc(${rect.height}cqh * ${d.fontSizePct / 100})`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
                    padding: "0 4px",
                    containerType: "size",
                  }}
                >
                  <span style={{ width: "100%" }}>{text || "Lägg till text…"}</span>
                </div>
              );
            })}
      </div>
      <p className="text-[10px] text-muted-foreground">© Mapbox · © OpenStreetMap</p>
    </div>
  );
}
