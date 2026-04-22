// Section A of the admin designer: choose product types + which sizes/frames/depths
// are available for this template. Pure UI — owns no state, just calls back.
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ProductConfig } from "@/lib/product-config";
import type { ProductOptions } from "@/lib/template-schema";

interface Props {
  config: ProductConfig;
  value: ProductOptions;
  onChange: (next: ProductOptions) => void;
}

type Kind = "poster" | "canvas";

export default function ProductOptionsSection({ config, value, onChange }: Props) {
  const allSizes = useMemo(() => config.sizes.map((s) => s.size), [config]);
  const allVariantNames = useMemo(
    () => Array.from(new Set(config.sizes.flatMap((s) => s.variants.map((v) => v.name)))),
    [config],
  );

  function toggleEnabled(kind: Kind, enabled: boolean) {
    const next: ProductOptions = { ...value };
    if (kind === "poster") {
      next.poster = {
        enabled,
        allowedSizes: value.poster?.allowedSizes ?? allSizes,
        allowedFrames: value.poster?.allowedFrames ?? allVariantNames,
      };
    } else {
      next.canvas = {
        enabled,
        allowedSizes: value.canvas?.allowedSizes ?? allSizes,
        allowedDepths: value.canvas?.allowedDepths ?? allVariantNames,
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

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Produkt & varianter</h2>
        <p className="text-xs text-muted-foreground">
          Välj vilka produkter, storlekar och varianter den här mallen säljs som.
        </p>
      </div>

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
              all={allSizes}
              selected={value.poster.allowedSizes}
              onToggle={(item, c) => toggleListItem("poster", "allowedSizes", item, c)}
            />
            <ChecklistGroup
              title="Tillåtna ramar"
              all={allVariantNames}
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
              all={allSizes}
              selected={value.canvas.allowedSizes}
              onToggle={(item, c) => toggleListItem("canvas", "allowedSizes", item, c)}
            />
            <ChecklistGroup
              title="Tillåtna djup"
              all={allVariantNames}
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
