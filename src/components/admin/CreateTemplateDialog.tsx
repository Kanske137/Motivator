// Dialog for creating a new product template (config row).
// Asks for title, auto-slugged Shopify handle, and which product types to seed.
// Inserts one product_configs row PER selected product type — they all share
// the same template_slug so they appear together in the customer Format toggle.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { invokeAdmin, invokeWithSession } from "@/lib/admin-api";
import { DEFAULT_PRODUCT_VARIANTS } from "@/lib/product-defaults";
import { pickableBases, ProductIcon } from "@/lib/pod";
import { useProductBases } from "@/hooks/useProductBases";
import type { Template } from "@/lib/template-schema";
import type { ProductType } from "@/lib/product-config";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Kind = "poster" | "canvas" | "aluminum" | "acrylic";

const KIND_META: Record<
  Kind,
  { i18nKey: string; productType: ProductType; suffix: string }
> = {
  poster:   { i18nKey: "productKind.poster",   productType: "posters",  suffix: "-poster" },
  canvas:   { i18nKey: "productKind.canvas",   productType: "canvas",   suffix: "-canvas" },
  aluminum: { i18nKey: "productKind.aluminum", productType: "aluminum", suffix: "-aluminum" },
  acrylic:  { i18nKey: "productKind.acrylic",  productType: "acrylic",  suffix: "-acrylic" },
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-");
}

function buildSeedTemplate(kinds: Kind[], baseIds: string[]): Template {
  const productOptions: Template["productOptions"] = {};
  if (kinds.includes("poster")) {
    productOptions.poster = {
      enabled: true,
      allowedSizes: [...DEFAULT_PRODUCT_VARIANTS.poster.sizes],
      allowedFrames: [...DEFAULT_PRODUCT_VARIANTS.poster.frames],
    };
  }
  if (kinds.includes("canvas")) {
    productOptions.canvas = {
      enabled: true,
      allowedSizes: [...DEFAULT_PRODUCT_VARIANTS.canvas.sizes],
      allowedDepths: [...DEFAULT_PRODUCT_VARIANTS.canvas.depths],
    };
  }
  if (kinds.includes("aluminum")) {
    productOptions.aluminum = {
      enabled: true,
      allowedSizes: [...DEFAULT_PRODUCT_VARIANTS.aluminum.sizes],
      allowedMaterials: [...DEFAULT_PRODUCT_VARIANTS.aluminum.materials],
    };
  }
  if (kinds.includes("acrylic")) {
    productOptions.acrylic = {
      enabled: true,
      allowedSizes: [...DEFAULT_PRODUCT_VARIANTS.acrylic.sizes],
      allowedFinishes: [...DEFAULT_PRODUCT_VARIANTS.acrylic.finishes],
    };
  }
  // Generic POD-catalog bases (mugs, apparel, …). Seeded with no axis selection
  // = "offer all values"; the merchant narrows them on the designer page.
  if (baseIds.length > 0) {
    productOptions.bases = baseIds.map((baseId) => ({
      baseId,
      provider: "gelato",
      enabled: true,
      selectedAxes: {},
    }));
  }
  return {
    version: 1,
    publishedAt: null,
    productOptions,
    orientations: ["portrait", "landscape"],
    defaultLayout: {
      portrait: { aspect: "3:4", background: { color: "#EFE7D6" }, layers: [] },
      landscape: { aspect: "4:3", background: { color: "#EFE7D6" }, layers: [] },
    },
    sizeOverrides: {},
    extraLayouts: [],
  };
}

/** One selectable product row: representative icon + name + checkbox. */
function ProductRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/40">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted/30 text-muted-foreground">
        <ProductIcon id={id} className="h-5 w-5" />
      </span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} />
    </label>
  );
}

export default function CreateTemplateDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [handle, setHandle] = useState("");
  const [handleEdited, setHandleEdited] = useState(false);
  // Unified selection keyed by product-type id: a wall-art Kind OR a base id.
  const [selected, setSelected] = useState<Record<string, boolean>>({
    poster: true,
    canvas: true,
    aluminum: true,
    acrylic: true,
  });
  const [saving, setSaving] = useState(false);

  const { data: allBases } = useProductBases();
  const bases = pickableBases(allBases);

  useEffect(() => {
    if (!handleEdited) setHandle(slugify(title));
  }, [title, handleEdited]);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setHandle("");
      setHandleEdited(false);
      setSelected({ poster: true, canvas: true, aluminum: true, acrylic: true });
      setSaving(false);
    }
  }, [open]);

  function toggleId(id: string, checked: boolean) {
    setSelected((s) => ({ ...s, [id]: checked }));
  }

  async function handleCreate() {
    if (!title.trim() || !handle.trim()) {
      toast.error(t("admin.createTemplate.titleAndHandleRequired"));
      return;
    }
    const wallArtIds = Object.keys(KIND_META) as Kind[];
    const kinds = wallArtIds.filter((k) => selected[k]);
    const baseIds = bases.map((b) => b.providerProductId).filter((id) => selected[id]);
    if (kinds.length === 0 && baseIds.length === 0) {
      toast.error(t("admin.createTemplate.selectAtLeastOne"));
      return;
    }
    setSaving(true);

    // Konsoliderad mall: en rad i product_configs, en produkt i Shopify.
    // Handle = template_slug = ren slug utan -poster/-canvas-suffix.
    const trimmedHandle = handle.trim();
    const templateSlug = trimmedHandle.replace(/-(poster|posters|canvas|aluminum|acrylic)$/i, "");
    const enabledProductTypes = kinds.map((k) => KIND_META[k].productType);

    const tpl = buildSeedTemplate(kinds, baseIds);
    const baseTextConfig = {
      fonts: ["Inter", "Playfair Display"],
      maxChars: 24,
      defaultFont: "Inter",
    } as unknown as never;
    const baseStyles = ["light-v11", "dark-v11", "outdoors-v12", "satellite-v9"] as unknown as never;

    // Direct client writes are denied by RLS — go through the tenant-scoped
    // edge function, which stamps installation_id from the verified session token.
    try {
      await invokeAdmin("create", {
        title: title.trim(),
        handle: templateSlug,
        template_slug: templateSlug,
        enabled_product_types: enabledProductTypes,
        template: tpl,
        map_styles: baseStyles,
        text_config: baseTextConfig,
      });
    } catch (e) {
      setSaving(false);
      toast.error(t("admin.createTemplate.createFailed"), {
        description: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    // Synka till Shopify (best-effort).
    const { data: syncData, error: syncErr } = await invokeWithSession(
      "shopify-sync-template",
      { handle: templateSlug },
    );
    setSaving(false);
    if (syncErr || !syncData?.ok) {
      toast.warning(t("admin.createTemplate.createdSyncFailed"), {
        description:
          syncErr?.message ??
          syncData?.error ??
          t("admin.createTemplate.reconnectShopify"),
      });
    } else {
      toast.success(t("admin.createTemplate.createdAndSynced"), {
        description: t("admin.createTemplate.createdVariantsDesc", { count: kinds.length + baseIds.length }),
      });
    }
    onOpenChange(false);
    navigate(`/admin/designer/${templateSlug}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Cap height + let the body scroll: the product list can be long (wall art
          + dozens of catalog products) and must not push the footer off-screen. */}
      <DialogContent className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>{t("admin.createTemplate.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("admin.createTemplate.dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2 pr-1">
          <div className="space-y-2">
            <Label htmlFor="tpl-title">{t("admin.createTemplate.titleLabel")}</Label>
            <Input
              id="tpl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("admin.createTemplate.titlePlaceholder")}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-handle">{t("admin.createTemplate.handleLabel")}</Label>
            <Input
              id="tpl-handle"
              value={handle}
              onChange={(e) => {
                setHandle(slugify(e.target.value));
                setHandleEdited(true);
              }}
              placeholder={t("admin.createTemplate.handlePlaceholder")}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label>{t("admin.createTemplate.productTypesLabel")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("admin.createTemplate.productTypesHint", {
                defaultValue:
                  "Välj vilka produkter samma design ska kunna beställas på. Väggkonsten högst upp, sedan resten av leverantörens katalog. Varje vald produkt blir en egen Shopify-produkt men grupperas ihop för kunden. Du finjusterar storlekar och varianter i nästa steg.",
              })}
            </p>
            {/* One uniform, scrollable picker: icon + name per row, wall art
                first, then the POD catalog bases (mugs, apparel, …). */}
            <div className="max-h-[42vh] overflow-y-auto rounded-md border">
              {(Object.keys(KIND_META) as Kind[]).map((k) => (
                <ProductRow
                  key={k}
                  id={KIND_META[k].productType}
                  label={t(KIND_META[k].i18nKey)}
                  checked={selected[k] ?? false}
                  onChange={(c) => toggleId(k, c)}
                />
              ))}
              {bases.map((b) => (
                <ProductRow
                  key={b.providerProductId}
                  id={b.providerProductId}
                  label={b.title}
                  checked={selected[b.providerProductId] ?? false}
                  onChange={(c) => toggleId(b.providerProductId, c)}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("admin.createTemplate.cancel")}
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("admin.createTemplate.createAndOpen")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
