// Section A of the admin designer: choose product types + which sizes/frames/depths
// are available for this template. Pure UI — owns no state, just calls back.
//
// The available list per product type is the UNION of:
//  - variants present in `config.sizes` (legacy/Gelato-mapped data)
//  - hardcoded `DEFAULT_PRODUCT_VARIANTS` for that product type
// This way the admin can enable e.g. canvas on a poster-only legacy config and
// still see canvas-shaped sizes/depths instead of poster frames.
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info, Plus, Trash2, Upload, Loader2, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import type { ProductOptions } from "@/lib/template-schema";
import { DEFAULT_PRODUCT_VARIANTS, mergeUnique } from "@/lib/product-defaults";
import { getPodProvider } from "@/lib/pod";
import { uploadCartPreview } from "@/lib/upload-preview";
import { FONT_CATALOG, FONT_CATEGORY_LABELS, FONT_FAMILIES, type FontCategory } from "@/lib/font-catalog";
import { toast } from "sonner";

interface Props {
  config: ProductConfig;
  value: ProductOptions;
  onChange: (next: ProductOptions) => void;
}

type Kind = "poster" | "canvas" | "aluminum" | "acrylic";

export default function ProductOptionsSection({ config, value, onChange }: Props) {
  const { t } = useTranslation();
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

  // Bulk select/clear a whole field at once. Done in the parent so it writes a
  // single `value` update — a per-item loop over toggleListItem would read the
  // same stale `value` each iteration and only the last write would survive.
  function setListField(
    kind: Kind,
    field: "allowedSizes" | "allowedFrames" | "allowedDepths" | "allowedMaterials" | "allowedFinishes",
    items: string[],
  ) {
    const block = (value as Record<string, unknown>)[kind] as Record<string, unknown> | undefined;
    if (!block) return;
    onChange({ ...value, [kind]: { ...block, [field]: items } });
  }

  // Banner only fires when an *enabled* combination lacks a Gelato SKU.
  // Undantag: Hängare-varianter saknas medvetet hos Gelato för små storlekar
  // (t.ex. 13×18) — de visas som "ej tillgänglig" (greyed out) i kundvyn och
  // ska inte flaggas som synk-fel här.
  const missingSkus = useMemo(() => {
    const provider = getPodProvider();
    const out: { kind: Kind; size: string; variant: string }[] = [];
    if (value.poster?.enabled) {
      for (const s of value.poster.allowedSizes ?? []) {
        for (const f of value.poster.allowedFrames ?? []) {
          if (/^Hängare/i.test(f)) continue; // medvetet otillgängliga kombinationer
          if (!provider.hasSku("poster", s, f)) out.push({ kind: "poster", size: s, variant: f });
        }
      }
    }
    if (value.canvas?.enabled) {
      for (const s of value.canvas.allowedSizes ?? []) {
        for (const d of value.canvas.allowedDepths ?? []) {
          if (!provider.hasSku("canvas", s, d)) out.push({ kind: "canvas", size: s, variant: d });
        }
      }
    }
    if (value.aluminum?.enabled) {
      for (const s of value.aluminum.allowedSizes ?? []) {
        for (const m of value.aluminum.allowedMaterials ?? []) {
          if (!provider.hasSku("aluminum", s, m)) out.push({ kind: "aluminum", size: s, variant: m });
        }
      }
    }
    if (value.acrylic?.enabled) {
      for (const s of value.acrylic.allowedSizes ?? []) {
        for (const f of value.acrylic.allowedFinishes ?? []) {
          if (!provider.hasSku("acrylic", s, f)) out.push({ kind: "acrylic", size: s, variant: f });
        }
      }
    }
    return out;
  }, [value]);

  return (
    <div className="space-y-5">
      <Card className="p-5 space-y-5">
        <div>
          <h2 className="text-base font-semibold">{t("admin.productOptions.title")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("admin.productOptions.subtitle")}
          </p>
        </div>

        {missingSkus.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {t("admin.productOptions.missingSku", {
                count: missingSkus.length,
                example: `${missingSkus[0].size} · ${missingSkus[0].variant}`,
              })}
            </span>
          </div>
        )}

        {/* Konsoliderade mallar visar ALLA aktiverade produkttyper i samma vy.
            Per-typs-mallar visar bara sitt eget block. */}
        {(() => {
          const consolidated = (config as { is_consolidated?: boolean }).is_consolidated;
          const enabled = (config as { enabled_product_types?: string[] }).enabled_product_types ?? [];
          const showPoster = consolidated ? enabled.includes("posters") : config.product_type === "posters";
          return showPoster;
        })() && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{t("productKind.poster")}</Label>
              <Switch
                checked={value.poster?.enabled ?? false}
                onCheckedChange={(c) => toggleEnabled("poster", c)}
              />
            </div>
            {value.poster?.enabled && (
              <div className="grid gap-4 md:grid-cols-2">
                <ChecklistGroup
                  title={t("admin.productOptions.allowedSizes")}
                  all={posterSizes}
                  selected={value.poster.allowedSizes}
                  onToggle={(item, c) => toggleListItem("poster", "allowedSizes", item, c)}
                  onSelectAll={(c) => setListField("poster", "allowedSizes", c ? posterSizes : [])}
                />
                <ChecklistGroup
                  title={t("admin.productOptions.allowedFrames")}
                  all={posterFrames}
                  selected={value.poster.allowedFrames}
                  onToggle={(item, c) => toggleListItem("poster", "allowedFrames", item, c)}
                  onSelectAll={(c) => setListField("poster", "allowedFrames", c ? posterFrames : [])}
                />
              </div>
            )}
          </div>
        )}

        {(() => {
          const consolidated = (config as { is_consolidated?: boolean }).is_consolidated;
          const enabled = (config as { enabled_product_types?: string[] }).enabled_product_types ?? [];
          return consolidated ? enabled.includes("canvas") : config.product_type === "canvas";
        })() && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{t("productKind.canvas")}</Label>
              <Switch
                checked={value.canvas?.enabled ?? false}
                onCheckedChange={(c) => toggleEnabled("canvas", c)}
              />
            </div>
            {value.canvas?.enabled && (
              <div className="grid gap-4 md:grid-cols-2">
                <ChecklistGroup
                  title={t("admin.productOptions.allowedSizes")}
                  all={canvasSizes}
                  selected={value.canvas.allowedSizes}
                  onToggle={(item, c) => toggleListItem("canvas", "allowedSizes", item, c)}
                  onSelectAll={(c) => setListField("canvas", "allowedSizes", c ? canvasSizes : [])}
                />
                <ChecklistGroup
                  title={t("admin.productOptions.allowedDepths")}
                  all={canvasDepths}
                  selected={value.canvas.allowedDepths}
                  onToggle={(item, c) => toggleListItem("canvas", "allowedDepths", item, c)}
                  onSelectAll={(c) => setListField("canvas", "allowedDepths", c ? canvasDepths : [])}
                />
              </div>
            )}
          </div>
        )}

        {(() => {
          const consolidated = (config as { is_consolidated?: boolean }).is_consolidated;
          const enabled = (config as { enabled_product_types?: string[] }).enabled_product_types ?? [];
          return consolidated ? enabled.includes("aluminum") : config.product_type === "aluminum";
        })() && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{t("productKind.aluminum")}</Label>
              <Switch
                checked={value.aluminum?.enabled ?? false}
                onCheckedChange={(c) => toggleEnabled("aluminum", c)}
              />
            </div>
            {value.aluminum?.enabled && (
              <div className="grid gap-4 md:grid-cols-2">
                <ChecklistGroup
                  title={t("admin.productOptions.allowedSizes")}
                  all={aluminumSizes}
                  selected={value.aluminum.allowedSizes}
                  onToggle={(item, c) => toggleListItem("aluminum", "allowedSizes", item, c)}
                  onSelectAll={(c) => setListField("aluminum", "allowedSizes", c ? aluminumSizes : [])}
                />
                <ChecklistGroup
                  title={t("admin.productOptions.materials")}
                  all={aluminumMaterials}
                  selected={value.aluminum.allowedMaterials}
                  onToggle={(item, c) => toggleListItem("aluminum", "allowedMaterials", item, c)}
                  onSelectAll={(c) => setListField("aluminum", "allowedMaterials", c ? aluminumMaterials : [])}
                />
              </div>
            )}
          </div>
        )}

        {(() => {
          const consolidated = (config as { is_consolidated?: boolean }).is_consolidated;
          const enabled = (config as { enabled_product_types?: string[] }).enabled_product_types ?? [];
          return consolidated ? enabled.includes("acrylic") : config.product_type === "acrylic";
        })() && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{t("productKind.acrylic")}</Label>
              <Switch
                checked={value.acrylic?.enabled ?? false}
                onCheckedChange={(c) => toggleEnabled("acrylic", c)}
              />
            </div>
            {value.acrylic?.enabled && (
              <div className="grid gap-4 md:grid-cols-2">
                <ChecklistGroup
                  title={t("admin.productOptions.allowedSizes")}
                  all={acrylicSizes}
                  selected={value.acrylic.allowedSizes}
                  onToggle={(item, c) => toggleListItem("acrylic", "allowedSizes", item, c)}
                  onSelectAll={(c) => setListField("acrylic", "allowedSizes", c ? acrylicSizes : [])}
                />
                <ChecklistGroup
                  title={t("admin.productOptions.finish")}
                  all={acrylicFinishes}
                  selected={value.acrylic.allowedFinishes}
                  onToggle={(item, c) => toggleListItem("acrylic", "allowedFinishes", item, c)}
                  onSelectAll={(c) => setListField("acrylic", "allowedFinishes", c ? acrylicFinishes : [])}
                />
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Map styles moved to the map LAYER's properties (per-layer toggle + order). */}

      {/* Allowed fonts — per-template customer font picker */}
      <AllowedFontsEditor
        value={value.allowedFonts}
        onChange={(allowedFonts) => onChange({ ...value, allowedFonts })}
      />
    </div>
  );
}

/** A labelled multi-select: a compact dropdown trigger ("N av M valda") that
 *  opens a checkbox list, with a select-all / clear shortcut. */
function ChecklistGroup({
  title,
  all,
  selected,
  onToggle,
  onSelectAll,
}: {
  title: string;
  all: string[];
  selected: string[];
  onToggle: (item: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const selectedCount = all.filter((i) => selected.includes(i)).length;
  const allSelected = all.length > 0 && selectedCount === all.length;
  const empty = all.length === 0;
  const summary = empty
    ? t("admin.multiSelect.noOptions")
    : selectedCount === 0
      ? t("admin.multiSelect.noneSelected")
      : t("admin.multiSelect.countSelected", { count: selectedCount, total: all.length });

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </p>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={empty}
            className="w-full justify-between font-normal"
          >
            <span className={selectedCount === 0 ? "text-muted-foreground" : ""}>{summary}</span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">{title}</span>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => onSelectAll(!allSelected)}
            >
              {allSelected ? t("admin.multiSelect.clearAll") : t("admin.multiSelect.selectAll")}
            </button>
          </div>
          <div className="max-h-64 space-y-0.5 overflow-auto p-2">
            {all.map((item) => {
              const checked = selected.includes(item);
              return (
                <label
                  key={item}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => onToggle(item, Boolean(c))}
                  />
                  <span>{item}</span>
                </label>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
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
  const { t } = useTranslation();
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
              <h2 className="text-base font-semibold">{t("admin.fonts.title")}</h2>
              <p className="text-xs text-muted-foreground font-normal">
                {t("admin.fonts.subtitle", { count: enabledCount, total: FONT_FAMILIES.length })}
              </p>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-5 pb-5 space-y-3">
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={enableAll}>
                {t("admin.fonts.enableAll")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={disableAll}>
                {t("admin.fonts.disableAll")}
              </Button>
            </div>
            {(["sans", "serif", "display", "script", "mono"] as FontCategory[]).map((cat) => {
              const items = FONT_CATALOG.filter((f) => f.category === cat);
              if (items.length === 0) return null;
              return (
                <div key={cat} className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t(`admin.fonts.category.${cat}`, { defaultValue: FONT_CATEGORY_LABELS[cat] })}
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

