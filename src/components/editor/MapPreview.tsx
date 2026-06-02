import { useEffect, useRef, useState, useCallback } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEditorStore, type PhotoLayerValue } from "@/stores/editorStore";
import type { TemplateLayer } from "@/lib/template-schema";
import { MapLayerInstance } from "./layers/MapLayerInstance";
import { ImageLayerView, LineLayerView, MarginLayerView } from "./layers/StaticLayers";
import { TextLayerView } from "./layers/TextLayerView";
import { substituteTokensWithSpans, buildEffectiveTextWithSpans } from "@/lib/text-typography";
import { ShapeLayerView } from "./layers/ShapeLayerView";
import {
  lineThicknessPxFromCanvas,
  effectiveLayerRect,
  clampLayerRect,
  getActiveMarginInsetsPct,
} from "@/lib/layer-utils";
import { AcrylicCornerOverlay } from "./AcrylicCornerOverlay";

interface Props {
  frameColor?: string;
  frameWidthCm?: number;
  /** Posterhängare (trälist topp+botten + snöre) — preview only. */
  hangerColor?: string;
  innerPadding?: string;
  /** Canvas wrap depth in cm. */
  wrapCm?: number;
  /** When true, layer % are anchored to the FULL editor surface (front + 2×wrap)
   *  rather than just the front zone. Used by canvas templates that have a
   *  separate canvasLayout designed against the wrap-extended editor. */
  layersIncludeWrap?: boolean;
}

function parseCm(size: string | null): { w: number; h: number } | null {
  if (!size) return null;
  const m = size.match(/(\d+)\s*[xX×]\s*(\d+)/);
  if (!m) return null;
  return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
}

// Shape clipping (heart/star/circle) is centralized in `@/lib/shape-clip` so
// editor preview, admin thumbnail and print snapshot all share one source of
// truth and stay pixel-identical.
import { buildShapeClipPath, useShapeClip, type ClipShape } from "@/lib/shape-clip";
import { textureForHex } from "@/lib/frame-textures";

/**
 * Realistisk träram med mitred (45°) hörn.
 * Fyra trapets-sidor klipps via clip-path så hörnen möts i 45° — som en
 * riktig posterram (Gelato-stil). Sidornas grain roteras 90° så ådringen
 * löper längs varje list.
 */
function FrameBorder({
  borderPx,
  outerW,
  outerH,
  textureUrl,
  fallbackColor,
}: {
  borderPx: number;
  outerW: number;
  outerH: number;
  textureUrl: string | null;
  fallbackColor: string;
}) {
  if (borderPx <= 0 || outerW <= 0 || outerH <= 0) return null;
  const bp = borderPx;
  const bg: React.CSSProperties = textureUrl
    ? { backgroundImage: `url(${textureUrl})`, backgroundSize: "cover", backgroundRepeat: "no-repeat" }
    : { backgroundColor: fallbackColor };

  // Top + bottom: grain naturally horizontal — texture orientation matches list direction.
  const topStyle: React.CSSProperties = {
    ...bg,
    position: "absolute",
    top: -bp,
    left: -bp,
    width: outerW,
    height: bp,
    clipPath: `polygon(0 0, 100% 0, calc(100% - ${bp}px) 100%, ${bp}px 100%)`,
  };
  const bottomStyle: React.CSSProperties = {
    ...bg,
    position: "absolute",
    bottom: -bp,
    left: -bp,
    width: outerW,
    height: bp,
    clipPath: `polygon(${bp}px 0, calc(100% - ${bp}px) 0, 100% 100%, 0 100%)`,
  };

  // Left + right sides: rotate texture 90° so grain runs vertically along the list.
  // We render an inner <img>-sized div with dimensions (outerH × bp), rotated 90°,
  // positioned to fill a (bp × outerH) strip via clip-path mitre.
  const sideClipLeft = `polygon(0 0, 100% ${bp}px, 100% calc(100% - ${bp}px), 0 100%)`;
  const sideClipRight = `polygon(0 ${bp}px, 100% 0, 100% 100%, 0 calc(100% - ${bp}px))`;

  const sideInnerBg = (rotateDeg: number, translateX: number, translateY: number): React.CSSProperties => ({
    ...bg,
    position: "absolute",
    width: outerH,
    height: bp,
    top: 0,
    left: 0,
    transformOrigin: "top left",
    transform: `translate(${translateX}px, ${translateY}px) rotate(${rotateDeg}deg)`,
  });

  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 55 }} aria-hidden>
      {/* Drop shadow behind the frame (drawn first, below sides) */}
      <div
        style={{
          position: "absolute",
          inset: -bp,
          boxShadow: "0 8px 22px -6px rgba(0,0,0,0.32), 0 18px 40px -14px rgba(0,0,0,0.22)",
        }}
      />
      <div style={topStyle} />
      <div style={bottomStyle} />
      {/* Left strip */}
      <div
        style={{
          position: "absolute",
          top: -bp,
          left: -bp,
          width: bp,
          height: outerH,
          clipPath: sideClipLeft,
          overflow: "hidden",
        }}
      >
        {/* rotate(90) around (0,0) maps (x,y) -> (-y,x); translate by (bp, 0) places result in bp×outerH strip */}
        <div style={sideInnerBg(90, bp, 0)} />
      </div>
      {/* Right strip */}
      <div
        style={{
          position: "absolute",
          top: -bp,
          right: -bp,
          width: bp,
          height: outerH,
          clipPath: sideClipRight,
          overflow: "hidden",
        }}
      >
        <div style={sideInnerBg(90, bp, 0)} />
      </div>
      {/* Soft 45° highlight overlay for depth */}
      <div
        style={{
          position: "absolute",
          inset: -bp,
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0) 45%, rgba(0,0,0,0.22))",
          mixBlendMode: "overlay",
        }}
      />
      {/* Inner shadow rim where frame meets the print */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.28), inset 0 2px 6px -2px rgba(0,0,0,0.38)",
        }}
      />
    </div>
  );
}

/**
 * Posterhängare: tunna trälister topp+botten + snöre.
 * Listerna placeras UTANFÖR motivets topp/botten så de inte täcker tryckytan.
 * Tjockleken skalas efter motivets verkliga höjd: Gelatos hängare har fast
 * 14 mm front (oavsett posterstorlek), så större postrar → relativt tunnare list.
 */
function HangerOverlay({ color, textureUrl, motifHeightCm }: { color: string; textureUrl: string | null; motifHeightCm: number }) {
  const isWhite = color.toLowerCase() === "#f5f5f2";
  // 21 mm = 2.1 cm fysisk listhöjd (Gelato-spec). Procent av motivets höjd.
  const slatPct = Math.max(0.8, (2.1 / Math.max(motifHeightCm, 1)) * 100);
  // Snörets båghöjd i cm, beroende av posterstorlek (men begränsad så det
  // varken blir för platt på stora eller för högt på små postrar).
  const cordRiseCm = Math.min(6, Math.max(2.5, motifHeightCm * 0.06));
  const cordRisePct = (cordRiseCm / Math.max(motifHeightCm, 1)) * 100;
  // Snörets fästpunkter på listen — nära ytterkanterna.
  const anchorXPct = 6; // % från vänsterkant av listen (matchar slatStyle left:-2%)

  const slatStyle: React.CSSProperties = {
    position: "absolute",
    left: "-2%",
    right: "-2%",
    height: `${slatPct}%`,
    background: color,
    backgroundImage: textureUrl
      ? `linear-gradient(to bottom, rgba(255,255,255,0.18), rgba(255,255,255,0) 50%, rgba(0,0,0,0.28)), url(${textureUrl})`
      : "linear-gradient(to bottom, rgba(255,255,255,0.22), rgba(255,255,255,0) 50%, rgba(0,0,0,0.28))",
    backgroundSize: textureUrl ? "auto, cover" : undefined,
    backgroundRepeat: textureUrl ? "repeat, no-repeat" : undefined,
    boxShadow: "0 4px 8px rgba(0,0,0,0.28)",
    border: isWhite ? "1px solid rgba(0,0,0,0.18)" : undefined,
  };
  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 46, overflow: "visible" }} aria-hidden>
      {/* Snöre — fäst på topp-listens ÖVERKANT (= motivets överkant), triangulär form (spik) */}
      <svg
        className="absolute"
        style={{
          left: "-2%",
          width: "104%",
          top: `-${cordRisePct}%`,
          height: `${cordRisePct}%`,
          overflow: "visible",
        }}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <path
          d={`M ${anchorXPct} 100 L 50 0 L ${100 - anchorXPct} 100`}
          fill="none"
          stroke="rgba(40,30,20,0.82)"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ strokeWidth: Math.max(1.5, slatPct * 1.2) }}
        />
      </svg>
      {/* Trälist OVANPÅ motivets topp (täcker översta 21mm av tryckytan) */}
      <div style={{ ...slatStyle, top: 0 }} />
      {/* Trälist OVANPÅ motivets botten (täcker nedersta 21mm av tryckytan) */}
      <div style={{ ...slatStyle, bottom: 0 }} />
    </div>
  );
}

function shapeClipPath(shape: string): string | undefined {
  // Pre-measurement fallback. Real pixel-accurate clip is produced by
  // `useShapeClip` once the host element is laid out (1 frame later).
  // Returning `undefined` for non-rect shapes briefly shows the unclipped
  // rect, but in practice ResizeObserver fires synchronously before paint.
  if (shape === "rect") return undefined;
  return undefined;
}

// (Per-shape pixel-accurate clip is built via `useShapeClip` from
// `@/lib/shape-clip` directly inside MapLayerSlot / PhotoLayerView.)

export function MapPreview({
  frameColor,
  frameWidthCm = 2,
  hangerColor,
  innerPadding,
  wrapCm = 0,
  layersIncludeWrap = false,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [borderPx, setBorderPx] = useState(0);
  const [frameShortPx, setFrameShortPx] = useState(0);
  const [frameOuter, setFrameOuter] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const {
    config,
    orientation,
    size,
    posterBgColor,
    templateLayers,
    layerValues,
    layerTransforms,
    setLayerTransform,
    photoSources,
    photoAiResults,
    aiPhotoResults,
    aiPhotoSelectedRefUrl,
    whiteMarginEnabled,
  } = useEditorStore();
  const isAcrylic = config?.product_type === "acrylic";

  const allLayers = templateLayers();
  // Center-alignment guides shown while dragging a layer (in % of editor).
  const [guides, setGuides] = useState<{ h: boolean; v: boolean }>({ h: false, v: false });

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
  const frontInsetX = wrapCm > 0 && !layersIncludeWrap ? wrapCm / editorW : 0;
  const frontInsetY = wrapCm > 0 && !layersIncludeWrap ? wrapCm / editorH : 0;

  // Derive margin insets and (when customer hides margin) filter the margin
  // layer + remap remaining layers so they fill the freed-up area.
  const marginInsets = getActiveMarginInsetsPct(allLayers, frontW, frontH);
  const marginRemovedInsets = !whiteMarginEnabled ? marginInsets : undefined;
  // Margin must always render visually on top of all other layers (but its
  // wrapper still has pointer-events:none so it never blocks clicks).
  const visibleLayers = whiteMarginEnabled ? allLayers : allLayers.filter((l) => l.type !== "margin");
  const layers = [
    ...visibleLayers.filter((l) => l.type !== "margin"),
    ...visibleLayers.filter((l) => l.type === "margin"),
  ];

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      const shortPx = Math.min(rect.width, rect.height);
      setFrameShortPx(shortPx);
      setFrameOuter({ w: rect.width, h: rect.height });
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
  // Innehållsdriven storlek: ingen vh. Postern är width-driven (width:100% +
  // aspectRatio) men cappad så att höjden inte överstiger desktopens
  // preview-höjd (~720px). Formeln maxWidth = aspect * 720px funkar på
  // både mobil (smal skärm → 100% vinner) och desktop (h-[720px] container).
  const DESKTOP_MAX_H = 820;
  const frameTextureUrl = textureForHex(frameColor);
  const hangerTextureUrl = textureForHex(hangerColor);
  const frameStyle: React.CSSProperties = {
    aspectRatio: `${posterAspect}`,
    width: "100%",
    height: "auto",
    maxWidth: `min(100%, ${posterAspect * DESKTOP_MAX_H}px)`,
    background: posterBgColor,
    // Border keeps layout space for the frame; visual frame is rendered via
    // <FrameBorder> overlay (textured + mitred corners). Transparent border
    // preserves print-area sizing without the old flat color band.
    borderStyle: frameColor ? "solid" : undefined,
    borderColor: "transparent",
    borderWidth: frameColor ? `${borderPx}px` : 0,
    padding: innerPadding,
    boxSizing: "border-box",
    // Lokal stacking context — alla interna z-index (inkl. akrylskruvar)
    // begränsas till ramen och kan inte krocka med dialoger / thumbnails.
    isolation: "isolate",
  };

  const layerToEditorRect = (l: TemplateLayer) => {
    const eff = effectiveLayerRect(l, layerTransforms, { marginRemovedInsets });
    let left = (frontInsetX + (eff.xPct / 100) * (1 - 2 * frontInsetX)) * 100;
    let top = (frontInsetY + (eff.yPct / 100) * (1 - 2 * frontInsetY)) * 100;
    let width = (eff.wPct / 100) * (1 - 2 * frontInsetX) * 100;
    let height = (eff.hPct / 100) * (1 - 2 * frontInsetY) * 100;
    // Bleed/wrap extension for front-relative full-bleed media: any layer
    // touching a front edge auto-extends out into the wrap band so the
    // canvas sides never look empty regardless of which size is selected.
    const BLEED_EPS = 0.5;
    const bleedEligible =
      wrapCm > 0 &&
      !layersIncludeWrap &&
      (l.type === "map" || l.type === "image" || l.type === "photo" || l.type === "aiPhoto");
    if (bleedEligible) {
      const extX = frontInsetX * 100;
      const extY = frontInsetY * 100;
      if (eff.xPct <= BLEED_EPS) {
        left -= extX;
        width += extX;
      }
      if (eff.yPct <= BLEED_EPS) {
        top -= extY;
        height += extY;
      }
      if (eff.xPct + eff.wPct >= 100 - BLEED_EPS) {
        width += extX;
      }
      if (eff.yPct + eff.hPct >= 100 - BLEED_EPS) {
        height += extY;
      }
    }
    return { left, top, width, height };
  };

  // Pointer-drag handler attached to the wrapper div of any draggable layer.
  // Translates pixel deltas → % of editor canvas, snaps to center (h/v) when
  // close, and clamps so the layer never crosses the editor edges.
  const SNAP_PCT = 0.6; // distance from center where we snap
  const onDragStart = useCallback(
    (l: TemplateLayer, e: React.PointerEvent<Element>) => {
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
        let snapH = false,
          snapV = false;
        if (Math.abs(nx - centerXTarget) < SNAP_PCT) {
          nx = centerXTarget;
          snapV = true;
        }
        if (Math.abs(ny - centerYTarget) < SNAP_PCT) {
          ny = centerYTarget;
          snapH = true;
        }
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
  // Visual marker for the synlig front zone — always reflects wrapCm regardless
  // of whether layers are anchored to front or full-area.
  const frontMarkerInsetX = wrapCm > 0 ? wrapCm / editorW : 0;
  const frontMarkerInsetY = wrapCm > 0 ? wrapCm / editorH : 0;
  const frontZoneStyle: React.CSSProperties = {
    position: "absolute",
    left: `${frontMarkerInsetX * 100}%`,
    top: `${frontMarkerInsetY * 100}%`,
    right: `${frontMarkerInsetX * 100}%`,
    bottom: `${frontMarkerInsetY * 100}%`,
  };

  return (
    <div className="w-full flex flex-col items-center justify-center p-4 gap-2">
      <style>{`
        .mapboxgl-ctrl-logo, .mapboxgl-ctrl-attrib { display: none !important; }
      `}</style>
      <div ref={frameRef} className="relative shadow-[0_30px_60px_-20px_rgba(0,0,0,0.25)]" style={frameStyle}>
        {/* Loop all template layers in zIndex order */}
        {layers.map((l) => {
          const rect = layerToEditorRect(l);
          // Only layers that actually need pointer interaction in the
          // customer preview should catch clicks/drags. Otherwise an
          // overlapping decorative layer (text/image, or a locked map) ends
          // up blocking pan on the photo layer underneath. Text editing
          // happens in ControlPanel; images are admin static; locked maps
          // shouldn't intercept pan either. margin/line/shape already opt
          // out further down.
          const isInteractiveLayer =
            (l.type === "photo" || l.type === "aiPhoto") ||
            (l.type === "map" && !l.locks.position);
          const wrapStyle: React.CSSProperties = {
            position: "absolute",
            left: `${rect.left}%`,
            top: `${rect.top}%`,
            width: `${rect.width}%`,
            height: `${rect.height}%`,
            zIndex: l.type === "margin" ? 40 : l.zIndex,
            pointerEvents: isInteractiveLayer ? undefined : "none",
          };
          const movable =
            !l.locks.move &&
            (l.type === "map" || l.type === "photo" || l.type === "aiPhoto" || l.type === "text" || l.type === "image");
          const moveHandle = movable ? (
            <button
              type="button"
              onPointerDown={(e) => onDragStart(l, e)}
              className="absolute w-7 h-7 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center text-[12px] cursor-move touch-none ring-2 ring-background"
              style={{ top: -14, left: -14, zIndex: 39, pointerEvents: "auto" }}
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
            const effectiveCenter: [number, number] = mv?.center ?? [l.defaults.center[0]!, l.defaults.center[1]!];
            const effectiveZoom = mv?.zoom ?? l.defaults.zoom;
            const effectiveLabels = mv?.showLabels ?? l.defaults.showLabels;
            const staticClip = shapeClipPath(effectiveShape);
            return (
              <MapLayerSlot
                key={l.id}
                wrapStyle={wrapStyle}
                shape={effectiveShape}
                staticClip={staticClip}
                overlay={moveHandle}
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
            const effectiveShape = (pv?.shape ?? l.defaults.shape) as "rect" | "circle" | "heart" | "star";
            const offsetX = pv?.offsetX ?? 0;
            const offsetY = pv?.offsetY ?? 0;
            const staticClip = shapeClipPath(effectiveShape);
            const src = photoAiResults[l.id] ?? photoSources[l.id]?.previewUrl ?? l.defaults.placeholderUrl ?? null;
            return (
              <MapLayerSlot
                key={l.id}
                wrapStyle={wrapStyle}
                shape={effectiveShape}
                staticClip={staticClip}
                overlay={moveHandle}
              >
                {(clip) => (
                  <PhotoLayerView
                    layerId={l.id}
                    src={src}
                    fit={l.defaults.fit}
                    shape={effectiveShape}
                    staticClipPath={clip}
                    offsetX={offsetX}
                    offsetY={offsetY}
                    draggable={!!src}
                  />
                )}
              </MapLayerSlot>
            );
          }

          if (l.type === "aiPhoto") {
            const v = layerValues[l.id];
            const av = v && v.kind === "aiPhoto" ? v : null;
            const effectiveShape = (av?.shape ?? l.defaults.shape) as "rect" | "circle" | "heart" | "star";
            const staticClip = shapeClipPath(effectiveShape);
            // Source priority: face-swap result → customer-selected reference
            // (when admin uploaded multiple) → admin reference image → empty.
            const aiResultUrl = aiPhotoResults[l.id] ?? null;
            const selectedRefUrl = aiPhotoSelectedRefUrl[l.id] ?? null;
            // Resolve the active reference item, filtered by current
            // orientation so a stale portrait selection doesn't render
            // when the canvas is now in landscape (and vice versa).
            const refList = l.defaults.referenceImages ?? [];
            const orientationMatches = refList.filter((r) => {
              const o = (r as { orientation?: string }).orientation ?? "any";
              return o === "any" || o === orientation;
            });
            const activeRefUrl =
              (selectedRefUrl && orientationMatches.some((r) => r.url === selectedRefUrl)
                ? selectedRefUrl
                : null)
              ?? orientationMatches[0]?.url
              ?? l.defaults.referenceImageUrl
              ?? null;
            const src = aiResultUrl ?? activeRefUrl;
            const activeRef = activeRefUrl ? (refList.find((r) => r.url === activeRefUrl) ?? null) : null;
            const refFocalX = activeRef?.focalX ?? 0;
            const refFocalY = activeRef?.focalY ?? 0;
            // If the visible image is the admin reference or its swap result,
            // honor the admin-chosen focal. Otherwise (no AI result, no ref —
            // e.g. removeBackground placeholder) fall back to layer offset.
            const usingRefOrSwap = !!(aiResultUrl || activeRefUrl);
            const offsetX = usingRefOrSwap ? refFocalX : (av?.offsetX ?? 0);
            const offsetY = usingRefOrSwap ? refFocalY : (av?.offsetY ?? 0);
            // Only force `contain` for removeBackground (Nano Banana 2 doesn't
            // always honor target aspect ratio, and its pure-white padding
            // blends seamlessly into the layer). For human face-swap (Replicate
            // returns the same dimensions as the reference image) and pet swap
            // (prompt enforces same aspect ratio as the reference), use the
            // layer's default fit so the result fills the layer exactly like
            // the reference image did — no empty edges.
            const aiSubjectKind = l.defaults.subjectKind ?? "human";
            const effectiveFit = aiResultUrl && aiSubjectKind === "removeBackground" ? "contain" : l.defaults.fit;
            return (
              <MapLayerSlot
                key={l.id}
                wrapStyle={wrapStyle}
                shape={effectiveShape}
                staticClip={staticClip}
                overlay={moveHandle}
              >
                {(clip) =>
                  src ? (
                    <PhotoLayerView
                      layerId={l.id}
                      src={src}
                      fit={effectiveFit}
                      shape={effectiveShape}
                      staticClipPath={clip}
                      offsetX={offsetX}
                      offsetY={offsetY}
                      draggable={!!src && !usingRefOrSwap}
                    />
                  ) : (
                    <div
                      className={`w-full h-full flex flex-col items-center justify-center gap-1 text-center px-2 bg-accent/30 rounded${
                        effectiveShape === "rect" ? " border-2 border-dashed border-primary/40" : ""
                      }`}
                      style={{ clipPath: clip }}
                    >
                      <span className="text-base">✨</span>
                      <span className="text-[10px] text-muted-foreground leading-tight">
                        AI-bild visas här efter Skapa nu
                      </span>
                    </div>
                  )
                }
              </MapLayerSlot>
            );
          }

          if (l.type === "text") {
            const v = layerValues[l.id];
            const tv = v && v.kind === "text" ? v : null;
            if (tv && !tv.visible) return null;
            const d = l.defaults;
            // If user customised the text, render it raw. Otherwise substitute
            // [[city]]/[[country]]/[[coords]] tokens using the linked map's
            // current value — so tokens never appear as literal text on first
            // load (before any pan/zoom).
            const mapId = d.linkedMapLayerId;
            const mv = mapId ? layerValues[mapId] : null;
            const place =
              mv && mv.kind === "map"
                ? {
                    placeName: mv.placeName,
                    city: mv.city ?? null,
                    country: mv.country ?? null,
                    center: mv.center,
                  }
                : null;
            const { text: effectiveText, spans: effectiveSpans } = buildEffectiveTextWithSpans(
              d,
              place,
              tv?.overrideText ?? null,
            );
            const effectiveFont = tv?.font || d.font;
            const layerHeightPx = (l.hPct / 100) * (frameShortPx > 0 ? frameShortPx : 0);
            return (
              <div key={l.id} style={wrapStyle}>
                <TextLayerView
                  layer={l}
                  effectiveText={effectiveText}
                  effectiveFont={effectiveFont}
                  effectiveSpans={effectiveSpans}
                  canvasShortPx={frameShortPx}
                  layerHeightPx={layerHeightPx}
                />
                {moveHandle}
              </div>
            );
          }

          if (l.type === "image") {
            return (
              <div key={l.id} style={wrapStyle}>
                <ImageLayerView layer={l} />
                {moveHandle}
              </div>
            );
          }

          if (l.type === "line") {
            // Customer never interacts with lines (admin-locked) — let clicks
            // pass through the wrapper to layers underneath.
            return (
              <div key={l.id} style={{ ...wrapStyle, pointerEvents: "none" }}>
                <LineLayerView layer={l} thicknessPx={lineThicknessPxFromCanvas(l, frameShortPx)} />
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
            className="absolute pointer-events-none border-2 border-dashed"
            style={{
              ...frontZoneStyle,
              borderColor: "hsl(var(--primary))",
              boxShadow: "0 0 0 1px hsl(var(--background) / 0.9), inset 0 0 0 1px hsl(var(--background) / 0.9)",
              zIndex: 41,
            }}
          >
            <span
              className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full px-2 py-0.5 text-[10px] uppercase tracking-wider rounded whitespace-nowrap font-semibold shadow"
              style={{
                background: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
                zIndex: 42,
              }}
            >
              Synlig framsida · innehållet här viks om på sidorna
            </span>
          </div>
        )}

        {/* Center alignment guides (shown only while dragging snaps) */}
        {guides.v && (
          <div
            className="absolute pointer-events-none top-0 bottom-0 left-1/2 -translate-x-1/2 border-l border-dashed border-primary"
            style={{ zIndex: 10000 }}
          />
        )}
        {guides.h && (
          <div
            className="absolute pointer-events-none left-0 right-0 top-1/2 -translate-y-1/2 border-t border-dashed border-primary"
            style={{ zIndex: 10000 }}
          />
        )}
        {isAcrylic && (
          <div className="pointer-events-none absolute inset-0" style={{ zIndex: 45 }} aria-hidden>
            <AcrylicCornerOverlay frontWcm={frontW} frontHcm={frontH} zIndex={45} />
          </div>
        )}
        {hangerColor && <HangerOverlay color={hangerColor} textureUrl={hangerTextureUrl} motifHeightCm={frontH} />}
        {frameColor && borderPx > 0 && (
          <FrameBorder
            borderPx={borderPx}
            outerW={frameOuter.w}
            outerH={frameOuter.h}
            textureUrl={frameTextureUrl}
            fallbackColor={frameColor}
          />
        )}
      </div>
      {allLayers.some((l) => l.type === "map") && (
        <p className="text-[10px] text-muted-foreground">© Mapbox · © OpenStreetMap</p>
      )}
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
  shape,
  staticClip,
  children,
  overlay,
}: {
  wrapStyle: React.CSSProperties;
  shape: ClipShape;
  staticClip: string | undefined;
  children: (clip: string | undefined) => React.ReactNode;
  overlay?: React.ReactNode;
}) {
  const { ref, clipPath } = useShapeClip(shape);
  const effectiveClip = clipPath ?? staticClip;
  return (
    <div ref={ref} style={wrapStyle}>
      {children(effectiveClip)}
      {overlay}
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
  // Skip the store writeback when the offset is read-only (admin focal on
  // reference/swap images) — we just clamp inline for rendering instead.
  useEffect(() => {
    if (fit === "contain" || !draggable) return;
    const cx = Math.max(-maxX, Math.min(maxX, offsetX));
    const cy = Math.max(-maxY, Math.min(maxY, offsetY));
    if (cx !== offsetX || cy !== offsetY) {
      setLayerPhotoOffset(layerId, cx, cy);
    }
  }, [maxX, maxY, fit, layerId, offsetX, offsetY, setLayerPhotoOffset, draggable]);

  // Clamped values used purely for rendering (covers both draggable and
  // read-only focal cases — image never escapes its own bounds).
  const renderOffsetX = fit === "contain" ? 0 : Math.max(-maxX, Math.min(maxX, offsetX));
  const renderOffsetY = fit === "contain" ? 0 : Math.max(-maxY, Math.min(maxY, offsetY));

  // Dev-only diagnostics — printed when key values change so we can verify
  // pan eligibility for any uploaded image / layer geometry combo.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // eslint-disable-next-line no-console
    console.log("[PhotoLayerView]", layerId, {
      hasSrc: !!src,
      fit,
      draggable,
      box,
      natural,
      maxX: Math.round(maxX * 10) / 10,
      maxY: Math.round(maxY * 10) / 10,
      offsetX: Math.round(offsetX * 10) / 10,
      offsetY: Math.round(offsetY * 10) / 10,
    });
  }, [layerId, src, fit, draggable, box, natural, maxX, maxY, offsetX, offsetY]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggable || fit === "contain") {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.log("[PhotoLayerView] pointerDown bail", layerId, { draggable, fit });
        }
        return;
      }
      if (maxX === 0 && maxY === 0) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.log("[PhotoLayerView] pointerDown bail (no overflow)", layerId, { maxX, maxY, box, natural });
        }
        return;
      }
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
    [draggable, fit, offsetX, offsetY, maxX, maxY, layerId, box, natural],
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

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (el && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    dragStateRef.current = null;
    setDragging(false);
  }, []);

  const canPan = fit !== "contain" && draggable && (maxX > 0 || maxY > 0);

  // Pixel-accurate clip path so heart/star/circle keep their natural 1:1
  // aspect ratio inscribed inside the container's shortest side — even when
  // the layer rect is non-square. Falls back to the (undefined) static clip
  // for the very first paint before the ResizeObserver fires.
  const measuredClip = box.w > 0 && box.h > 0 ? buildShapeClipPath(shape, box.w, box.h) : undefined;
  const clipPath = measuredClip ?? staticClipPath;

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
            className={`absolute inset-0 w-full h-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
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
              left: `${(box.w - renderW) / 2 + (renderOffsetX / 100) * box.w}px`,
              top: `${(box.h - renderH) / 2 + (renderOffsetY / 100) * box.h}px`,
              userSelect: "none",
              pointerEvents: "none",
              maxWidth: "none",
            }}
            draggable={false}
          />
        )
      ) : (
        <div
          className={`absolute inset-0 flex items-center justify-center bg-muted/40 text-[11px] text-muted-foreground text-center px-2${
            shape === "rect" ? " border-2 border-dashed border-foreground/30" : ""
          }`}
        >
          Ladda upp en bild
        </div>
      )}
    </div>
  );
}
