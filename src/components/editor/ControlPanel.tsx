import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Circle, Heart, Star, Square, RotateCcw } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useEditorStore, type MapLayerValue, type TextLayerValue, type PhotoLayerValue, type PhotoShape } from "@/stores/editorStore";
import { FONT_FAMILIES } from "@/lib/font-catalog";
import { geocode, type GeocodeResult } from "@/lib/mapbox";
import { type ProductConfig } from "@/lib/product-config";
import { getEnabledMapStyleIds, mapStyleLabel, mapStylePreviewBg } from "@/lib/map-style-catalog";
import { FormatSection } from "./FormatSection";
import { PhotoUploadSection } from "./PhotoUploadSection";
import { AiStyleSection } from "./AiStyleSection";
import { AiPhotoSection } from "./AiPhotoSection";
import { Loader2, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { effectiveLayerRect, clampLayerRect } from "@/lib/layer-utils";
import type { TemplateLayer } from "@/lib/template-schema";

/** Per-layer slider that scales a layer up/down while preserving aspect ratio.
 *  Shown in the customer editor for any layer where `locks.size === false`.
 *  Scale percentage is RELATIVE to the layer's template default size. */
function LayerSizeSlider({ layer }: { layer: TemplateLayer }) {
  const { t } = useTranslation();
  const layerTransforms = useEditorStore((s) => s.layerTransforms);
  const setLayerTransform = useEditorStore((s) => s.setLayerTransform);
  const resetLayerTransform = useEditorStore((s) => s.resetLayerTransform);
  const eff = effectiveLayerRect(layer, layerTransforms);
  // % of original size (avoid /0)
  const scale = layer.wPct > 0 ? Math.round((eff.wPct / layer.wPct) * 100) : 100;

  const onChange = (val: number) => {
    const factor = val / 100;
    const newW = Math.max(1, Math.min(100, layer.wPct * factor));
    const newH = Math.max(1, Math.min(100, layer.hPct * factor));
    const cx = eff.xPct + eff.wPct / 2;
    const cy = eff.yPct + eff.hPct / 2;
    const clamped = clampLayerRect({
      xPct: cx - newW / 2,
      yPct: cy - newH / 2,
      wPct: newW,
      hPct: newH,
    });
    setLayerTransform(layer.id, clamped);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("layer.size")} <span className="ml-1 text-foreground/60 normal-case">{scale}%</span>
        </Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[10px]"
          onClick={() => resetLayerTransform(layer.id)}
        >
          <RotateCcw className="h-3 w-3 mr-1" /> {t("common.reset")}
        </Button>
      </div>
      <Slider
        min={20}
        max={200}
        step={1}
        value={[scale]}
        onValueChange={(v) => onChange(v[0]!)}
      />
    </div>
  );
}

/** Aggregated transform controls for a layer (size slider when unlocked + a
 *  reminder that the user can drag the layer when move is unlocked). */
function LayerTransformControls({ layer }: { layer: TemplateLayer }) {
  const { t } = useTranslation();
  const showSize = !layer.locks.size;
  const showMove = !layer.locks.move;
  if (!showSize && !showMove) return null;
  return (
    <div className="space-y-3 pt-1">
      {showSize && <LayerSizeSlider layer={layer} />}
      {showMove && (
        <p className="text-[11px] text-muted-foreground">
          {t("layer.tipMove")}
        </p>
      )}
    </div>
  );
}

interface Props {
  configs: ProductConfig[];
  activeHandle: string;
  onProductChange: (handle: string) => void;
}

const cardClass =
  "rounded-2xl bg-card border border-border shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-4";


export function ControlPanel({ configs, activeHandle, onProductChange }: Props) {
  const { t } = useTranslation();
  const config = useEditorStore((s) => s.config);
  const template = useEditorStore((s) => s.template);
  const productOptions = useEditorStore((s) => s.productOptions);
  const templateLayers = useEditorStore((s) => s.templateLayers);
  const layerValues = useEditorStore((s) => s.layerValues);
  const photoFile = useEditorStore((s) => s.photoFile);

  if (!config) return null;

  const layers = templateLayers();
  const mapLayers = layers.filter((l): l is Extract<TemplateLayer, { type: "map" }> => l.type === "map");
  const textLayers = layers.filter((l): l is Extract<TemplateLayer, { type: "text" }> => l.type === "text");
  const photoLayers = layers.filter((l): l is Extract<TemplateLayer, { type: "photo" }> => l.type === "photo");
  const aiPhotoLayers = layers.filter(
    (l): l is Extract<TemplateLayer, { type: "aiPhoto" }> => l.type === "aiPhoto",
  );

  const editableMaps = mapLayers.filter(
    (l) => !l.locks.position || !l.locks.style || !l.locks.shape || !l.locks.visibility || !l.locks.size || !l.locks.move,
  );
  const editableTexts = textLayers.filter(
    (l) => !l.locks.content || !l.locks.font || !l.locks.visibility || !l.locks.size || !l.locks.move,
  );

  const showImageSection = photoLayers.length > 0;
  const aiStyles = productOptions?.aiStyles ?? [];
  const showAiInsideImage = !!photoFile && aiStyles.length > 0;
  const showAiPhotoSection = aiPhotoLayers.length > 0;

  return (
    <Accordion type="single" collapsible defaultValue="karta" className="w-full space-y-3">
      {showImageSection && (
        <AccordionItem value="bild" className={cn(cardClass, "border-b-0")}>
          <AccordionTrigger className="text-sm font-semibold h-14 hover:no-underline">
            {t("section.image")}
          </AccordionTrigger>
          <AccordionContent className="pt-1 pb-4">
            <PhotoUploadSection />
            {photoLayers.some((l) => !l.locks.shape || !l.locks.size || !l.locks.move) && (
              <div className="mt-4 pt-4 border-t space-y-3">
                {photoLayers
                  .filter((l) => !l.locks.shape || !l.locks.size || !l.locks.move)
                  .map((l, idx, arr) => (
                    <PhotoShapeSection
                      key={l.id}
                      layer={l}
                      value={(layerValues[l.id] as PhotoLayerValue | undefined) ?? null}
                      heading={arr.length > 1 ? l.name || t("layer.imageTab", { n: idx + 1 }) : null}
                    />
                  ))}
              </div>
            )}
            {showAiInsideImage && (
              <div className="mt-4 pt-4 border-t space-y-2">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {t("section.aiStyle")}
                </Label>
                <AiStyleSection presets={aiStyles} />
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      )}

      {showAiPhotoSection && (
        <AccordionItem value="forvandling" className={cn(cardClass, "border-b-0")}>
          <AccordionTrigger className="text-sm font-semibold h-14 hover:no-underline">
            {t("section.transformation")}
          </AccordionTrigger>
          <AccordionContent className="pt-1 pb-4 space-y-5">
            {aiPhotoLayers.map((l, idx, arr) => (
              <div key={l.id} className="space-y-3">
                <AiPhotoSection
                  layer={l}
                  heading={arr.length > 1 ? l.name || t("layer.transformationTab", { n: idx + 1 }) : null}
                  aiStylePresets={aiStyles}
                />
                <LayerTransformControls layer={l} />
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>
      )}

      {editableMaps.length > 0 && (
        <AccordionItem value="karta" className={cn(cardClass, "border-b-0")}>
          <AccordionTrigger className="text-sm font-semibold h-14 hover:no-underline">
            {t("section.map")}
          </AccordionTrigger>
          <AccordionContent className="pt-1 pb-4 overflow-visible">
            <MapTabs config={config} layers={editableMaps} layerValues={layerValues} />
          </AccordionContent>
        </AccordionItem>
      )}

      {editableTexts.length > 0 && (
        <AccordionItem value="text" className={cn(cardClass, "border-b-0")}>
          <AccordionTrigger className="text-sm font-semibold h-14 hover:no-underline">
            {t("section.text")}
          </AccordionTrigger>
          <AccordionContent className="pt-1 pb-4 space-y-6">
            {editableTexts.map((l, idx) => (
              <TextLayerSection
                key={l.id}
                config={config}
                layer={l}
                value={(layerValues[l.id] as TextLayerValue | undefined) ?? null}
                heading={editableTexts.length > 1 ? `${l.name || t("text.tab", { n: idx + 1 })}` : null}
              />
            ))}
          </AccordionContent>
        </AccordionItem>
      )}

      <AccordionItem value="format" className={cn(cardClass, "border-b-0")}>
        <AccordionTrigger className="text-sm font-semibold h-14 hover:no-underline">
          {t("section.format")}
        </AccordionTrigger>
        <AccordionContent className="pt-1 pb-4">
          <FormatSection configs={configs} activeHandle={activeHandle} onProductChange={onProductChange} />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

// ---------------- map tabs (place + style merged) ----------------

function MapTabs({
  config,
  layers,
  layerValues,
}: {
  config: ProductConfig;
  layers: Array<Extract<TemplateLayer, { type: "map" }>>;
  layerValues: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string>(layers[0]?.id ?? "");

  // If layers change (added/removed), make sure activeId still exists.
  useEffect(() => {
    if (!layers.some((l) => l.id === activeId)) {
      setActiveId(layers[0]?.id ?? "");
    }
  }, [layers, activeId]);

  const activeLayer = layers.find((l) => l.id === activeId) ?? layers[0];
  if (!activeLayer) return null;

  const renderForLayer = (l: Extract<TemplateLayer, { type: "map" }>) => (
    <div className="space-y-6">
      <PlaceLayerSection
        layer={l}
        value={(layerValues[l.id] as MapLayerValue | undefined) ?? null}
        heading={null}
      />
      <div className="pt-4 border-t">
        <MapStyleLayerSection
          config={config}
          layer={l}
          value={(layerValues[l.id] as MapLayerValue | undefined) ?? null}
          heading={null}
        />
      </div>
    </div>
  );

  if (layers.length === 1) {
    return renderForLayer(activeLayer);
  }

  return (
    <div className="space-y-4">
      <Tabs value={activeId} onValueChange={setActiveId}>
        <TabsList className="w-full justify-start overflow-x-auto">
          {layers.map((l, idx) => (
            <TabsTrigger key={l.id} value={l.id} className="text-xs">
              {l.name || t("map.tab", { n: idx + 1 })}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {renderForLayer(activeLayer)}
    </div>
  );
}

// ---------------- per-layer sub-sections ----------------

function PlaceLayerSection({
  layer,
  value,
  heading,
}: {
  layer: Extract<TemplateLayer, { type: "map" }>;
  value: MapLayerValue | null;
  heading: string | null;
}) {
  const { t } = useTranslation();
  const applyPlaceToLayer = useEditorStore((s) => s.applyPlaceToLayer);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await geocode(q);
      setResults(r);
      setSearching(false);
    }, 300);
    return () => {
      clearTimeout(t);
      setSearching(false);
    };
  }, [query]);

  const onPick = (r: GeocodeResult) => {
    applyPlaceToLayer(layer.id, {
      placeName: r.place_name,
      center: r.center,
      city: r.city,
      country: r.country,
    });
    setResults([]);
    setQuery("");
  };

  const placeName = value?.placeName || "—";

  return (
    <div className="space-y-3">
      {heading && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {heading}
        </h4>
      )}
      <div className="space-y-1">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("map.selectedPlace")}</Label>
        <p className="text-sm font-medium font-serif-display">{placeName}</p>
      </div>
      <div className="space-y-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("map.searchAddress")}
        </Label>
        <Popover open={results.length > 0}>
          <PopoverTrigger asChild>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("map.searchPlaceholder")}
                className="pl-10 pr-10 h-12 rounded-full bg-background shadow-inner"
              />
              {searching && (
                <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="p-0 w-[var(--radix-popover-trigger-width)] z-[60] rounded-2xl overflow-hidden"
          >
            <div className="max-h-[14rem] overflow-y-auto divide-y">
              {results.slice(0, 4).map((r, i) => (
                <button
                  key={i}
                  onClick={() => onPick(r)}
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-accent transition h-[3.5rem] leading-tight"
                >
                  {r.place_name}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("map.tipDrag")}
      </p>
      <LayerTransformControls layer={layer} />
    </div>
  );
}

function MapStyleLayerSection({
  config,
  layer,
  value,
  heading,
}: {
  config: ProductConfig;
  layer: Extract<TemplateLayer, { type: "map" }>;
  value: MapLayerValue | null;
  heading: string | null;
}) {
  const setLayerMapStyle = useEditorStore((s) => s.setLayerMapStyle);
  const setLayerShowLabels = useEditorStore((s) => s.setLayerShowLabels);
  const setLayerMapShape = useEditorStore((s) => s.setLayerMapShape);
  const productOptions = useEditorStore((s) => s.productOptions);
  const styleId = value?.styleId ?? layer.defaults.styleId;
  const showLabels = value?.showLabels ?? layer.defaults.showLabels;
  const shape = value?.shape ?? layer.defaults.shape;

  // Per-template enabled list (Alt B), with legacy fallback.
  const enabledStyleIds = getEnabledMapStyleIds(
    productOptions ? { productOptions } : null,
    config.map_styles,
  );

  const shapeOptions = ([
    { id: "rect", label: "Ingen", Icon: Square },
    { id: "circle", label: "Cirkel", Icon: Circle },
    { id: "heart", label: "Hjärta", Icon: Heart },
    { id: "star", label: "Stjärna", Icon: Star },
  ] as const);

  return (
    <div className="space-y-3">
      {heading && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {heading}
        </h4>
      )}
      {!layer.locks.style && (
        <div className="grid grid-cols-3 gap-2">
          {enabledStyleIds.map((s) => (
            <button
              key={s}
              onClick={() => setLayerMapStyle(layer.id, s)}
              className={cn(
                "relative aspect-square rounded-xl overflow-hidden transition hover:-translate-y-0.5",
                s === styleId ? "ring-2 ring-primary" : "ring-1 ring-border",
              )}
            >
              <div className="absolute inset-0" style={{ background: mapStylePreviewBg(s) }} />
              <span className="absolute bottom-0 left-0 right-0 bg-background/85 backdrop-blur-sm text-[10px] py-1 font-medium">
                {mapStyleLabel(s)}
              </span>
            </button>
          ))}
        </div>
      )}
      {!layer.locks.style && (
        <div className="flex items-center justify-between pt-2">
          <Label className="text-xs text-foreground">Visa områdesnamn på kartan</Label>
          <Switch checked={showLabels} onCheckedChange={(v) => setLayerShowLabels(layer.id, v)} />
        </div>
      )}
      {!layer.locks.shape && (
        <div className="space-y-2 pt-1">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Kartans form</Label>
          <div className="grid grid-cols-3 gap-2">
            {shapeOptions.map(({ id, label, Icon }) => {
              const selected = shape === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLayerMapShape(layer.id, id)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1.5 aspect-square rounded-xl transition",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-background ring-1 ring-border hover:bg-accent/50",
                  )}
                >
                  <Icon className="h-6 w-6" />
                  <span className="text-[10px] font-medium">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TextLayerSection({
  config,
  layer,
  value,
  heading,
}: {
  config: ProductConfig;
  layer: Extract<TemplateLayer, { type: "text" }>;
  value: TextLayerValue | null;
  heading: string | null;
}) {
  const setLayerText = useEditorStore((s) => s.setLayerText);
  const setLayerTextFont = useEditorStore((s) => s.setLayerTextFont);
  const setLayerTextVisible = useEditorStore((s) => s.setLayerTextVisible);
  const productOptions = useEditorStore((s) => s.productOptions);
  const text = value?.text ?? layer.defaults.text;
  const font = value?.font ?? layer.defaults.font;
  const visible = value?.visible ?? true;
  const allowedFonts =
    productOptions?.allowedFonts && productOptions.allowedFonts.length > 0
      ? productOptions.allowedFonts
      : FONT_FAMILIES;

  return (
    <div className="space-y-3">
      {heading && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {heading}
        </h4>
      )}
      {!layer.locks.visibility && (
        <div className="flex items-center justify-between">
          <Label className="text-xs text-foreground">Visa text</Label>
          <Switch checked={visible} onCheckedChange={(v) => setLayerTextVisible(layer.id, v)} />
        </div>
      )}
      {!layer.locks.content && (
        <Textarea
          value={text}
          onChange={(e) => setLayerText(layer.id, e.target.value)}
          placeholder="Din text här…"
          maxLength={config.text_config.maxChars}
          rows={3}
          className="rounded-xl"
        />
      )}
      {!layer.locks.font && (
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Typsnitt</Label>
          <div className="grid grid-cols-3 gap-2">
            {allowedFonts.map((f) => (
              <Button
                key={f}
                size="sm"
                variant={f === font ? "default" : "outline"}
                onClick={() => setLayerTextFont(layer.id, f)}
                style={{ fontFamily: `"${f}", system-ui, sans-serif` }}
                className="text-xs rounded-full"
              >
                {f.split(" ")[0]}
              </Button>
            ))}
          </div>
        </div>
      )}
      <LayerTransformControls layer={layer} />
    </div>
  );
}

function PhotoShapeSection({
  layer,
  value,
  heading,
}: {
  layer: Extract<TemplateLayer, { type: "photo" }>;
  value: PhotoLayerValue | null;
  heading: string | null;
}) {
  const setLayerPhotoShape = useEditorStore((s) => s.setLayerPhotoShape);
  const shape = value?.shape ?? layer.defaults.shape;
  const options = [
    { id: "rect", label: "Ingen", Icon: Square },
    { id: "circle", label: "Cirkel", Icon: Circle },
    { id: "heart", label: "Hjärta", Icon: Heart },
    { id: "star", label: "Stjärna", Icon: Star },
  ] as const;

  return (
    <div className="space-y-2">
      {heading && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {heading}
        </h4>
      )}
      {!layer.locks.shape && (
        <>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Bildens form
          </Label>
          <div className="grid grid-cols-4 gap-2">
            {options.map(({ id, label, Icon }) => {
              const selected = shape === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLayerPhotoShape(layer.id, id as PhotoShape)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1.5 aspect-square rounded-xl transition",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-background ring-1 ring-border hover:bg-accent/50",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[10px] font-medium">{label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      <LayerTransformControls layer={layer} />
    </div>
  );
}
