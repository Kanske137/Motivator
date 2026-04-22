// Renders a single Mapbox GL instance positioned at a layer's % rect.
// `live=true` instances are bound to the editor store (pan/zoom/style updates
// propagate to global state). `live=false` instances are static and locked to
// the layer's own defaults (used when a template has multiple map layers).
import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEditorStore } from "@/stores/editorStore";
import { getMapboxToken, reverseGeocode, styleUrl } from "@/lib/mapbox";
import type { MapDefaults } from "@/lib/template-schema";

interface Props {
  defaults: MapDefaults;
  /** Effective shape — for live layer, comes from store; else from defaults. */
  shape: "rect" | "square" | "circle" | "heart";
  /** Effective styleId — live=store, static=defaults. */
  styleId: string;
  /** Effective center — live=store, static=defaults. */
  center: [number, number];
  /** Effective zoom — live=store, static=defaults. */
  zoom: number;
  /** Effective showLabels — live=store, static=defaults. */
  showLabels: boolean;
  /** True if this instance owns global pan/zoom/center state. */
  live: boolean;
  /** Whether the user can interact (drag/zoom). */
  interactive: boolean;
  /** clipPath CSS string (for heart shape via SVG ref). */
  clipPath?: string;
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
      console.warn("[MapLayerInstance] applyLabelVisibility failed", e);
    }
  };
  if (map.isStyleLoaded()) apply();
  else map.once("idle", apply);
}

export function MapLayerInstance({
  defaults,
  shape,
  styleId,
  center,
  zoom,
  showLabels,
  live,
  interactive,
  clipPath,
}: Props) {
  void defaults;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const programmaticRef = useRef(false);
  const reverseTimerRef = useRef<number | null>(null);

  // Init
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getMapboxToken();
      if (cancelled || !containerRef.current || mapRef.current) return;
      if (!token) return;
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: styleUrl(styleId),
        center,
        zoom,
        attributionControl: false,
        interactive,
        scrollZoom: interactive,
        dragPan: interactive,
        doubleClickZoom: interactive,
        touchZoomRotate: interactive,
        boxZoom: false,
        pitchWithRotate: false,
      });

      map.on("load", () => {
        map.resize();
        applyLabelVisibility(map, showLabels);
      });
      map.on("style.load", () => {
        applyLabelVisibility(map, showLabels);
      });

      if (live) {
        map.on("moveend", () => {
          if (programmaticRef.current) {
            programmaticRef.current = false;
            return;
          }
          const c = map.getCenter();
          const z = map.getZoom();
          useEditorStore.setState({ mapCenter: [c.lng, c.lat], mapZoom: z });

          if (reverseTimerRef.current) window.clearTimeout(reverseTimerRef.current);
          reverseTimerRef.current = window.setTimeout(async () => {
            const r = await reverseGeocode(c.lng, c.lat);
            if (r) {
              useEditorStore.getState().updateFromMap({
                placeName: r.place_name,
                center: [c.lng, c.lat],
                city: r.city,
                country: r.country,
              });
            }
          }, 400);
        });
      }

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
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // style change
  useEffect(() => {
    if (mapRef.current) mapRef.current.setStyle(styleUrl(styleId));
  }, [styleId]);

  // labels
  useEffect(() => {
    if (mapRef.current) applyLabelVisibility(mapRef.current, showLabels);
  }, [showLabels]);

  // programmatic flyTo when external center/zoom change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cur = map.getCenter();
    const curZoom = map.getZoom();
    const lngDiff = Math.abs(cur.lng - center[0]);
    const latDiff = Math.abs(cur.lat - center[1]);
    const zoomDiff = Math.abs(curZoom - zoom);
    if (lngDiff > 1e-4 || latDiff > 1e-4 || zoomDiff > 0.05) {
      programmaticRef.current = true;
      map.flyTo({ center, zoom, duration: 800 });
    }
  }, [center, zoom]);

  // resize when shape changes (square/circle re-layout)
  useEffect(() => {
    setTimeout(() => mapRef.current?.resize(), 80);
    setTimeout(() => mapRef.current?.resize(), 320);
  }, [shape]);

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ clipPath }}>
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
