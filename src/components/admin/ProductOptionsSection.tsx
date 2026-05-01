// Section A of the admin designer: choose product types + which sizes/frames/depths
// are available for this template. Pure UI — owns no state, just calls back.
//
// The available list per product type is the UNION of:
//  - variants present in `config.sizes` (legacy/Gelato-mapped data)
//  - hardcoded `DEFAULT_PRODUCT_VARIANTS` for that product type
// This way the admin can enable e.g. canvas on a poster-only legacy config and
// still see canvas-shaped sizes/depths instead of poster frames.
import { useMemo, useRef, useState } from "react";
import { Info, Plus, Trash2, Upload, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ProductConfig } from "@/lib/product-config";
import type { AiStylePreset, MapStylePreset, ProductOptions } from "@/lib/template-schema";
import { DEFAULT_PRODUCT_VARIANTS, mergeUnique } from "@/lib/product-defaults";
import { hasGelatoSku } from "@/lib/gelato-catalog";
import { DEFAULT_AI_STYLES } from "@/lib/ai-style-defaults";
import { MAP_STYLE_CATALOG } from "@/lib/map-style-catalog";
import { uploadCartPreview } from "@/lib/upload-preview";
import { FONT_CATALOG, FONT_CATEGORY_LABELS, FONT_FAMILIES, type FontCategory } from "@/lib/font-catalog";
import { toast } from "sonner";

interface Props {
  config: ProductConfig;
  value: ProductOptions;
  onChange: (next: ProductOptions) => void;
  /** Called when admin updates DB-level product config (currently used for
   *  the per-handle Gelato SKU-map). Optional so older callers keep working. */
  onConfigChange?: (patch: Partial<ProductConfig>) => void;
}

type Kind = "poster" | "canvas" | "aluminum" | "acrylic";

export default function ProductOptionsSection({ config, value, onChange, onConfigChange }: Props) {
  // Variant names from config (used so Gelato-mapped variants always appear)
  const configVariantNames = useMemo(
    () => Array.from(new Set(config.sizes.flatMap((s) => s.variants.map((v) => v.name)))),
    [config],
  );
  const configSizes = useMemo(() => config.sizes.map((s) => s.size), [config]);

  // Union per product type
  const posterSizes = useMemo(
    () => mergeUnique(configSizes, DEFAULT_PRODUCT_VARIANTS.poster.sizes),
    [configSizes],
  );
  const posterFrames = useMemo(
    () => mergeUnique(configVariantNames, DEFAULT_PRODUCT_VARIANTS.poster.frames),
    [configVariantNames],
  );
  const canvasSizes = useMemo(
    () => mergeUnique(configSizes, DEFAULT_PRODUCT_VARIANTS.canvas.sizes),
    [configSizes],
  );
  const canvasDepths = useMemo(
    () => mergeUnique(configVariantNames, DEFAULT_PRODUCT_VARIANTS.canvas.depths),
    [configVariantNames],
  );
  const aluminumSizes = useMemo(
    () => mergeUnique(configSizes, DEFAULT_PRODUCT_VARIANTS.aluminum.sizes),
    [configSizes],
  );
  const aluminumMaterials = useMemo(
    () => mergeUnique(configVariantNames, DEFAULT_PRODUCT_VARIANTS.aluminum.materials),
    [configVariantNames],
  );
  const acrylicSizes = useMemo(
    () => mergeUnique(configSizes, DEFAULT_PRODUCT_VARIANTS.acrylic.sizes),
    [configSizes],
  );
  const acrylicFinishes = useMemo(
    () => mergeUnique(configVariantNames, DEFAULT_PRODUCT_VARIANTS.acrylic.finishes),
    [configVariantNames],
  );

  function toggleEnabled(kind: Kind, enabled: boolean) {
    const next: ProductOptions = { ...value };
    if (kind === "poster") {
      next.poster = {
        enabled,
        allowedSizes:
          value.poster?.allowedSizes && value.poster.allowedSizes.length > 0
            ? value.poster.allowedSizes
            : [...DEFAULT_PRODUCT_VARIANTS.poster.sizes],
        allowedFrames:
          value.poster?.allowedFrames && value.poster.allowedFrames.length > 0
            ? value.poster.allowedFrames
            : [...DEFAULT_PRODUCT_VARIANTS.poster.frames],
      };
    } else if (kind === "canvas") {
      next.canvas = {
        enabled,
        allowedSizes:
          value.canvas?.allowedSizes && value.canvas.allowedSizes.length > 0
            ? value.canvas.allowedSizes
            : [...DEFAULT_PRODUCT_VARIANTS.canvas.sizes],
        allowedDepths:
          value.canvas?.allowedDepths && value.canvas.allowedDepths.length > 0
            ? value.canvas.allowedDepths
            : [...DEFAULT_PRODUCT_VARIANTS.canvas.depths],
      };
    } else if (kind === "aluminum") {
      next.aluminum = {
        enabled,
        allowedSizes:
          value.aluminum?.allowedSizes && value.aluminum.allowedSizes.length > 0
            ? value.aluminum.allowedSizes
            : [...DEFAULT_PRODUCT_VARIANTS.aluminum.sizes],
        allowedMaterials:
          value.aluminum?.allowedMaterials && value.aluminum.allowedMaterials.length > 0
            ? value.aluminum.allowedMaterials
            : [...DEFAULT_PRODUCT_VARIANTS.aluminum.materials],
      };
    } else {
      next.acrylic = {
        enabled,
        allowedSizes:
          value.acrylic?.allowedSizes && value.acrylic.allowedSizes.length > 0
            ? value.acrylic.allowedSizes
            : [...DEFAULT_PRODUCT_VARIANTS.acrylic.sizes],
        allowedFinishes:
          value.acrylic?.allowedFinishes && value.acrylic.allowedFinishes.length > 0
            ? value.acrylic.allowedFinishes
            : [...DEFAULT_PRODUCT_VARIANTS.acrylic.finishes],
      };
    }
    onChange(next);
  }

  function toggleListItem(
    kind: Kind,
    field: "allowedSizes" | "allowedFrames" | "allowedDepths" | "allowedMaterials" | "allowedFinishes",
    item: string,
    checked: boolean,
  ) {
    const block = (value as Record<string, unknown>)[kind] as Record<string, unknown> | undefined;
    if (!block) return;
    const current = (block[field] as string[]) ?? [];
    const nextList = checked ? Array.from(new Set([...current, item])) : current.filter((x) => x !== item);
    onChange({ ...value, [kind]: { ...block, [field]: nextList } });
  }

  // Banner only fires when an *enabled* combination lacks a Gelato SKU.
  const missingSkus = useMemo(() => {
    const out: { kind: Kind; size: string; variant: string }[] = [];
    if (value.poster?.enabled) {
      for (const s of value.poster.allowedSizes ?? []) {
        for (const f of value.poster.allowedFrames ?? []) {
          if (!hasGelatoSku("poster", s, f)) out.push({ kind: "poster", size: s, variant: f });
        }
      }
    }
    if (value.canvas?.enabled) {
      for (const s of value.canvas.allowedSizes ?? []) {
        for (const d of value.canvas.allowedDepths ?? []) {
          if (!hasGelatoSku("canvas", s, d)) out.push({ kind: "canvas", size: s, variant: d });
        }
      }
    }
    if (value.aluminum?.enabled) {
      for (const s of value.aluminum.allowedSizes ?? []) {
        for (const m of value.aluminum.allowedMaterials ?? []) {
          if (!hasGelatoSku("aluminum", s, m)) out.push({ kind: "aluminum", size: s, variant: m });
        }
      }
    }
    if (value.acrylic?.enabled) {
      for (const s of value.acrylic.allowedSizes ?? []) {
        for (const f of value.acrylic.allowedFinishes ?? []) {
          if (!hasGelatoSku("acrylic", s, f)) out.push({ kind: "acrylic", size: s, variant: f });
        }
      }
    }
    return out;
  }, [value]);

  return (
    <div className="space-y-5">
      <Card className="p-5 space-y-5">
        <div>
          <h2 className="text-base font-semibold">Produkt & varianter</h2>
          <p className="text-xs text-muted-foreground">
            Välj vilka produkter, storlekar och varianter den här mallen säljs som.
          </p>
        </div>

        {missingSkus.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {missingSkus.length} variantkombination{missingSkus.length === 1 ? "" : "er"} saknar Gelato-SKU och
              kommer hoppas över vid synk till Shopify (t.ex.{" "}
              <code className="font-mono">{missingSkus[0].size} · {missingSkus[0].variant}</code>).
            </span>
          </div>
        )}

        {/* Per-rad: visa bara det produktblock som hör till den här raden.
            Poster-raden äger `poster`-blocket; canvas-raden äger `canvas`-blocket.
            Detta förhindrar att admin av misstag ändrar fel sidas konfiguration. */}
        {config.product_type === "posters" && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Poster</Label>
              <Switch
                checked={value.poster?.enabled ?? false}
                onCheckedChange={(c) => toggleEnabled("poster", c)}
              />
            </div>
            {value.poster?.enabled && (
              <div className="grid gap-4 md:grid-cols-2">
                <ChecklistGroup
                  title="Tillåtna storlekar"
                  all={posterSizes}
                  selected={value.poster.allowedSizes}
                  onToggle={(item, c) => toggleListItem("poster", "allowedSizes", item, c)}
                />
                <ChecklistGroup
                  title="Tillåtna ramar"
                  all={posterFrames}
                  selected={value.poster.allowedFrames}
                  onToggle={(item, c) => toggleListItem("poster", "allowedFrames", item, c)}
                />
              </div>
            )}
          </div>
        )}

        {config.product_type === "canvas" && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Canvas</Label>
              <Switch
                checked={value.canvas?.enabled ?? false}
                onCheckedChange={(c) => toggleEnabled("canvas", c)}
              />
            </div>
            {value.canvas?.enabled && (
              <div className="grid gap-4 md:grid-cols-2">
                <ChecklistGroup
                  title="Tillåtna storlekar"
                  all={canvasSizes}
                  selected={value.canvas.allowedSizes}
                  onToggle={(item, c) => toggleListItem("canvas", "allowedSizes", item, c)}
                />
                <ChecklistGroup
                  title="Tillåtna djup"
                  all={canvasDepths}
                  selected={value.canvas.allowedDepths}
                  onToggle={(item, c) => toggleListItem("canvas", "allowedDepths", item, c)}
                />
              </div>
            )}
          </div>
        )}

        {config.product_type === "aluminum" && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Aluminium</Label>
              <Switch
                checked={value.aluminum?.enabled ?? false}
                onCheckedChange={(c) => toggleEnabled("aluminum", c)}
              />
            </div>
            {value.aluminum?.enabled && (
              <div className="grid gap-4 md:grid-cols-2">
                <ChecklistGroup
                  title="Tillåtna storlekar"
                  all={aluminumSizes}
                  selected={value.aluminum.allowedSizes}
                  onToggle={(item, c) => toggleListItem("aluminum", "allowedSizes", item, c)}
                />
                <ChecklistGroup
                  title="Material"
                  all={aluminumMaterials}
                  selected={value.aluminum.allowedMaterials}
                  onToggle={(item, c) => toggleListItem("aluminum", "allowedMaterials", item, c)}
                />
              </div>
            )}
          </div>
        )}

        {config.product_type === "acrylic" && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Akryl</Label>
              <Switch
                checked={value.acrylic?.enabled ?? false}
                onCheckedChange={(c) => toggleEnabled("acrylic", c)}
              />
            </div>
            {value.acrylic?.enabled && (
              <div className="grid gap-4 md:grid-cols-2">
                <ChecklistGroup
                  title="Tillåtna storlekar"
                  all={acrylicSizes}
                  selected={value.acrylic.allowedSizes}
                  onToggle={(item, c) => toggleListItem("acrylic", "allowedSizes", item, c)}
                />
                <ChecklistGroup
                  title="Finish"
                  all={acrylicFinishes}
                  selected={value.acrylic.allowedFinishes}
                  onToggle={(item, c) => toggleListItem("acrylic", "allowedFinishes", item, c)}
                />
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Map Styles — collapsible, per-template enabling */}
      <MapStylesEditor
        config={config}
        value={value.mapStyles}
        onChange={(mapStyles) => onChange({ ...value, mapStyles })}
      />

      {/* AI Styles — separate collapsible card */}
      <AiStylesEditor
        value={value.aiStyles ?? []}
        onChange={(aiStyles) => onChange({ ...value, aiStyles })}
      />

      {/* Allowed fonts — per-template customer font picker */}
      <AllowedFontsEditor
        value={value.allowedFonts}
        onChange={(allowedFonts) => onChange({ ...value, allowedFonts })}
      />
    </div>
  );
}

function MapStylesEditor({
  config,
  value,
  onChange,
}: {
  config: ProductConfig;
  value: MapStylePreset[] | undefined;
  onChange: (next: MapStylePreset[]) => void;
}) {
  // Build the working list: catalog order, with `enabled` resolved from
  // (1) explicit template entry, (2) legacy config.map_styles, (3) default true.
  const legacy = config.map_styles ?? [];
  const explicit = new Map((value ?? []).map((m) => [m.id, m.enabled !== false]));
  const presets: MapStylePreset[] = MAP_STYLE_CATALOG.map((s) => {
    const enabled = explicit.has(s.id)
      ? explicit.get(s.id)!
      : value && value.length > 0
        ? false // explicit list provided but this style not in it → disabled
        : legacy.length > 0
          ? legacy.includes(s.id)
          : true;
    return { id: s.id, enabled };
  });
  const enabledCount = presets.filter((p) => p.enabled).length;

  const toggle = (id: string, enabled: boolean) => {
    const next = presets.map((p) => (p.id === id ? { ...p, enabled } : p));
    onChange(next);
  };

  return (
    <Card className="p-0 overflow-hidden">
      <Accordion type="single" collapsible defaultValue="">
        <AccordionItem value="map-styles" className="border-0">
          <AccordionTrigger className="px-5 py-4 hover:no-underline">
            <div className="text-left">
              <h2 className="text-base font-semibold">Kartstilar</h2>
              <p className="text-xs text-muted-foreground font-normal">
                {enabledCount} av {presets.length} aktiverade. Stilar kunden kan välja för kartlagret.
              </p>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-5 pb-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MAP_STYLE_CATALOG.map((s) => {
                const enabled = presets.find((p) => p.id === s.id)?.enabled ?? true;
                return (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 rounded-md border bg-background p-2"
                  >
                    <div
                      className="h-10 w-10 shrink-0 rounded-md border"
                      style={{ background: s.previewBg }}
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${enabled ? "" : "text-muted-foreground line-through"}`}>
                        {s.label}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">{s.id}</p>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(c) => toggle(s.id, c)}
                      aria-label={`Aktivera ${s.label}`}
                    />
                  </div>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}

function AiStylesEditor({
  value,
  onChange,
}: {
  value: AiStylePreset[];
  onChange: (next: AiStylePreset[]) => void;
}) {
  const presets = value.length === 0 ? DEFAULT_AI_STYLES : value;
  const enabledCount = presets.filter((p) => p.enabled !== false).length;

  const updateAt = (idx: number, patch: Partial<AiStylePreset>) => {
    const next = presets.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    onChange(next);
  };
  const removeAt = (idx: number) => onChange(presets.filter((_, i) => i !== idx));
  const addPreset = () => {
    const id = `style-${Date.now().toString(36)}`;
    onChange([...presets, { id, label: "Ny stil", enabled: true, prompt: "Describe the artistic style here." }]);
  };
  const seedDefaults = () => onChange([...DEFAULT_AI_STYLES]);

  return (
    <Card className="p-0 overflow-hidden">
      <Accordion type="single" collapsible defaultValue="">
        <AccordionItem value="ai-styles" className="border-0">
          <AccordionTrigger className="px-5 py-4 hover:no-underline">
            <div className="text-left">
              <h2 className="text-base font-semibold">AI-stilar</h2>
              <p className="text-xs text-muted-foreground font-normal">
                {enabledCount} av {presets.length} aktiverade. Stilar som kunden kan tillämpa på sin uppladdade bild.
              </p>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-5 pb-5 space-y-3">
            <div className="flex justify-end gap-2">
              {value.length === 0 && (
                <Button type="button" variant="outline" size="sm" onClick={seedDefaults}>
                  Använd standard
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={addPreset}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Lägg till
              </Button>
            </div>

            <Accordion type="single" collapsible className="space-y-2">
              {presets.map((p, i) => (
                <AiStyleRow
                  key={p.id + i}
                  preset={p}
                  onChange={(patch) => updateAt(i, patch)}
                  onRemove={() => removeAt(i)}
                />
              ))}
            </Accordion>
            {presets.length === 0 && (
              <p className="text-xs text-muted-foreground">Inga AI-stilar konfigurerade.</p>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}

function AiStyleRow({
  preset,
  onChange,
  onRemove,
}: {
  preset: AiStylePreset;
  onChange: (patch: Partial<AiStylePreset>) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const enabled = preset.enabled !== false;

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      const dataUrl: string = await new Promise((res, rej) => {
        reader.onload = () => res(reader.result as string);
        reader.onerror = () => rej(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const url = await uploadCartPreview(dataUrl, `aistyle-${preset.id}-${Date.now()}`);
      onChange({ thumbnailUrl: url });
    } catch (e) {
      toast.error("Kunde inte ladda upp thumbnail", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <AccordionItem value={preset.id} className="rounded-md border bg-background px-3">
      <div className="flex items-center gap-2 py-1">
        <Switch
          checked={enabled}
          onCheckedChange={(c) => onChange({ enabled: c })}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Aktivera ${preset.label}`}
        />
        <AccordionTrigger className="flex-1 py-2 hover:no-underline">
          <span className={`text-sm font-medium ${enabled ? "" : "text-muted-foreground line-through"}`}>
            {preset.label}
          </span>
        </AccordionTrigger>
      </div>
      <AccordionContent className="pb-3">
        <div className="flex gap-3">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="relative h-16 w-16 shrink-0 rounded-md overflow-hidden border bg-muted flex items-center justify-center"
                  aria-label="Ladda upp thumbnail"
                >
                  {preset.thumbnailUrl ? (
                    <img src={preset.thumbnailUrl} alt={preset.label} className="h-full w-full object-cover" />
                  ) : (
                    <Upload className="h-4 w-4 text-muted-foreground" />
                  )}
                  {uploading && (
                    <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>Thumbnail som visas för kunden i stilväljaren.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files?.[0])}
          />
          <div className="flex-1 space-y-2 min-w-0">
            <div className="flex items-center gap-2">
              <Input
                value={preset.label}
                onChange={(e) => onChange({ label: e.target.value })}
                placeholder="Etikett"
                className="h-8 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive shrink-0"
                onClick={onRemove}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Textarea
              value={preset.prompt}
              onChange={(e) => onChange({ prompt: e.target.value })}
              rows={2}
              placeholder="Prompt till AI-modellen…"
              className="text-xs"
            />
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function ChecklistGroup({
  title,
  all,
  selected,
  onToggle,
}: {
  title: string;
  all: string[];
  selected: string[];
  onToggle: (item: string, checked: boolean) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </p>
      <div className="space-y-2">
        {all.map((item) => {
          const checked = selected.includes(item);
          return (
            <label key={item} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={checked}
                onCheckedChange={(c) => onToggle(item, Boolean(c))}
              />
              <span>{item}</span>
            </label>
          );
        })}
        {all.length === 0 && (
          <p className="text-xs text-muted-foreground">Inga alternativ konfigurerade.</p>
        )}
      </div>
    </div>
  );
}

function AllowedFontsEditor({
  value,
  onChange,
}: {
  value: string[] | undefined;
  onChange: (next: string[]) => void;
}) {
  // Undefined / empty array → all fonts allowed (legacy behaviour).
  const allAllowed = !value || value.length === 0;
  const isAllowed = (family: string) => allAllowed || value!.includes(family);
  const enabledCount = allAllowed ? FONT_FAMILIES.length : value!.length;

  const toggle = (family: string, enabled: boolean) => {
    const current = allAllowed ? [...FONT_FAMILIES] : [...value!];
    const next = enabled
      ? Array.from(new Set([...current, family]))
      : current.filter((f) => f !== family);
    onChange(next);
  };

  const enableAll = () => onChange([]);
  const disableAll = () => onChange([FONT_FAMILIES[0]]);

  return (
    <Card className="p-0 overflow-hidden">
      <Accordion type="single" collapsible defaultValue="">
        <AccordionItem value="allowed-fonts" className="border-0">
          <AccordionTrigger className="px-5 py-4 hover:no-underline">
            <div className="text-left">
              <h2 className="text-base font-semibold">Tillåtna typsnitt</h2>
              <p className="text-xs text-muted-foreground font-normal">
                {enabledCount} av {FONT_FAMILIES.length} aktiverade. Typsnitt kunden
                kan välja för text-lager.
              </p>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-5 pb-5 space-y-3">
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={enableAll}>
                Aktivera alla
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={disableAll}>
                Avaktivera alla
              </Button>
            </div>
            {(["sans", "serif", "display", "script", "mono"] as FontCategory[]).map((cat) => {
              const items = FONT_CATALOG.filter((f) => f.category === cat);
              if (items.length === 0) return null;
              return (
                <div key={cat} className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {FONT_CATEGORY_LABELS[cat]}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {items.map((f) => {
                      const checked = isAllowed(f.family);
                      return (
                        <label
                          key={f.family}
                          className="flex items-center gap-3 rounded-md border bg-background p-2 cursor-pointer"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) => toggle(f.family, c === true)}
                          />
                          <span
                            className={`text-sm flex-1 ${checked ? "" : "text-muted-foreground line-through"}`}
                            style={{ fontFamily: `"${f.family}", system-ui, sans-serif` }}
                          >
                            {f.family}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}

