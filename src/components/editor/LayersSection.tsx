// "Lager"-fliken som visas i editorn när config.is_freeform === true.
// Kunden kan lägga till och ta bort lager. När ett lager läggs till hamnar
// det överst i z-stacken med vettiga defaults (se src/lib/freeform-layers.ts).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Image as ImageIcon,
  Sparkles,
  MapPin,
  Type,
  Square,
  Minus,
  Frame,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editorStore";
import type { TemplateLayer } from "@/lib/template-schema";
import { isCustomLayerId, type FreeformLayerType } from "@/lib/freeform-layers";

const TYPE_META: Record<
  FreeformLayerType,
  { icon: LucideIcon; labelKey: string }
> = {
  photo: { icon: ImageIcon, labelKey: "layers.addPhoto" },
  aiPhoto: { icon: Sparkles, labelKey: "layers.addAiPhoto" },
  map: { icon: MapPin, labelKey: "layers.addMap" },
  text: { icon: Type, labelKey: "layers.addText" },
  shape: { icon: Frame, labelKey: "layers.addShape" },
  line: { icon: Minus, labelKey: "layers.addLine" },
  margin: { icon: Square, labelKey: "layers.addMargin" },
};

const ADD_ORDER: FreeformLayerType[] = [
  "photo",
  "aiPhoto",
  "map",
  "text",
  "shape",
  "line",
  "margin",
];

const LAYER_TYPE_ICON: Record<TemplateLayer["type"], LucideIcon> = {
  map: MapPin,
  text: Type,
  photo: ImageIcon,
  aiPhoto: Sparkles,
  shape: Frame,
  line: Minus,
  margin: Square,
  image: ImageIcon,
};

const MAX_LAYERS = 12;

export function LayersSection() {
  const { t } = useTranslation();
  // OBS: hämta FUNKTIONEN i selectorn (stabil ref) och anropa i render.
  // `useEditorStore((s) => s.templateLayers())` triggar Zustands
  // "getSnapshot should be cached"-loop → editor kraschar (vit sida).
  const templateLayers = useEditorStore((s) => s.templateLayers);
  const layers = templateLayers();
  const addCustomLayer = useEditorStore((s) => s.addCustomLayer);
  const removeCustomLayer = useEditorStore((s) => s.removeCustomLayer);
  const moveLayerZ = useEditorStore((s) => s.moveLayerZ);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Visa lager i renderingsordning (överst i listan = överst i z-stack)
  const ordered = [...layers].sort((a, b) => b.zIndex - a.zIndex);

  const onAdd = (type: FreeformLayerType) => {
    if (layers.length >= MAX_LAYERS) {
      toast.error(t("layers.maxReached", { max: MAX_LAYERS }));
      return;
    }
    const id = addCustomLayer(type);
    setSheetOpen(false);
    if (id) toast.success(t("layers.added"));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("layers.intro")}</p>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <Button className="w-full" size="lg">
            <Plus className="h-4 w-4 mr-2" />
            {t("layers.add")}
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("layers.addTitle")}</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-3 mt-4 pb-4">
            {ADD_ORDER.map((type) => {
              const meta = TYPE_META[type];
              const Icon = meta.icon;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onAdd(type)}
                  className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border bg-background hover:bg-accent transition"
                >
                  <Icon className="h-6 w-6" />
                  <span className="text-sm font-medium">{t(meta.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("layers.listTitle")}{" "}
          <span className="normal-case text-foreground/60">
            ({layers.length}/{MAX_LAYERS})
          </span>
        </div>
        {ordered.length === 0 ? (
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              {t("layers.empty")}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(["photo", "map", "text"] as const).map((type) => {
                const meta = TYPE_META[type];
                const Icon = meta.icon;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onAdd(type)}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-lg border bg-background hover:bg-accent transition"
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-xs font-medium">{t(meta.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {ordered.map((layer, idx) => {
              const Icon = LAYER_TYPE_ICON[layer.type];
              const isCustom = isCustomLayerId(layer.id);
              const isFirst = idx === 0;
              const isLast = idx === ordered.length - 1;
              return (
                <li
                  key={layer.id}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded-lg border bg-background",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-sm truncate">{layer.name}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={isFirst}
                    onClick={() => moveLayerZ(layer.id, 1)}
                    aria-label={t("layers.moveUp")}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={isLast}
                    onClick={() => moveLayerZ(layer.id, -1)}
                    aria-label={t("layers.moveDown")}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    disabled={!isCustom}
                    onClick={() => removeCustomLayer(layer.id)}
                    aria-label={t("layers.delete")}
                    title={
                      isCustom ? t("layers.delete") : t("layers.deleteDisabledTpl")
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
