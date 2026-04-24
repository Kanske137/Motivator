// Shopify publishing metadata editor — Fas 3.
// Edits the Shopify-side fields stored on product_configs. These are sent
// to Shopify on the next sync, with diff-protection: fields edited manually
// in Shopify Admin will not be overwritten.
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductConfig, ProductStatus } from "@/lib/product-config";

interface Props {
  config: ProductConfig;
  onChange: (patch: Partial<ProductConfig>) => void;
}

export default function ShopifyPublishingSection({ config, onChange }: Props) {
  const [tagInput, setTagInput] = useState("");
  const tags = config.tags ?? [];
  const salesChannels = config.sales_channels ?? ["online_store"];

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) return;
    onChange({ tags: [...tags, t] });
    setTagInput("");
  }

  function removeTag(t: string) {
    onChange({ tags: tags.filter((x) => x !== t) });
  }

  function toggleChannel(channel: string, checked: boolean) {
    const next = checked
      ? [...new Set([...salesChannels, channel])]
      : salesChannels.filter((c) => c !== channel);
    onChange({ sales_channels: next });
  }

  return (
    <Card className="p-5">
      <Accordion type="single" collapsible defaultValue="">
        <AccordionItem value="shopify" className="border-0">
          <AccordionTrigger className="py-0 hover:no-underline">
            <div className="text-left">
              <h2 className="text-base font-semibold">Shopify-publicering</h2>
              <p className="text-xs text-muted-foreground font-normal">
                Status, taggar, kategori, beskrivning & SEO. Ändringar skickas vid nästa synk.
              </p>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-4 space-y-5">
            {/* Handle (read-only) */}
            <div className="space-y-1.5">
              <Label className="text-xs">Handle (låst efter skapande)</Label>
              <Input
                value={config.shopify_handle}
                readOnly
                className="font-mono text-xs bg-muted"
              />
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <Label className="text-xs">Status i Shopify</Label>
              <Select
                value={config.status ?? "DRAFT"}
                onValueChange={(v) => onChange({ status: v as ProductStatus })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRAFT">Draft (synlig endast i admin)</SelectItem>
                  <SelectItem value="ACTIVE">Active (publicerad)</SelectItem>
                  <SelectItem value="ARCHIVED">Archived (dold)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Sales channels */}
            <div className="space-y-2">
              <Label className="text-xs">Försäljningskanaler</Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ch-online"
                  checked={salesChannels.includes("online_store")}
                  onCheckedChange={(v) => toggleChannel("online_store", v === true)}
                />
                <Label htmlFor="ch-online" className="text-sm font-normal cursor-pointer">
                  Online Store
                </Label>
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label className="text-xs">Taggar (utöver auto-taggar)</Label>
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="t.ex. presenttips"
                  className="h-9"
                />
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <Badge key={t} variant="secondary" className="gap-1">
                      {t}
                      <button onClick={() => removeTag(t)} aria-label={`Ta bort ${t}`}>
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Auto-taggar (mall-slug, produkttyp, "personalized", "print-on-demand") läggs alltid till.
              </p>
            </div>

            {/* Category override */}
            <div className="space-y-1.5">
              <Label className="text-xs">Kategori-GID (valfritt — annars auto)</Label>
              <Input
                value={config.category_gid ?? ""}
                onChange={(e) =>
                  onChange({ category_gid: e.target.value.trim() || null })
                }
                placeholder="gid://shopify/TaxonomyCategory/ap-2-1-3"
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Default: Posters → ap-2-1-3, Canvas → ap-2-1-1.
              </p>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-xs">Beskrivning (HTML)</Label>
              <Textarea
                value={config.description_html ?? ""}
                onChange={(e) => onChange({ description_html: e.target.value })}
                placeholder="<p>Personlig design — skapas i editorn.</p>"
                className="min-h-[100px] font-mono text-xs"
              />
            </div>

            {/* SEO */}
            <SeoField
              label="SEO-titel"
              max={60}
              value={config.seo_title ?? ""}
              placeholder={config.title}
              onChange={(v) => onChange({ seo_title: v })}
              multiline={false}
            />
            <SeoField
              label="SEO-beskrivning"
              max={160}
              value={config.seo_description ?? ""}
              onChange={(v) => onChange({ seo_description: v })}
              multiline
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}

function SeoField({
  label,
  max,
  value,
  placeholder,
  onChange,
  multiline,
}: {
  label: string;
  max: number;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  multiline: boolean;
}) {
  const count = value.length;
  const warn = count >= Math.floor(max * 0.9);
  const over = count >= max;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span
          className={cn(
            "text-[10px] tabular-nums text-muted-foreground",
            warn && "text-foreground",
            over && "text-destructive font-medium",
          )}
        >
          {count}/{max}
        </span>
      </div>
      {multiline ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={max}
          className="min-h-[60px]"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={max}
          className="h-9"
        />
      )}
    </div>
  );
}
