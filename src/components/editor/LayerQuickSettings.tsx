// Per-lager mini-inställning för fri-mall: kund kan ändra typ av form
// (rektangel/oval/rundad/dubbel/hörn) eller orientering på linje, samt färg
// och tjocklek. Renderas som en popover-knapp i LayersSection.
import { useTranslation } from "react-i18next";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useEditorStore } from "@/stores/editorStore";
import { effectiveLayerRect, clampLayerRect } from "@/lib/layer-utils";
import type { TemplateLayer, ShapeKind } from "@/lib/template-schema";


type ShapeLayer = Extract<TemplateLayer, { type: "shape" }>;
type LineLayer = Extract<TemplateLayer, { type: "line" }>;

const SHAPE_KINDS: { kind: ShapeKind; labelKey: string }[] = [
  { kind: "frame-rect", labelKey: "layers.shape.rect" },
  { kind: "frame-oval", labelKey: "layers.shape.oval" },
  { kind: "frame-rounded", labelKey: "layers.shape.rounded" },
  { kind: "frame-double", labelKey: "layers.shape.double" },
  { kind: "frame-corners", labelKey: "layers.shape.corners" },
];

function ShapeIcon({ kind, className }: { kind: ShapeKind; className?: string }) {
  const stroke = "currentColor";
  switch (kind) {
    case "frame-rect":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke={stroke} strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" />
        </svg>
      );
    case "frame-oval":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke={stroke} strokeWidth="2">
          <ellipse cx="12" cy="12" rx="9" ry="9" />
        </svg>
      );
    case "frame-rounded":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke={stroke} strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="5" ry="5" />
        </svg>
      );
    case "frame-double":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke={stroke} strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" />
          <rect x="6" y="6" width="12" height="12" />
        </svg>
      );
    case "frame-corners":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="square">
          <polyline points="3,8 3,3 8,3" />
          <polyline points="16,3 21,3 21,8" />
          <polyline points="3,16 3,21 8,21" />
          <polyline points="16,21 21,21 21,16" />
        </svg>
      );
    default:
      return null;
  }
}

export function LayerQuickSettings({ layer }: { layer: TemplateLayer }) {
  const { t } = useTranslation();
  const update = useEditorStore((s) => s.updateLayerDefaults);

  if (layer.type !== "shape" && layer.type !== "line") return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label={t("layers.settings")}
          title={t("layers.settings")}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        className="w-64 space-y-3"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {layer.type === "shape" && (
          <ShapeSettings
            layer={layer}
            onPatch={(p) => update(layer.id, p)}
            t={t as unknown as (k: string) => string}
          />
        )}
        {layer.type === "line" && (
          <LineSettings
            layer={layer}
            onPatch={(p) => update(layer.id, p)}
            t={t as unknown as (k: string) => string}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function ShapeSettings({
  layer,
  onPatch,
  t,
}: {
  layer: ShapeLayer;
  onPatch: (p: Record<string, unknown>) => void;
  t: (k: string) => string;
}) {
  const d = layer.defaults;
  return (
    <>
      <div>
        <div className="text-xs font-semibold mb-1.5">{t("layers.shape.pickTitle")}</div>
        <div className="grid grid-cols-5 gap-1">
          {SHAPE_KINDS.map(({ kind, labelKey }) => (
            <button
              key={kind}
              type="button"
              onClick={() => onPatch({ kind })}
              className={`flex flex-col items-center justify-center p-1.5 rounded border ${
                d.kind === kind ? "border-primary bg-primary/10" : "border-input bg-background hover:bg-accent"
              }`}
              aria-label={t(labelKey)}
              title={t(labelKey)}
            >
              <ShapeIcon kind={kind} className="h-5 w-5" />
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium flex-1">{t("layers.color")}</label>
        <input
          type="color"
          value={d.color}
          onChange={(e) => onPatch({ color: e.target.value })}
          className="h-7 w-10 rounded border border-input cursor-pointer bg-transparent"
        />
      </div>
      <div>
        <div className="flex justify-between text-xs font-medium mb-1">
          <span>{t("layers.thickness")}</span>
          <span className="text-muted-foreground">{d.strokeMm.toFixed(1)} mm</span>
        </div>
        <Slider
          min={0.5}
          max={6}
          step={0.1}
          value={[d.strokeMm]}
          onValueChange={(v) => onPatch({ strokeMm: v[0] ?? 1 })}
        />
      </div>
    </>
  );
}

function LineSettings({
  layer,
  onPatch,
  t,
}: {
  layer: LineLayer;
  onPatch: (p: Record<string, unknown>) => void;
  t: (k: string) => string;
}) {
  const d = layer.defaults;
  const setLayerTransform = useEditorStore((s) => s.setLayerTransform);
  const layerTransforms = useEditorStore((s) => s.layerTransforms);

  const applyOrientation = (next: "horizontal" | "vertical") => {
    if (d.orientation === next) return;
    onPatch({ orientation: next });
    // Swap bbox kring centern så längden bevaras på den nya axeln.
    const eff = effectiveLayerRect(layer, layerTransforms);
    const cx = eff.xPct + eff.wPct / 2;
    const cy = eff.yPct + eff.hPct / 2;
    const newW = eff.hPct;
    const newH = eff.wPct;
    const rect = clampLayerRect({
      xPct: cx - newW / 2,
      yPct: cy - newH / 2,
      wPct: newW,
      hPct: newH,
    });
    setLayerTransform(layer.id, rect);
  };

  return (
    <>
      <div>
        <div className="text-xs font-semibold mb-1.5">{t("layers.line.pickTitle")}</div>
        <div className="grid grid-cols-2 gap-2">
          {(["horizontal", "vertical"] as const).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => applyOrientation(o)}
              className={`flex items-center justify-center p-2 rounded border ${
                d.orientation === o ? "border-primary bg-primary/10" : "border-input bg-background hover:bg-accent"
              }`}
            >
              {o === "horizontal" ? (
                <div className="w-10 h-0.5 bg-current" />
              ) : (
                <div className="w-0.5 h-10 bg-current" />
              )}
              <span className="sr-only">{t(`layers.line.${o}`)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs font-medium flex-1">{t("layers.color")}</label>
        <input
          type="color"
          value={d.color}
          onChange={(e) => onPatch({ color: e.target.value })}
          className="h-7 w-10 rounded border border-input cursor-pointer bg-transparent"
        />
      </div>
      <div>
        <div className="flex justify-between text-xs font-medium mb-1">
          <span>{t("layers.thickness")}</span>
          <span className="text-muted-foreground">{d.thicknessMm.toFixed(1)} mm</span>
        </div>
        <Slider
          min={0.5}
          max={6}
          step={0.1}
          value={[d.thicknessMm]}
          onValueChange={(v) => onPatch({ thicknessMm: v[0] ?? 1 })}
        />
      </div>
    </>
  );
}
