// "Lager"-fliken som visas i editorn när config.is_freeform === true.
// Kunden kan lägga till, dölja, ta bort och dra-ordna lager.
import { useEffect, useState } from "react";
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
  Eye,
  EyeOff,
  GripVertical,
  type LucideIcon,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editorStore";
import type { TemplateLayer, ShapeKind } from "@/lib/template-schema";
import { isCustomLayerId, type FreeformLayerType } from "@/lib/freeform-layers";
import { LayerQuickSettings } from "./LayerQuickSettings";

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
const ONBOARDING_KEY = "freeform-onboarding-seen";

interface RowProps {
  layer: TemplateLayer;
  hidden: boolean;
  onToggleVisible: () => void;
  onDelete: () => void;
  isCustom: boolean;
  t: (k: string) => string;
}

function SortableLayerRow({
  layer,
  hidden,
  onToggleVisible,
  onDelete,
  isCustom,
  t,
}: RowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: layer.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const Icon = LAYER_TYPE_ICON[layer.type];
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1.5 p-2 rounded-lg border bg-background",
        hidden && "opacity-50",
        isDragging && "shadow-lg ring-2 ring-primary/40",
      )}
    >
      <button
        type="button"
        className="touch-none p-1 -ml-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        aria-label={t("layers.dragHandle")}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm truncate">{layer.name}</span>
      {isCustom && (layer.type === "shape" || layer.type === "line") && (
        <LayerQuickSettings layer={layer} />
      )}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={onToggleVisible}
        aria-label={hidden ? t("layers.toggleVisible") : t("layers.toggleHidden")}
        title={hidden ? t("layers.toggleVisible") : t("layers.toggleHidden")}
      >
        {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-destructive hover:text-destructive"
        disabled={!isCustom}
        onClick={onDelete}
        aria-label={t("layers.delete")}
        title={
          isCustom ? t("layers.delete") : t("layers.deleteDisabledTpl")
        }
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

export function LayersSection() {
  const { t } = useTranslation();
  // OBS: hämta FUNKTIONEN i selectorn (stabil ref) och anropa i render.
  // `useEditorStore((s) => s.templateLayers())` triggar Zustands
  // "getSnapshot should be cached"-loop → editor kraschar (vit sida).
  const templateLayers = useEditorStore((s) => s.templateLayers);
  const layers = templateLayers();
  const addCustomLayer = useEditorStore((s) => s.addCustomLayer);
  const removeCustomLayer = useEditorStore((s) => s.removeCustomLayer);
  const setLayerVisible = useEditorStore((s) => s.setLayerVisible);
  const reorderLayers = useEditorStore((s) => s.reorderLayers);
  const hiddenLayerIds = useEditorStore((s) => s.hiddenLayerIds);
  const [sheetOpen, setSheetOpen] = useState(false);
  type Stage = "root" | "shape" | "line";
  const [stage, setStage] = useState<Stage>("root");

  // Onboarding-popover (visas första gången kunden öppnar Lager-fliken).
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARDING_KEY)) setOnboardingOpen(true);
    } catch {
      // localStorage saknas (privat-läge) → visa inte upprepat.
    }
  }, []);
  const dismissOnboarding = () => {
    setOnboardingOpen(false);
    try {
      localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      /* noop */
    }
  };

  // dnd-kit sensors. PointerSensor med distance:5 så vanliga klick på
  // grip-knappen inte triggar drag i misstag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Visa lager i renderingsordning (överst i listan = överst i z-stack)
  const ordered = [...layers].sort((a, b) => b.zIndex - a.zIndex);
  const orderedIds = ordered.map((l) => l.id);

  const onAdd = (
    type: FreeformLayerType,
    opts?: { shapeKind?: ShapeKind; lineOrientation?: "horizontal" | "vertical" },
  ) => {
    if (layers.length >= MAX_LAYERS) {
      toast.error(t("layers.maxReached"));
      return;
    }
    // Form/Linje öppnar ett sub-steg där kunden väljer variant innan vi
    // skapar lagret.
    if (!opts && type === "shape") {
      setStage("shape");
      return;
    }
    if (!opts && type === "line") {
      setStage("line");
      return;
    }
    const id = addCustomLayer(type, opts);
    setSheetOpen(false);
    setStage("root");
    if (id) toast.success(t("layers.added"));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = orderedIds.indexOf(String(active.id));
    const newIdx = orderedIds.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    const next = arrayMove(orderedIds, oldIdx, newIdx);
    reorderLayers(next);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("layers.intro")}</p>

      <Popover open={onboardingOpen} onOpenChange={(o) => !o && dismissOnboarding()}>
        <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (o) dismissOnboarding(); }}>
          <PopoverTrigger asChild>
            <SheetTrigger asChild>
              <Button className="w-full" size="lg">
                <Plus className="h-4 w-4 mr-2" />
                {t("layers.add")}
              </Button>
            </SheetTrigger>
          </PopoverTrigger>
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
        <PopoverContent side="bottom" align="center" className="w-72">
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">{t("layers.onboarding.title")}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("layers.onboarding.body")}
            </p>
            <Button size="sm" className="w-full mt-2" onClick={dismissOnboarding}>
              {t("layers.onboarding.dismiss")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

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
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {ordered.map((layer) => {
                  const isCustom = isCustomLayerId(layer.id);
                  const hidden = Boolean(hiddenLayerIds[layer.id]);
                  return (
                    <SortableLayerRow
                      key={layer.id}
                      layer={layer}
                      hidden={hidden}
                      isCustom={isCustom}
                      onToggleVisible={() => setLayerVisible(layer.id, hidden)}
                      onDelete={() => removeCustomLayer(layer.id)}
                      t={t as unknown as (k: string) => string}
                    />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
