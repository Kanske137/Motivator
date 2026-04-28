import { useEffect, useRef, useState, useCallback } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEditorStore, type PhotoLayerValue } from "@/stores/editorStore";
import type { TemplateLayer } from "@/lib/template-schema";
import { MapLayerInstance } from "./layers/MapLayerInstance";
import { ImageLayerView, LineLayerView, MarginLayerView } from "./layers/StaticLayers";
import { ShapeLayerView } from "./layers/ShapeLayerView";
import { lineThicknessPxFromCanvas, effectiveLayerRect, clampLayerRect } from "@/lib/layer-utils";

interface Props {
  frameColor?: string;
  frameWidthCm?: number;
  innerPadding?: string;
  /** Canvas wrap depth in cm. */
  wrapCm?: number;
}

function parseCm(size: string | null): { w: number; h: number } | null {
  if (!size) return null;
  const m = size.match(/(\d+)\s*[xX×]\s*(\d+)/);
  if (!m) return null;
  return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
}

/** Stable heart-clip SVG def shared across all layers. */
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

/** Stable star-clip SVG def (5-point star). */
function StarClipDef({ id }: { id: string }) {
  return (
    <svg width="0" height="0" className="absolute pointer-events-none">
      <defs>
        <clipPath id={id} clipPathUnits="objectBoundingBox">
          <path d="M0.5,0 L0.618,0.345 L0.976,0.345 L0.690,0.560 L0.794,0.905 L0.5,0.690 L0.206,0.905 L0.310,0.560 L0.024,0.345 L0.382,0.345 Z" />
        </clipPath>
      </defs>
    </svg>
  );
}

function shapeClipPath(shape: string, heartId: string, starId: string): string | undefined {
  switch (shape) {
    case "circle":
      // Fallback only — for perfect-circle in non-square containers, callers
      // should use `useCircleClip` to get a px-based radius instead.
      return "circle(50% at 50% 50%)";
    case "heart":
      return `url(#${heartId})`;
    case "star":
      return `url(#${starId})`;
    default:
      return undefined;
  }
}

/**
 * Measures the host element and returns a pixel-based circle clip-path that
 * always renders a perfect circle (diameter = min(width, height)) centered
 * inside the container — even when the layer rect is non-square.
 */
function useCircleClip(enabled: boolean): {
  ref: React.RefObject<HTMLDivElement>;
  clipPath: string | undefined;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [clipPath, setClipPath] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!enabled) {
      setClipPath(undefined);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const radius = Math.max(0, Math.min(r.width, r.height) / 2);
      setClipPath(`circle(${radius}px at 50% 50%)`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);
  return { ref, clipPath };
}

export function MapPreview({ frameColor, frameWidthCm = 2, innerPadding, wrapCm = 0 }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [borderPx, setBorderPx] = useState(0);
  const [frameShortPx, setFrameShortPx] = useState(0);
  const heartIdRef = useRef(`heart-${Math.random().toString(36).slice(2)}`);
  const starIdRef = useRef(`star-${Math.random().toString(36).slice(2)}`);

  const {
    orientation,
    size,
    posterBgColor,
    templateLayers,
    layerValues,
    layerTransforms,
    setLayerTransform,
    designSource,
    photoPreviewUrl,
    aiPrintFileUrl,
    aiPhotoResults,
  } = useEditorStore();

  const layers = templateLayers();
  // Center-alignment guides shown while dragging a layer (in % of editor).
  const [guides, setGuides] = useState<{ h: boolean; v: boolean }>({ h: false, v: false });
  // When the customer has uploaded a photo (or generated an AI image) we
  // show that image inside every map layer's shape instead of Mapbox.
  const photoOverlayUrl =
    designSource === "ai" ? aiPrintFileUrl : designSource === "photo" ? photoPreviewUrl : null;

  // Outer poster/canvas frame
  const sizeCm = parseCm(size);
  const frontW = sizeCm
    ? orientation === "portrait"
      ? Math.min(sizeCm.w, sizeCm.h)
      : Math.max(sizeCm.w, sizeCm.h)
    : 30;
  const frontH = sizeCm
    ? orientation === "portrait"
      ? Math.max(sizeCm.w, sizeCm.h)
      : Math.min(sizeCm.w, sizeCm.h)
    : 40;
  const editorW = frontW + 2 * wrapCm;
  const editorH = frontH + 2 * wrapCm;
  const posterAspect = editorW / editorH;
  const frontInsetX = wrapCm > 0 ? wrapCm / editorW : 0;
  const frontInsetY = wrapCm > 0 ? wrapCm / editorH : 0;

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      const shortPx = Math.min(rect.width, rect.height);
      setFrameShortPx(shortPx);
      if (!frameColor || !sizeCm) {
        setBorderPx(0);
        return;
      }
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

  const layerToEditorRect = (l: TemplateLayer) => {
    const eff = effectiveLayerRect(l, layerTransforms);
    const left = (frontInsetX + (eff.xPct / 100) * (1 - 2 * frontInsetX)) * 100;
    const top = (frontInsetY + (eff.yPct / 100) * (1 - 2 * frontInsetY)) * 100;
    const width = (eff.wPct / 100) * (1 - 2 * frontInsetX) * 100;
    const height = (eff.hPct / 100) * (1 - 2 * frontInsetY) * 100;
    return { left, top, width, height };
  };

  // Pointer-drag handler attached to the wrapper div of any draggable layer.
  // Translates pixel deltas → % of editor canvas, snaps to center (h/v) when
  // close, and clamps so the layer never crosses the editor edges.
  const SNAP_PCT = 0.6; // distance from center where we snap
  const onDragStart = useCallback(
    (l: TemplateLayer, e: React.PointerEvent<HTMLDivElement>) => {
      const frame = frameRef.current;
      if (!frame) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const rect = frame.getBoundingClientRect();
      const eff = effectiveLayerRect(l, layerTransforms);
      const startX = e.clientX;
      const startY = e.clientY;
      const startXPct = eff.xPct;
      const startYPct = eff.yPct;
      const wPct = eff.wPct;
      const hPct = eff.hPct;

      const onMove = (ev: PointerEvent) => {
        const dxPct = ((ev.clientX - startX) / rect.width) * 100;
        const dyPct = ((ev.clientY - startY) / rect.height) * 100;
        let nx = startXPct + dxPct;
        let ny = startYPct + dyPct;
        // Center-snap (horizontal: layer center == 50; vertical likewise)
        const centerXTarget = 50 - wPct / 2;
        const centerYTarget = 50 - hPct / 2;
        let snapH = false, snapV = false;
        if (Math.abs(nx - centerXTarget) < SNAP_PCT) { nx = centerXTarget; snapV = true; }
        if (Math.abs(ny - centerYTarget) < SNAP_PCT) { ny = centerYTarget; snapH = true; }
        const c = clampLayerRect({ xPct: nx, yPct: ny, wPct, hPct });
        setLayerTransform(l.id, c);
        setGuides({ h: snapH, v: snapV });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setGuides({ h: false, v: false });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [layerTransforms, setLayerTransform],
  );

  const isWrap = wrapCm > 0;
  const frontZoneStyle: React.CSSProperties = {
    position: "absolute",
    left: `${frontInsetX * 100}%`,
    top: `${frontInsetY * 100}%`,
    right: `${frontInsetX * 100}%`,
    bottom: `${frontInsetY * 100}%`,
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4 gap-2">
      <style>{`
        .mapboxgl-ctrl-logo, .mapboxgl-ctrl-attrib { display: none !important; }
      `}</style>
      <div
        ref={frameRef}
        className="relative shadow-[0_30px_60px_-20px_rgba(0,0,0,0.25)]"
        style={frameStyle}
      >
        <HeartClipDef id={heartIdRef.current} />
        <StarClipDef id={starIdRef.current} />

        {/* Loop all template layers in zIndex order */}
        {layers.map((l) => {
          const rect = layerToEditorRect(l);
          const wrapStyle: React.CSSProperties = {
            position: "absolute",
            left: `${rect.left}%`,
            top: `${rect.top}%`,
            width: `${rect.width}%`,
            height: `${rect.height}%`,
            zIndex: l.zIndex,
          };
          const movable = !l.locks.move && (l.type === "map" || l.type === "photo" || l.type === "aiPhoto" || l.type === "text" || l.type === "image");
          const moveHandle = movable ? (
            <button
              type="button"
              onPointerDown={(e) => onDragStart(l, e)}
              className="absolute -top-3 -left-3 w-7 h-7 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center text-[12px] cursor-move touch-none z-10 ring-2 ring-background"
              aria-label="Flytta lager"
              title="Dra för att flytta lagret"
            >
              ✥
            </button>
          ) : null;

          if (l.type === "map") {
            const v = layerValues[l.id];
            const mv = v && v.kind === "map" ? v : null;
            const effectiveShape = (mv?.shape ?? l.defaults.shape) as "circle" | "heart" | "star";
            const effectiveStyleId = mv?.styleId ?? l.defaults.styleId;
            const effectiveCenter: [number, number] = mv?.center ?? [
              l.defaults.center[0]!,
              l.defaults.center[1]!,
            ];
            const effectiveZoom = mv?.zoom ?? l.defaults.zoom;
            const effectiveLabels = mv?.showLabels ?? l.defaults.showLabels;
            const staticClip = shapeClipPath(
              effectiveShape,
              heartIdRef.current,
              starIdRef.current,
            );
            return (
              <MapLayerSlot
                key={l.id}
                wrapStyle={wrapStyle}
                isCircle={effectiveShape === "circle"}
                staticClip={staticClip}
              >
                {(clip) => (
                  <MapLayerInstance
                    layerId={l.id}
                    shape={effectiveShape}
                    styleId={effectiveStyleId}
                    center={effectiveCenter}
                    zoom={effectiveZoom}
                    showLabels={effectiveLabels}
                    interactive={!l.locks.position}
                    clipPath={clip}
                  />
                )}
              </MapLayerSlot>
            );
          }

          if (l.type === "photo") {
            const v = layerValues[l.id];
            const pv = v && v.kind === "photo" ? (v as PhotoLayerValue) : null;
            const effectiveShape = (pv?.shape ?? l.defaults.shape) as
              | "rect"
              | "circle"
              | "heart"
              | "star";
            const offsetX = pv?.offsetX ?? 0;
            const offsetY = pv?.offsetY ?? 0;
            const staticClip = shapeClipPath(
              effectiveShape,
              heartIdRef.current,
              starIdRef.current,
            );
            const src = photoOverlayUrl ?? l.defaults.placeholderUrl ?? null;
            return (
              <div key={l.id} style={wrapStyle}>
                <PhotoLayerView
                  layerId={l.id}
                  src={src}
                  fit={l.defaults.fit}
                  shape={effectiveShape}
                  staticClipPath={staticClip}
                  offsetX={offsetX}
                  offsetY={offsetY}
                  draggable={!!src}
                />
              </div>
            );
          }

          if (l.type === "aiPhoto") {
            const v = layerValues[l.id];
            const av = v && v.kind === "aiPhoto" ? v : null;
            const effectiveShape = (av?.shape ?? l.defaults.shape) as
              | "rect"
              | "circle"
              | "heart"
              | "star";
            const offsetX = av?.offsetX ?? 0;
            const offsetY = av?.offsetY ?? 0;
            const staticClip = shapeClipPath(
              effectiveShape,
              heartIdRef.current,
              starIdRef.current,
            );
            // Source priority: face-swap result → admin reference image →
            // empty placeholder.
            const src = aiPhotoResults[l.id] ?? l.defaults.referenceImageUrl ?? null;
            return (
              <div key={l.id} style={wrapStyle}>
                {src ? (
                  <PhotoLayerView
                    layerId={l.id}
                    src={src}
                    fit={l.defaults.fit}
                    shape={effectiveShape}
                    staticClipPath={staticClip}
                    offsetX={offsetX}
                    offsetY={offsetY}
                    draggable={!!src}
                  />
                ) : (
                  <div
                    className="w-full h-full flex flex-col items-center justify-center gap-1 text-center px-2 bg-accent/30 border-2 border-dashed border-primary/40 rounded"
                    style={{ clipPath: staticClip }}
                  >
                    <span className="text-base">✨</span>
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      AI-bild visas här efter Skapa nu
                    </span>
                  </div>
                )}
              </div>
            );
          }

          if (l.type === "text") {
            const v = layerValues[l.id];
            const tv = v && v.kind === "text" ? v : null;
            if (tv && !tv.visible) return null;
            const d = l.defaults;
            const effectiveText = tv?.text ?? d.text;
            const effectiveFont = tv?.font || d.font;
            return (
              <div
                key={l.id}
                className="absolute pointer-events-none whitespace-pre-line leading-tight"
                style={{
                  ...wrapStyle,
                  fontFamily: effectiveFont,
                  color: d.color,
                  textAlign: d.align,
                  fontSize: `calc(${rect.height}cqh * ${d.fontSizePct / 100})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent:
                    d.align === "left" ? "flex-start" : d.align === "right" ? "flex-end" : "center",
                  padding: "0 4px",
                  containerType: "size",
                }}
              >
                <span style={{ width: "100%" }}>{effectiveText || "Lägg till text…"}</span>
              </div>
            );
          }

          if (l.type === "image") {
            return (
              <div key={l.id} style={wrapStyle}>
                <ImageLayerView layer={l} />
              </div>
            );
          }

          if (l.type === "line") {
            // Customer never interacts with lines (admin-locked) — let clicks
            // pass through the wrapper to layers underneath.
            return (
              <div key={l.id} style={{ ...wrapStyle, pointerEvents: "none" }}>
                <LineLayerView
                  layer={l}
                  thicknessPx={lineThicknessPxFromCanvas(l, frameShortPx)}
                />
              </div>
            );
          }

          if (l.type === "margin") {
            // Margin wrapper covers the full canvas; without pointerEvents:none
            // it would steal all clicks from the map/text/photo layers below.
            // MarginLayerView already opts the four visible edge strips back
            // in via pointer-events:auto.
            return (
              <div key={l.id} style={{ ...wrapStyle, pointerEvents: "none" }}>
                <MarginLayerView layer={l} />
              </div>
            );
          }

          if (l.type === "shape") {
            // Admin-only decoration — never blocks customer interaction.
            return (
              <div key={l.id} style={{ ...wrapStyle, pointerEvents: "none" }}>
                <ShapeLayerView layer={l} canvasShortPx={frameShortPx} />
              </div>
            );
          }

          return null;
        })}

        {/* Visible front indicator (canvas wrap mode only) */}
        {isWrap && (
          <div
            className="absolute pointer-events-none border-2 border-dashed border-foreground/40"
            style={{ ...frontZoneStyle, zIndex: 9999 }}
          >
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full bg-background/90 backdrop-blur-sm px-2 py-0.5 text-[10px] uppercase tracking-wider rounded text-foreground/70 whitespace-nowrap">
              Synlig framsida · innehållet här viks om på sidorna
            </span>
          </div>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">© Mapbox · © OpenStreetMap</p>
    </div>
  );
}

/**
 * Renders a map layer wrapper that, when the shape is `circle`, measures its
 * own pixel size and produces a perfect-circle clip-path. For other shapes it
 * passes through the static (SVG / fallback) clip-path.
 */
function MapLayerSlot({
  wrapStyle,
  isCircle,
  staticClip,
  children,
}: {
  wrapStyle: React.CSSProperties;
  isCircle: boolean;
  staticClip: string | undefined;
  children: (clip: string | undefined) => React.ReactNode;
}) {
  const { ref, clipPath } = useCircleClip(isCircle);
  const effectiveClip = isCircle ? clipPath ?? staticClip : staticClip;
  return (
    <div ref={ref} style={wrapStyle}>
      {children(effectiveClip)}
    </div>
  );
}

interface PhotoLayerViewProps {
  layerId: string;
  src: string | null;
  fit: "cover" | "contain";
  shape: "rect" | "circle" | "heart" | "star";
  staticClipPath?: string;
  offsetX: number;
  offsetY: number;
  draggable: boolean;
}

function PhotoLayerView({
  layerId,
  src,
  fit,
  shape,
  staticClipPath,
  offsetX,
  offsetY,
  draggable,
}: PhotoLayerViewProps) {
  const setLayerPhotoOffset = useEditorStore((s) => s.setLayerPhotoOffset);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [dragging, setDragging] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Track container size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset natural when src changes.
  useEffect(() => {
    setNatural(null);
  }, [src]);

  // Compute scaled image render size (cover) and max pan in percent of layer.
  const { maxX, maxY, renderW, renderH } = (() => {
    if (fit === "contain" || !natural || box.w === 0 || box.h === 0) {
      return { maxX: 0, maxY: 0, renderW: 0, renderH: 0 };
    }
    const scale = Math.max(box.w / natural.w, box.h / natural.h);
    const rW = natural.w * scale;
    const rH = natural.h * scale;
    const overflowXPct = ((rW - box.w) / box.w) * 100;
    const overflowYPct = ((rH - box.h) / box.h) * 100;
    return { maxX: overflowXPct / 2, maxY: overflowYPct / 2, renderW: rW, renderH: rH };
  })();

  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    width: number;
    height: number;
  } | null>(null);

  // Re-clamp current offset whenever bounds change (e.g. new image loaded).
  useEffect(() => {
    if (fit === "contain") return;
    const cx = Math.max(-maxX, Math.min(maxX, offsetX));
    const cy = Math.max(-maxY, Math.min(maxY, offsetY));
    if (cx !== offsetX || cy !== offsetY) {
      setLayerPhotoOffset(layerId, cx, cy);
    }
  }, [maxX, maxY, fit, layerId, offsetX, offsetY, setLayerPhotoOffset]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggable || fit === "contain") return;
      if (maxX === 0 && maxY === 0) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: offsetX,
        baseY: offsetY,
        width: rect.width,
        height: rect.height,
      };
      el.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [draggable, fit, offsetX, offsetY, maxX, maxY],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = dragStateRef.current;
      if (!s) return;
      const dxPct = ((e.clientX - s.startX) / s.width) * 100;
      const dyPct = ((e.clientY - s.startY) / s.height) * 100;
      const nextX = Math.max(-maxX, Math.min(maxX, s.baseX + dxPct));
      const nextY = Math.max(-maxY, Math.min(maxY, s.baseY + dyPct));
      setLayerPhotoOffset(layerId, nextX, nextY);
    },
    [layerId, setLayerPhotoOffset, maxX, maxY],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (el && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      dragStateRef.current = null;
      setDragging(false);
    },
    [],
  );

  const canPan = fit !== "contain" && draggable && (maxX > 0 || maxY > 0);

  // Perfect-circle clip from measured pixel size (so non-square layers still
  // render as a true circle, not an ellipse / cropped oval).
  const clipPath =
    shape === "circle" && box.w > 0 && box.h > 0
      ? `circle(${Math.min(box.w, box.h) / 2}px at 50% 50%)`
      : staticClipPath;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      style={{
        clipPath,
        cursor: canPan ? (dragging ? "grabbing" : "grab") : "default",
        touchAction: canPan ? "none" : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {src ? (
        fit === "contain" || !natural || renderW === 0 ? (
          <img
            ref={imgRef}
            src={src}
            alt=""
            onLoad={(e) => {
              const i = e.currentTarget;
              setNatural({ w: i.naturalWidth, h: i.naturalHeight });
            }}
            className={`absolute inset-0 w-full h-full ${
              fit === "contain" ? "object-contain" : "object-cover"
            }`}
            style={{ userSelect: "none", pointerEvents: "none" }}
            draggable={false}
          />
        ) : (
          // Cover mode: render the image at its full scaled size and pan it
          // within the container so the customer can reach the actual edges.
          // offsetX/Y are percent of the layer (box) size; convert to pixels
          // and add to the centered base position.
          <img
            ref={imgRef}
            src={src}
            alt=""
            onLoad={(e) => {
              const i = e.currentTarget;
              setNatural({ w: i.naturalWidth, h: i.naturalHeight });
            }}
            style={{
              position: "absolute",
              width: `${renderW}px`,
              height: `${renderH}px`,
              left: `${(box.w - renderW) / 2 + (offsetX / 100) * box.w}px`,
              top: `${(box.h - renderH) / 2 + (offsetY / 100) * box.h}px`,
              userSelect: "none",
              pointerEvents: "none",
              maxWidth: "none",
            }}
            draggable={false}
          />
        )
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/40 border-2 border-dashed border-foreground/30 text-[11px] text-muted-foreground text-center px-2">
          Ladda upp en bild
        </div>
      )}
    </div>
  );
}
