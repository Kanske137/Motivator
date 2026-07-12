// Per-template price overrides. Shows the variants THIS template offers (from
// its productOptions) with the tenant's global default as placeholder; typing a
// value overrides just that variant for this template (written to
// template.priceOverrides). Empty = use the global default.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ProductOptions } from "@/lib/template-schema";

type Overrides = Record<string, Record<string, Record<string, number>>>;
type GlobalPrices = Record<string, Record<string, Record<string, number>>>;

interface MaterialView {
  key: string;
  label: string;
  variantLabel: string;
  sizes: string[];
  variants: string[];
}

function materialsFrom(po: ProductOptions, t: TFunction): MaterialView[] {
  const out: MaterialView[] = [];
  if (po.poster?.enabled)
    out.push({ key: "poster", label: t("admin.pricing.productPoster"), variantLabel: t("admin.pricing.variantLabelFrame"), sizes: po.poster.allowedSizes ?? [], variants: po.poster.allowedFrames ?? [] });
  if (po.canvas?.enabled)
    out.push({ key: "canvas", label: t("admin.pricing.productCanvas"), variantLabel: t("admin.pricing.variantLabelDepth"), sizes: po.canvas.allowedSizes ?? [], variants: po.canvas.allowedDepths ?? [] });
  if (po.aluminum?.enabled)
    out.push({ key: "aluminum", label: t("admin.pricing.productAluminum"), variantLabel: t("admin.pricing.variantLabelVariant"), sizes: po.aluminum.allowedSizes ?? [], variants: po.aluminum.allowedMaterials ?? [] });
  if (po.acrylic?.enabled)
    out.push({ key: "acrylic", label: t("admin.pricing.productAcrylic"), variantLabel: t("admin.pricing.variantLabelFinish"), sizes: po.acrylic.allowedSizes ?? [], variants: po.acrylic.allowedFinishes ?? [] });
  return out;
}

interface Props {
  productOptions: ProductOptions;
  overrides: Overrides;
  globalPrices: GlobalPrices;
  currency: string | null;
  onChange: (o: Overrides) => void;
}

export default function PriceOverrideSection({
  productOptions,
  overrides,
  globalPrices,
  currency,
  onChange,
}: Props) {
  const { t } = useTranslation();
  const materials = materialsFrom(productOptions, t);
  const [active, setActive] = useState(materials[0]?.key ?? "");

  if (materials.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("admin.pricing.noMaterials")}
      </p>
    );
  }

  const activeMaterial = materials.find((m) => m.key === active) ?? materials[0];

  function setOverride(material: string, size: string, variant: string, value: string) {
    const next: Overrides = structuredClone(overrides ?? {});
    const num = Number(value);
    if (value === "" || Number.isNaN(num) || num < 0) {
      if (next[material]?.[size]) {
        delete next[material][size][variant];
        if (Object.keys(next[material][size]).length === 0) delete next[material][size];
        if (Object.keys(next[material]).length === 0) delete next[material];
      }
    } else {
      ((next[material] ??= {})[size] ??= {})[variant] = num;
    }
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {materials.map((m) => (
          <Button
            key={m.key}
            type="button"
            variant={activeMaterial.key === m.key ? "default" : "outline"}
            size="sm"
            onClick={() => setActive(m.key)}
          >
            {m.label}
          </Button>
        ))}
      </div>

      <Card className="p-4 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left font-medium p-2 sticky left-0 bg-card">{t("admin.pricing.sizeColumn")}</th>
              {activeMaterial.variants.map((v) => (
                <th key={v} className="text-left font-medium p-2 whitespace-nowrap">{v}</th>
              ))}
            </tr>
            <tr>
              <th className="p-0" />
              <th
                className="text-left text-xs text-muted-foreground font-normal px-2 pb-2"
                colSpan={activeMaterial.variants.length}
              >
                {t("admin.pricing.overrideHint", { variantLabel: activeMaterial.variantLabel, currency: currency ?? t("admin.pricing.storeCurrency") })}
              </th>
            </tr>
          </thead>
          <tbody>
            {activeMaterial.sizes.map((size) => (
              <tr key={size} className="border-t">
                <td className="p-2 font-mono text-xs whitespace-nowrap sticky left-0 bg-card">{size}</td>
                {activeMaterial.variants.map((variant) => {
                  const global = globalPrices[activeMaterial.key]?.[size]?.[variant];
                  const override = overrides?.[activeMaterial.key]?.[size]?.[variant];
                  return (
                    <td key={variant} className="p-1">
                      <Input
                        type="number"
                        min={0}
                        inputMode="decimal"
                        placeholder={global != null ? String(global) : "—"}
                        className="h-8 w-24"
                        value={override != null ? String(override) : ""}
                        onChange={(e) => setOverride(activeMaterial.key, size, variant, e.target.value)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-muted-foreground">
        {t("admin.pricing.footerNote")}
      </p>
    </div>
  );
}
