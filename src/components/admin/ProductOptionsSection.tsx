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
import type { ProductConfig } from "@/lib/product-config";
import type { AiStylePreset, ProductOptions } from "@/lib/template-schema";
import { DEFAULT_PRODUCT_VARIANTS, mergeUnique } from "@/lib/product-defaults";
import { DEFAULT_AI_STYLES } from "@/lib/ai-style-defaults";
import { uploadCartPreview } from "@/lib/upload-preview";
import { toast } from "sonner";

interface Props {
  config: ProductConfig;
  value: ProductOptions;
  onChange: (next: ProductOptions) => void;
}

type Kind = "poster" | "canvas";

export default function ProductOptionsSection({ config, value, onChange }: Props) {
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
    } else {
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
    }
    onChange(next);
  }

  function toggleListItem(
    kind: Kind,
    field: "allowedSizes" | "allowedFrames" | "allowedDepths",
    item: string,
    checked: boolean,
  ) {
    const block = (value as Record<string, unknown>)[kind] as Record<string, unknown> | undefined;
    if (!block) return;
    const current = (block[field] as string[]) ?? [];
    const nextList = checked ? Array.from(new Set([...current, item])) : current.filter((x) => x !== item);
    onChange({ ...value, [kind]: { ...block, [field]: nextList } });
  }

  const showDefaultsBanner = configSizes.length === 0 || configVariantNames.length === 0;

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Produkt & varianter</h2>
        <p className="text-xs text-muted-foreground">
          Välj vilka produkter, storlekar och varianter den här mallen säljs som.
        </p>
      </div>

      {showDefaultsBanner && (
        <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Standardvarianter visas. Gelato-SKU saknas tills du fyller i <code className="font-mono">gelato_sku_map</code> —
            publicering blockeras för storlekar utan SKU.
          </span>
        </div>
      )}

      {/* Poster */}
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

      {/* Canvas */}
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
    </Card>
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
