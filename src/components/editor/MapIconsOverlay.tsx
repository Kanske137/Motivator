// Overlay rendered on top of a single map layer. Owns:
//   - Cursor-following ghost icon when the customer has picked an icon from
//     the ControlPanel picker (activeIconTool).
//   - Placement on left-click — anchors icon to a geographic point (lng/lat)
//     using map.unproject so it sticks to the map under pan/zoom.
//   - Render of placed icons re-projected via map.project on every move/zoom.
//   - Click-to-select with a tiny trash popover for deletion.
import { useEffect, useMemo, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEditorStore, type MapIcon } from "@/stores/editorStore";
import { isPointInShape, type ClipShape } from "@/lib/shape-clip";
import { getMapIcon } from "@/lib/map-icon-catalog";

interface Props {
  layerId: string;
  shape: ClipShape;
  icons: MapIcon[];
  /** Returns the Mapbox instance for THIS layer (or null while map mounting). */
  getMap: () => mapboxgl.Map | null;
}

function IconSvg({ iconId, sizePx, color = "#111" }: { iconId: string; sizePx: number; color?: string }) {
  const def = getMapIcon(iconId);
  if (!def) return null;
  return (
    <svg
      width={sizePx}
      height={sizePx}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {def.iconNode.map(([tag, attrs], i) => {
        const props = { key: i, ...(attrs as Record<string, unknown>) } as Record<string, unknown>;
        if (tag === "path") return <path {...props} />;
        if (tag === "circle") return <circle {...props} />;
        if (tag === "rect") return <rect {...props} />;
        if (tag === "line") return <line {...props} />;
        return null;
      })}
    </svg>
  );
}

export function MapIconsOverlay({ layerId, shape, icons, getMap }: Props) {
  const { t } = useTranslation();
  const activeIconTool = useEditorStore((s) => s.activeIconTool);
  const setActiveIconTool = useEditorStore((s) => s.setActiveIconTool);
  const selectedMapIcon = useEditorStore((s) => s.selectedMapIcon);
  const setSelectedMapIcon = useEditorStore((s) => s.setSelectedMapIcon);
  const addMapIcon = useEditorStore((s) => s.addMapIcon);
  const removeMapIcon = useEditorStore((s) => s.removeMapIcon);
  const replaceMapIcon = useEditorStore((s) => s.replaceMapIcon);

  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number; inside: boolean } | null>(null);
  // Bumps every Mapbox move/zoom so we re-project placed icons.
  const [, setMapTick] = useState(0);

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

  // Subscribe to map move/zoom so placed icons re-project. Re-subscribes when
  // the map instance becomes available (polling once via short interval until
  // ready, then attaches handlers).
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    const attach = () => {
      if (cancelled) return;
      const map = getMap();
      if (!map) {
        // Retry briefly while the map mounts.
        const t = window.setTimeout(attach, 120);
        cleanup = () => window.clearTimeout(t);
        return;
      }
      const onChange = () => setMapTick((n) => (n + 1) & 0xffff);
      map.on("move", onChange);
      map.on("zoom", onChange);
      map.on("resize", onChange);
      // Trigger one initial projection.
      onChange();
      cleanup = () => {
        try {
          map.off("move", onChange);
          map.off("zoom", onChange);
          map.off("resize", onChange);
        } catch {
          /* map already removed */
        }
      };
    };
    attach();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [getMap]);

  const iconPx = useMemo(() => Math.max(16, Math.min(box.w, box.h) * 0.06), [box]);
  const ghostPx = Math.max(24, iconPx);
  const toolActive = !!activeIconTool;

  // Close trash popover on outside-mousedown. We mark our own popover button
  // with data-map-icon-ui so the listener can ignore clicks on it.
  useEffect(() => {
    if (!selectedMapIcon || selectedMapIcon.layerId !== layerId) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-map-icon-ui="1"]')) return;
      const el = containerRef.current;
      if (el && el.contains(target)) return;
      setSelectedMapIcon(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [selectedMapIcon, layerId, setSelectedMapIcon]);

  // ESC cancels active tool / selection.
  useEffect(() => {
    if (!toolActive && !selectedMapIcon) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveIconTool(null);
        setSelectedMapIcon(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toolActive, selectedMapIcon, setActiveIconTool, setSelectedMapIcon]);

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!toolActive) return;
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const inside = isPointInShape(shape, r.width, r.height, x, y);
    setCursor({ x, y, inside });
  };

  const onPointerLeave = () => setCursor(null);

  const onClickPlace = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!toolActive) return;
    if (selectedMapIcon) return;
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (!isPointInShape(shape, r.width, r.height, x, y)) return;
    e.preventDefault();
    e.stopPropagation();
    const map = getMap();
    if (!map) return;
    const ll = map.unproject([x, y]);
    const id =
      (typeof crypto !== "undefined" && (crypto as { randomUUID?: () => string }).randomUUID?.()) ??
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    addMapIcon(layerId, { id, iconId: activeIconTool!.iconId, lng: ll.lng, lat: ll.lat });
    setActiveIconTool(null);
    setCursor(null);
  };

  // Compute pixel position for every placed icon. Upgrades legacy xPct/yPct
  // icons to lng/lat on first projection.
  const map = getMap();
  const placed = icons.map((ic) => {
    if (typeof ic.lng === "number" && typeof ic.lat === "number") {
      if (!map) return { ic, px: null as { x: number; y: number } | null };
      const p = map.project([ic.lng, ic.lat]);
      return { ic, px: { x: p.x, y: p.y } };
    }
    // Legacy: derive from xPct/yPct using current box, then persist as lng/lat.
    if (typeof ic.xPct === "number" && typeof ic.yPct === "number" && map && box.w && box.h) {
      const x = (ic.xPct / 100) * box.w;
      const y = (ic.yPct / 100) * box.h;
      const ll = map.unproject([x, y]);
      // Schedule upgrade outside render.
      queueMicrotask(() => {
        replaceMapIcon(layerId, ic.id, { lng: ll.lng, lat: ll.lat });
      });
      return { ic, px: { x, y } };
    }
    return { ic, px: null };
  });

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{
        pointerEvents: toolActive ? "auto" : "none",
        cursor: toolActive ? (cursor?.inside ? "crosshair" : "not-allowed") : undefined,
        zIndex: 30,
      }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={onClickPlace}
    >
      {/* Placed icons */}
      {placed.map(({ ic, px }) => {
        if (!px) return null;
        const isSelected =
          selectedMapIcon?.layerId === layerId && selectedMapIcon?.iconId === ic.id;
        return (
          <div
            key={ic.id}
            className="absolute"
            style={{
              left: px.x,
              top: px.y,
              transform: "translate(-50%, -50%)",
              pointerEvents: "auto",
            }}
          >
            <button
              type="button"
              data-map-icon-ui="1"
              onPointerDown={(e) => {
                if (toolActive) return;
                e.preventDefault();
                e.stopPropagation();
                setSelectedMapIcon({ layerId, iconId: ic.id });
              }}
              className="block bg-transparent border-0 p-0 cursor-pointer"
              style={{ lineHeight: 0 }}
              aria-label={t("mapIcons.select", { defaultValue: "Markera ikon" })}
            >
              <IconSvg iconId={ic.iconId} sizePx={iconPx} />
            </button>
            {isSelected && (
              <button
                type="button"
                data-map-icon-ui="1"
                onPointerDown={(e) => {
                  // Use pointerdown so we win over the document mousedown
                  // outside-listener race.
                  e.preventDefault();
                  e.stopPropagation();
                  removeMapIcon(layerId, ic.id);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-destructive text-destructive-foreground shadow-lg flex items-center justify-center ring-2 ring-background"
                style={{ pointerEvents: "auto" }}
                aria-label={t("mapIcons.delete", { defaultValue: "Radera ikon" })}
                title={t("mapIcons.delete", { defaultValue: "Radera ikon" })}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        );
      })}

      {/* Ghost cursor preview */}
      {toolActive && cursor?.inside && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: cursor.x,
            top: cursor.y,
            transform: "translate(-50%, -50%)",
            opacity: 0.7,
            lineHeight: 0,
          }}
          aria-hidden
        >
          <IconSvg iconId={activeIconTool!.iconId} sizePx={ghostPx} />
        </div>
      )}
    </div>
  );
}
