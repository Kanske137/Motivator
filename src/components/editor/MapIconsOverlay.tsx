// Overlay rendered on top of a single map layer. Owns:
//   - Cursor-following ghost icon when the customer has picked an icon from
//     the ControlPanel picker (activeIconTool).
//   - Placement on left-click within the layer's shape boundary.
//   - Render of placed icons + click-to-select with a tiny trash popover.
import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEditorStore, type MapIcon } from "@/stores/editorStore";
import { isPointInShape, type ClipShape } from "@/lib/shape-clip";
import { getMapIcon } from "@/lib/map-icon-catalog";

interface Props {
  layerId: string;
  shape: ClipShape;
  icons: MapIcon[];
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

export function MapIconsOverlay({ layerId, shape, icons }: Props) {
  const { t } = useTranslation();
  const activeIconTool = useEditorStore((s) => s.activeIconTool);
  const setActiveIconTool = useEditorStore((s) => s.setActiveIconTool);
  const selectedMapIcon = useEditorStore((s) => s.selectedMapIcon);
  const setSelectedMapIcon = useEditorStore((s) => s.setSelectedMapIcon);
  const addMapIcon = useEditorStore((s) => s.addMapIcon);
  const removeMapIcon = useEditorStore((s) => s.removeMapIcon);

  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number; inside: boolean } | null>(null);

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

  const iconPx = useMemo(() => Math.max(16, Math.min(box.w, box.h) * 0.06), [box]);
  const ghostPx = Math.max(24, iconPx);
  const toolActive = !!activeIconTool;

  // Close trash popover on outside-click (anywhere outside this layer overlay).
  useEffect(() => {
    if (!selectedMapIcon || selectedMapIcon.layerId !== layerId) return;
    const onDown = (e: MouseEvent) => {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setSelectedMapIcon(null);
      }
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
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (!isPointInShape(shape, r.width, r.height, x, y)) return;
    e.preventDefault();
    e.stopPropagation();
    const xPct = (x / r.width) * 100;
    const yPct = (y / r.height) * 100;
    const id =
      (typeof crypto !== "undefined" && (crypto as { randomUUID?: () => string }).randomUUID?.()) ??
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    addMapIcon(layerId, { id, iconId: activeIconTool!.iconId, xPct, yPct });
    setActiveIconTool(null);
    setCursor(null);
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{
        // When tool active: own all pointer events on top of Mapbox so click
        // lands here (and we stop propagation). When inactive: let map breathe;
        // placed icons opt back in via pointer-events:auto on their <button>.
        pointerEvents: toolActive ? "auto" : "none",
        cursor: toolActive ? (cursor?.inside ? "crosshair" : "not-allowed") : undefined,
        zIndex: 30,
      }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={onClickPlace}
    >
      {/* Placed icons */}
      {icons.map((ic) => {
        const isSelected =
          selectedMapIcon?.layerId === layerId && selectedMapIcon?.iconId === ic.id;
        return (
          <div
            key={ic.id}
            className="absolute"
            style={{
              left: `${ic.xPct}%`,
              top: `${ic.yPct}%`,
              transform: "translate(-50%, -50%)",
              pointerEvents: "auto",
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (toolActive) return;
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
                onClick={(e) => {
                  e.stopPropagation();
                  removeMapIcon(layerId, ic.id);
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
