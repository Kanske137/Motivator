// Admin designer page — Fas 1.
//
// Layout:
//   Header — back / title / Save draft / Publish / Visa som kund
//   Section A — ProductOptionsSection (poster/canvas + sizes/frames/depths)
//   Section B — Orientation tabs + tool palette + LayerCanvas (drag & drop)
//   Section C — LayerList (sidebar) + LayerInspector (right panel)
//
// All template state lives here. Saving writes the whole `template` jsonb to
// product_configs. Publish stamps `publishedAt` and runs zod validation.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ChevronDown, Eye, Image as ImageIcon, Loader2, MapPin, Minus, Save, Send, Shapes, Square, Type, Undo2, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { invokeAdmin, invokeWithSession } from "@/lib/admin-api";
import { type ProductConfig } from "@/lib/product-config";
import { resolveTemplate } from "@/lib/template-migrate";
import {
  parseTemplate,
  type LayerType,
  type Orientation,
  type Template,
  type TemplateLayer,
  DEFAULT_LAYOUT_ID,
} from "@/lib/template-schema";
import { createDefaultLayout, createLayer, createShapeLayer, moveLayer, normaliseZIndex } from "@/lib/layer-utils";
import type { ShapeKind } from "@/lib/template-schema";
import { Sparkles } from "lucide-react";
import ProductOptionsSection from "@/components/admin/ProductOptionsSection";
import PriceOverrideSection from "@/components/admin/PriceOverrideSection";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import ShopifyPublishingSection from "@/components/admin/ShopifyPublishingSection";
import LayerCanvas from "@/components/admin/LayerCanvas";
import LayerList, { toggleAllLocks } from "@/components/admin/LayerList";
import LayerInspector from "@/components/admin/LayerInspector";
import DeleteTemplateDialog from "@/components/admin/DeleteTemplateDialog";
import TemplateThumbnail from "@/components/admin/TemplateThumbnail";
import LanguageToggle from "@/components/admin/LanguageToggle";
import { applyStoredAdminLocale } from "@/lib/admin-locale";

export default function DesignerPage() {
  const { t } = useTranslation();
  // Apply the merchant's saved admin language (default English) on mount.
  useEffect(() => {
    applyStoredAdminLocale();
  }, []);

  const { handle } = useParams<{ handle: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [config, setConfig] = useState<ProductConfig | null>(null);
  // Global default prices (from the Priser tab) + shop currency, shown as
  // reference/placeholder in the per-template price-override editor.
  const [globalPrices, setGlobalPrices] = useState<Record<string, Record<string, Record<string, number>>>>({});
  const [currency, setCurrency] = useState<string | null>(null);
  const [pricesLoading, setPricesLoading] = useState(true);
  const [template, setTemplate] = useState<Template | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Designyta-läge: 'standard' = poster/metall/plexi-layout, 'canvas' = canvas-wrap.
  const [designMode, setDesignMode] = useState<"standard" | "canvas">("standard");
  // Currently edited named-layout id ("Stil"). DEFAULT_LAYOUT_ID = Standard.
  const [editingLayoutId, setEditingLayoutId] = useState<string>(DEFAULT_LAYOUT_ID);

  // Session-only undo stack: snapshots of `template` before each mutation.
  // Cleared on page reload (intentional — user explicitly asked).
  const historyRef = useRef<Template[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  // Wrap setTemplate so every mutating call records the previous state.
  function commitTemplate(next: Template) {
    setTemplate((prev) => {
      if (prev) {
        historyRef.current.push(prev);
        if (historyRef.current.length > 50) historyRef.current.shift();
        setCanUndo(true);
      }
      return next;
    });
  }

  function undo() {
    const prev = historyRef.current.pop();
    if (!prev) return;
    setTemplate(prev);
    setCanUndo(historyRef.current.length > 0);
    setSelectedId(null);
  }

  // Cmd/Ctrl+Z keyboard shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Generate the template's DEFAULT design preview (map + text with resolved
  // city/country) and upload it, so the storefront card can show the generic
  // default on the very first visit (before the customer opens the editor).
  // Best-effort — never blocks sync.
  async function generateDefaultPreview(): Promise<string | undefined> {
    if (!template || !config) return undefined;
    try {
      const { renderTemplateSnapshot } = await import("@/lib/template-snapshot");
      const { uploadCartPreview } = await import("@/lib/upload-preview");
      const pt = productType ?? "posters";
      const allowedSizes =
        template.productOptions.poster?.allowedSizes ??
        template.productOptions.canvas?.allowedSizes ??
        template.productOptions.aluminum?.allowedSizes ??
        template.productOptions.acrylic?.allowedSizes ??
        [];
      const size = allowedSizes[0] ?? "30x40";
      const layers = template.defaultLayout.portrait.layers;
      const mapLayer = layers.find((l) => l.type === "map");
      const mapDefaults = mapLayer && mapLayer.type === "map" ? mapLayer.defaults : null;
      const center: [number, number] = mapDefaults?.center ?? [18.0686, 59.3293];

      // Resolve city/country so [[city]]/[[country]] render (stored default or geocode).
      let city = mapDefaults?.city;
      let country = mapDefaults?.country;
      let placeName = mapDefaults?.placeName;
      if (mapLayer && !city && !country) {
        try {
          const { reverseGeocode } = await import("@/lib/mapbox");
          const r = await reverseGeocode(center[0], center[1]);
          if (r) {
            city = r.city;
            country = r.country;
            placeName = r.place_name;
          }
        } catch {
          /* fall back to coordinates only */
        }
      }
      const layerValues = mapLayer
        ? { [mapLayer.id]: { kind: "map", center, placeName, city, country } }
        : {};

      const dataUrl = await renderTemplateSnapshot({
        template: { ...template, extraLayouts: [] },
        orientation: "portrait",
        size,
        productType: pt,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        layerValues: layerValues as any,
        whiteMarginEnabled: true,
        livePosterBgColor: template.defaultLayout.portrait.background.color,
        liveMapCenter: center,
        liveMapZoom: mapDefaults?.zoom ?? 12,
        liveMapStyleId: mapDefaults?.styleId ?? "light-v11",
        liveMapShape: mapDefaults?.shape ?? "circle",
        liveShowLabels: mapDefaults?.showLabels ?? false,
        liveTextVisible: true,
        hires: true,
      });
      return await uploadCartPreview(dataUrl, `tmpl-preview-${handle}-${Date.now()}`);
    } catch (e) {
      console.warn("[default-preview] generation failed", e);
      return undefined;
    }
  }

  async function syncToShopify() {
    if (!handle) return;
    setSyncing(true);
    const previewUrl = await generateDefaultPreview();
    const { data, error } = await invokeWithSession("shopify-sync-template", {
      handle,
      previewUrl,
    });
    setSyncing(false);
    const code = (data as { code?: string } | null)?.code;
    if (error || !data?.ok) {
      const isAuth = code === "invalid_token" || code === "no_token" || code === "missing_scope";
      toast.error(isAuth ? t("admin.designer.syncInvalidTitle") : t("admin.designer.syncFailedTitle"), {
        description: isAuth
          ? t("admin.designer.syncAuthDescription")
          : (error?.message ?? data?.error ?? t("admin.designer.unknownError")),
      });
    } else {
      // Invalidate the variant resolver cache so the editor picks up newly
      // created variants on the next add-to-cart (within the same session).
      const { clearVariantResolverCache } = await import("@/lib/shopify-variant-resolver");
      clearVariantResolverCache();

      const results = (data.results ?? []) as Array<{
        kind: string;
        plannedVariants: number;
        variantsCreated: number;
        variantsUpdated: number;
        variantsDeleted: number;
        publishedToOnlineStore: boolean;
        skipped: { size: string; variant: string; reason: string }[];
        skippedFields?: { field: string; reason: string }[];
      }>;
      const totalCreated = results.reduce((n, r) => n + (r.variantsCreated ?? 0), 0);
      const totalUpdated = results.reduce((n, r) => n + (r.variantsUpdated ?? 0), 0);
      const totalSkipped = results.reduce((n, r) => n + (r.skipped?.length ?? 0), 0);
      const totalSkippedFields = results.reduce(
        (n, r) => n + (r.skippedFields?.length ?? 0),
        0,
      );
      const allPublished = results.every((r) => r.publishedToOnlineStore);
      const parts: string[] = [];
      parts.push(t("admin.designer.productCount", { count: results.length }));
      if (totalCreated) parts.push(t("admin.designer.newVariants", { count: totalCreated }));
      if (totalUpdated) parts.push(t("admin.designer.updatedVariants", { count: totalUpdated }));
      if (totalSkipped) parts.push(t("admin.designer.skippedVariants", { count: totalSkipped }));
      parts.push(
        allPublished ? t("admin.designer.publishedToStore") : t("admin.designer.notPublishedToStore"),
      );
      toast.success(t("admin.designer.syncedToShopify"), { description: parts.join(" · ") });
      if (totalSkippedFields > 0) {
        const sample = results
          .flatMap((r) => r.skippedFields ?? [])
          .slice(0, 5)
          .map((f) => `${f.field} (${f.reason})`)
          .join(", ");
        toast.warning(t("admin.designer.skippedFields", { count: totalSkippedFields }), {
          description: sample,
        });
      }
    }
  }

  useEffect(() => {
    if (!handle) return;
    (async () => {
      setLoading(true);
      // Load via the tenant-scoped guard (not the anon client) so DRAFT
      // templates are visible to the admin — RLS only exposes ACTIVE to anon.
      let cfg: ProductConfig | null = null;
      try {
        const res = await invokeAdmin<{ config: ProductConfig | null }>("get", { handle });
        cfg = res.config ?? null;
      } catch (e) {
        toast.error(t("admin.designer.loadTemplateFailed"), {
          description: e instanceof Error ? e.message : String(e),
        });
        setLoading(false);
        return;
      }
      if (!cfg) {
        toast.error(t("admin.designer.productNotFound"));
        setLoading(false);
        return;
      }
      const raw = (cfg as unknown as { template?: unknown }).template;
      const { template: tpl, fellBack } = resolveTemplate(cfg, raw);
      if (fellBack) {
        toast.message(t("admin.designer.legacyConfigTitle"), {
          description: t("admin.designer.legacyConfigDescription"),
        });
      }
      setConfig(cfg);
      setTemplate(tpl);
      setLoading(false);
    })();
  }, [handle]);

  useEffect(() => {
    (async () => {
      try {
        const res = await invokeAdmin<{
          prices: { material: string; size: string; variant: string; price: number }[];
          currency: string | null;
        }>("prices-list", {}, "admin-settings");
        const map: Record<string, Record<string, Record<string, number>>> = {};
        for (const r of res.prices ?? []) {
          ((map[r.material] ??= {})[r.size] ??= {})[r.variant] = Number(r.price);
        }
        setGlobalPrices(map);
        setCurrency(res.currency ?? null);
      } catch {
        // Non-fatal — overrides still work, just without reference defaults.
      } finally {
        setPricesLoading(false);
      }
    })();
  }, []);

  // For canvas products we edit `canvasLayout` (separate from poster).
  // Konsoliderade mallar väljer via `designMode`-toggle istället för product_type.
  const isConsolidated = !!config?.is_consolidated;
  const enabledTypes = config?.enabled_product_types ?? [];
  const consolidatedHasCanvas = isConsolidated && enabledTypes.includes("canvas");
  const consolidatedHasNonCanvas = isConsolidated && enabledTypes.some((t) => t !== "canvas");
  const showDesignModeToggle = consolidatedHasCanvas && consolidatedHasNonCanvas;
  const isCanvasProduct = isConsolidated
    ? designMode === "canvas"
    : config?.product_type === "canvas";
  // Resolve the currently edited named-layout block (Standard or extra "Stil").
  const isStandardLayout = editingLayoutId === DEFAULT_LAYOUT_ID;
  const editingExtraIndex = isStandardLayout
    ? -1
    : (template?.extraLayouts ?? []).findIndex((l) => l.id === editingLayoutId);
  const layoutBlock = template
    ? (() => {
        if (isStandardLayout) {
          return (isCanvasProduct && template.canvasLayout) || template.defaultLayout;
        }
        const extra = template.extraLayouts?.[editingExtraIndex];
        if (!extra) return template.defaultLayout;
        return (isCanvasProduct && extra.canvasLayout) || extra.defaultLayout;
      })()
    : null;
  const layout = layoutBlock?.[orientation] ?? null;
  const layers = useMemo(() => layout?.layers ?? [], [layout]);
  const selectedLayer = useMemo(
    () => layers.find((l) => l.id === selectedId) ?? null,
    [layers, selectedId],
  );

  // Mutate the active orientation block (layers/background) on the active named layout.
  function patchOrientationBlock(patch: { layers?: TemplateLayer[]; background?: { color: string } }) {
    if (!template || !layoutBlock) return;
    const cur = layoutBlock[orientation];
    const nextOrient = {
      ...cur,
      ...(patch.layers ? { layers: patch.layers } : {}),
      ...(patch.background ? { background: patch.background } : {}),
    };
    if (isStandardLayout) {
      if (isCanvasProduct) {
        const cl = template.canvasLayout ?? template.defaultLayout;
        commitTemplate({ ...template, canvasLayout: { ...cl, [orientation]: nextOrient } });
      } else {
        commitTemplate({
          ...template,
          defaultLayout: { ...template.defaultLayout, [orientation]: nextOrient },
        });
      }
    } else {
      const extras = [...(template.extraLayouts ?? [])];
      const cur = extras[editingExtraIndex];
      if (!cur) return;
      const nextExtra = { ...cur };
      if (isCanvasProduct) {
        const cl = cur.canvasLayout ?? cur.defaultLayout;
        nextExtra.canvasLayout = { ...cl, [orientation]: nextOrient };
      } else {
        nextExtra.defaultLayout = { ...cur.defaultLayout, [orientation]: nextOrient };
      }
      extras[editingExtraIndex] = nextExtra;
      commitTemplate({ ...template, extraLayouts: extras });
    }
  }

  // ---------- mutators ----------
  function setLayers(next: TemplateLayer[]) {
    patchOrientationBlock({ layers: next });
  }

  function setLayoutBackground(color: string) {
    patchOrientationBlock({ background: { color } });
  }
  function addLayer(type: LayerType) {
    const nextLayer = createLayer(type, layers);
    setLayers(normaliseZIndex([...layers, nextLayer]));
    setSelectedId(nextLayer.id);
  }
  function addShape(kind: ShapeKind) {
    const nextLayer = createShapeLayer(kind, layers);
    setLayers(normaliseZIndex([...layers, nextLayer]));
    setSelectedId(nextLayer.id);
  }

  function updateLayer(updated: TemplateLayer) {
    setLayers(layers.map((l) => (l.id === updated.id ? updated : l)));
  }

  function deleteLayer(id: string) {
    setLayers(normaliseZIndex(layers.filter((l) => l.id !== id)));
    if (selectedId === id) setSelectedId(null);
  }

  function reorder(id: string, direction: "up" | "down") {
    setLayers(moveLayer(layers, id, direction));
  }

  function toggleVisibility(id: string) {
    const target = layers.find((l) => l.id === id);
    if (!target) return;
    updateLayer({
      ...target,
      locks: { ...target.locks, visibility: !target.locks.visibility },
    });
  }

  function toggleLockAll(id: string) {
    const target = layers.find((l) => l.id === id);
    if (!target) return;
    updateLayer(toggleAllLocks(target));
  }

  function toggleOrientationEnabled(o: Orientation, enabled: boolean) {
    if (!template) return;
    const current = template.orientations;
    const set = new Set(current);
    if (enabled) set.add(o);
    else set.delete(o);
    if (set.size === 0) {
      toast.error(t("admin.designer.minOneOrientation"));
      return;
    }
    const nextOrients: Orientation[] = (["portrait", "landscape"] as Orientation[]).filter(
      (k) => set.has(k),
    );
    commitTemplate({ ...template, orientations: nextOrients });
    if (!set.has(orientation)) {
      const fallback = nextOrients[0];
      if (fallback) setOrientation(fallback);
    }
  }

  // ---------- persist ----------
  function updateConfigMeta(patch: Partial<ProductConfig>) {
    if (!config) return;
    setConfig({ ...config, ...patch });
  }

  async function persistTemplate(opts: { publish: boolean }) {
    if (!handle || !template || !config) return;
    const finalTemplate: Template = opts.publish
      ? { ...template, publishedAt: new Date().toISOString() }
      : template;

    const parsed = parseTemplate(finalTemplate);
    if (parsed.ok !== true) {
      console.error(parsed.error);
      toast.error(t("admin.designer.templateInvalid"), { description: parsed.error.issues[0]?.message });
      return;
    }

    setSaving(true);
    // Sync legacy `map_styles` column from new productOptions.mapStyles so
    // older code paths (Shopify sync, customer editor fallback) stay in sync.
    const enabledMapStyleIds = (finalTemplate.productOptions?.mapStyles ?? [])
      .filter((s) => s.enabled !== false)
      .map((s) => s.id);

    // Persist via the tenant-scoped edge function — direct client writes are
    // denied by RLS. The function stamps installation_id from the verified
    // Shopify session token and propagates the shared template to sibling rows
    // (same template_slug) server-side, preserving each sibling's per-type block.
    try {
      await invokeAdmin("save", {
        handle,
        template: finalTemplate,
        template_slug: config.template_slug ?? null,
        map_styles: enabledMapStyleIds,
        isCanvas: isCanvasProduct,
        meta: {
          tags: config.tags ?? [],
          category_gid: config.category_gid ?? null,
          status: config.status ?? "DRAFT",
          sales_channels: config.sales_channels ?? ["online_store"],
          description_html: config.description_html ?? null,
          seo_title: config.seo_title ?? null,
          seo_description: config.seo_description ?? null,
          is_freeform: config.is_freeform ?? false,
        },
      });
    } catch (e) {
      setSaving(false);
      toast.error(t("admin.designer.saveFailed"), {
        description: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    setSaving(false);
    setTemplate(finalTemplate);
    toast.success(opts.publish ? t("admin.designer.published") : t("admin.designer.savedAsDraft"));
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config || !template || !layout) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">{t("admin.designer.templateLoadError")}</p>
        <Button asChild variant="outline">
          <Link to="/admin/configs">{t("admin.designer.back")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-3 min-w-0">
            <Button asChild variant="ghost" size="icon">
              <Link to="/admin/configs" aria-label={t("admin.designer.back")}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">{config.title}</h1>
              <p className="text-xs text-muted-foreground font-mono truncate">
                {config.shopify_handle}
                {template.publishedAt ? t("admin.designer.publishedSuffix") : t("admin.designer.draftSuffix")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <LanguageToggle />
            <Button asChild variant="ghost" size="sm">
              <a
                href={`/editor?handle=${handle}&preview=draft`}
                target="_blank"
                rel="noreferrer"
              >
                <Eye className="h-4 w-4 mr-2" />
                {t("admin.designer.viewAsCustomer")}
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={!canUndo}
              title={t("admin.designer.undoTooltip")}
            >
              <Undo2 className="h-4 w-4 mr-2" />
              {t("admin.designer.undo")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => persistTemplate({ publish: false })}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              {t("admin.designer.saveDraft")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={syncToShopify}
              disabled={syncing}
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
              {t("admin.designer.syncToShopify")}
            </Button>
            <Button
              size="sm"
              onClick={() => persistTemplate({ publish: true })}
              disabled={saving}
            >
              <Send className="h-4 w-4 mr-2" />
              {t("admin.designer.publish")}
            </Button>
            <DeleteTemplateDialog
              productConfigId={config.id}
              shopifyHandle={config.shopify_handle}
              title={config.title}
            />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <ProductOptionsSection
          config={config}
          value={template.productOptions}
          onChange={(productOptions) => commitTemplate({ ...template, productOptions })}
        />

        <Card className="p-0 overflow-hidden">
          <Accordion type="single" collapsible defaultValue="">
            <AccordionItem value="price-overrides" className="border-0">
              <AccordionTrigger className="px-5 py-4 hover:no-underline">
                <div className="text-left">
                  <h2 className="text-base font-semibold">{t("admin.designer.priceOverrideTitle")}</h2>
                  <p className="text-xs text-muted-foreground font-normal">
                    {t("admin.designer.priceOverrideDescription")}
                  </p>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-5 pb-5">
                {pricesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> {t("admin.designer.loadingPrices")}
                  </div>
                ) : (
                  <PriceOverrideSection
                    productOptions={template.productOptions}
                    overrides={template.priceOverrides ?? {}}
                    globalPrices={globalPrices}
                    currency={currency}
                    onChange={(priceOverrides) => commitTemplate({ ...template, priceOverrides })}
                  />
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>

        <ShopifyPublishingSection config={config} onChange={updateConfigMeta} />

        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{t("admin.designer.freeformTitle")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("admin.designer.freeformDescription")}
              </p>
            </div>
            <Switch
              checked={!!config.is_freeform}
              onCheckedChange={(v) => updateConfigMeta({ is_freeform: v })}
            />
          </div>
        </Card>

        <StylesSection
          template={template}
          editingLayoutId={editingLayoutId}
          productType={config.product_type}
          onSelect={(id) => { setEditingLayoutId(id); setSelectedId(null); }}
          onChange={(next) => commitTemplate(next)}
        />

        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold">{t("admin.designer.canvasTitle")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("admin.designer.canvasSubtitle")}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Tabs value={orientation} onValueChange={(v) => setOrientation(v as Orientation)}>
                <TabsList>
                  <TabsTrigger value="portrait" disabled={!template.orientations.includes("portrait")}>
                    {t("admin.designer.portrait")}
                  </TabsTrigger>
                  <TabsTrigger value="landscape" disabled={!template.orientations.includes("landscape")}>
                    {t("admin.designer.landscape")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {showDesignModeToggle && (
                <Tabs value={designMode} onValueChange={(v) => { setDesignMode(v as "standard" | "canvas"); setSelectedId(null); }}>
                  <TabsList>
                    <TabsTrigger value="standard">{t("admin.designer.designModeStandard")}</TabsTrigger>
                    <TabsTrigger value="canvas">{t("admin.designer.designModeCanvas")}</TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
              <div className="flex items-center gap-3 px-2 border-l border-r h-9">
                <Label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Switch
                    checked={template.orientations.includes("portrait")}
                    onCheckedChange={(c) => toggleOrientationEnabled("portrait", c)}
                  />
                  {t("admin.designer.activePortrait")}
                </Label>
                <Label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Switch
                    checked={template.orientations.includes("landscape")}
                    onCheckedChange={(c) => toggleOrientationEnabled("landscape", c)}
                  />
                  {t("admin.designer.activeLandscape")}
                </Label>
              </div>
              <Button size="sm" variant="outline" onClick={() => addLayer("map")}>
                <MapPin className="h-3.5 w-3.5 mr-1.5" />
                {t("admin.designer.addMap")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => addLayer("text")}>
                <Type className="h-3.5 w-3.5 mr-1.5" />
                {t("admin.designer.addText")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => addLayer("photo")}>
                <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
                {t("admin.designer.addImage")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Shapes className="h-3.5 w-3.5 mr-1.5" />
                    {t("admin.designer.addShape")}
                    <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => addShape("line-horizontal")}>
                    <Minus className="h-3.5 w-3.5 mr-2" /> {t("admin.designer.shapeHorizontalLine")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => addShape("line-vertical")}>
                    <Minus className="h-3.5 w-3.5 mr-2 rotate-90" /> {t("admin.designer.shapeVerticalLine")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => addShape("frame-rect")}>
                    <Square className="h-3.5 w-3.5 mr-2" /> {t("admin.designer.shapeRectFrame")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => addShape("frame-oval")}>
                    <Square className="h-3.5 w-3.5 mr-2 rounded-full" /> {t("admin.designer.shapeOvalFrame")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => addShape("frame-rounded")}>
                    <Square className="h-3.5 w-3.5 mr-2" /> {t("admin.designer.shapeRoundedFrame")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => addShape("frame-double")}>
                    <Square className="h-3.5 w-3.5 mr-2" /> {t("admin.designer.shapeDoubleFrame")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => addShape("frame-corners")}>
                    <Square className="h-3.5 w-3.5 mr-2" /> {t("admin.designer.shapeCorners")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="outline" onClick={() => addLayer("margin")}>
                <Square className="h-3.5 w-3.5 mr-1.5" />
                {t("admin.designer.addMargin")}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3 pb-3 border-b mb-4">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t("admin.designer.backgroundColor")}
            </Label>
            <div className="flex flex-wrap gap-2 items-center">
              {["#EFE7D6","#FFFFFF","#F8F4EC","#E5E5E5","#D9CDB5","#D6E4D2","#CFE0EA","#1A1A1A"].map((c) => {
                const selected = layout.background.color.toLowerCase() === c.toLowerCase();
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setLayoutBackground(c)}
                    className={`h-7 w-7 rounded-full transition border ${
                      selected
                        ? "ring-2 ring-primary ring-offset-2 ring-offset-card border-transparent"
                        : "border-border"
                    }`}
                    style={{ background: c }}
                    aria-label={c}
                  />
                );
              })}
              <label className="h-7 w-7 rounded-full border border-dashed border-border flex items-center justify-center cursor-pointer relative overflow-hidden">
                <input
                  type="color"
                  value={layout.background.color}
                  onChange={(e) => setLayoutBackground(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                <span className="text-[10px] text-muted-foreground">+</span>
              </label>
            </div>
            <span className="text-[11px] text-muted-foreground ml-auto">
              {t("admin.designer.setsDefaultBackground", {
                orientation:
                  orientation === "portrait"
                    ? t("admin.designer.portraitLower")
                    : t("admin.designer.landscapeLower"),
              })}
            </span>
          </div>

          {isCanvasProduct && (() => {
            const designDepthCm = template?.productOptions?.canvas?.canvasDesignDepthCm
              ?? (() => {
                const allowed = template?.productOptions?.canvas?.allowedDepths ?? [];
                for (const v of allowed) {
                  const m = v.match(/(\d+(?:[.,]\d+)?)/);
                  if (m) {
                    const n = parseFloat(m[1].replace(",", "."));
                    if (n > 0) return n;
                  }
                }
                return 2;
              })();
            return (
              <div className="text-[11px] text-muted-foreground mb-2 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-sm bg-primary/60 border" />
                {t("admin.designer.canvasDesignHint", { depth: designDepthCm })}
              </div>
            );
          })()}
          <div className="relative">
            <LayerCanvas
              aspect={layout.aspect}
              background={layout.background.color}
              layers={layers}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={updateLayer}
              productType={config?.product_type}
              wrapInsetPctX={0}
              wrapInsetPctY={0}
            />
            {layers.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="pointer-events-auto bg-background/95 backdrop-blur border-2 border-dashed border-primary/40 rounded-lg p-6 text-center max-w-xs shadow-lg">
                  <Sparkles className="h-6 w-6 mx-auto mb-2 text-primary" />
                  <p className="text-sm font-medium mb-1">{t("admin.designer.emptyTitle")}</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    {t("admin.designer.emptyDescription")}
                  </p>
                  <Button
                    size="sm"
                    onClick={() => {
                      const seed = createDefaultLayout();
                      setLayers(seed);
                      setSelectedId(seed[0]?.id ?? null);
                    }}
                  >
                    {t("admin.designer.createDefaultLayout")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Card className="p-5">
            <h2 className="text-base font-semibold mb-3">{t("admin.designer.layers")}</h2>
            <LayerList
              layers={layers}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={reorder}
              onToggleVisibility={toggleVisibility}
              onToggleLockAll={toggleLockAll}
              onDelete={deleteLayer}
            />
          </Card>
          <Card className="p-5">
            <h2 className="text-base font-semibold mb-3">{t("admin.designer.properties")}</h2>
            <LayerInspector
              config={config}
              layer={selectedLayer}
              allLayers={layers}
              productOptions={template?.productOptions ?? null}
              onChange={updateLayer}
              onLayersChange={setLayers}
            />
          </Card>
        </div>
      </main>
    </div>
  );
}

// ---------- Stilar (named layouts) management ----------
function StylesSection({
  template,
  editingLayoutId,
  productType,
  onSelect,
  onChange,
}: {
  template: Template;
  editingLayoutId: string;
  productType: string | null;
  onSelect: (id: string) => void;
  onChange: (t: Template) => void;
}) {
  const { t } = useTranslation();
  const extras = template.extraLayouts ?? [];
  const [thumbDialogId, setThumbDialogId] = useState<string | null>(null);
  const [thumbUrlDraft, setThumbUrlDraft] = useState("");
  const [thumbMode, setThumbMode] = useState<"url" | "file">("url");
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const isStandard = (id: string) => id === DEFAULT_LAYOUT_ID;

  function addEmpty() {
    const id = `style-${Date.now().toString(36)}`;
    const fresh = {
      portrait: { aspect: template.defaultLayout.portrait.aspect, background: { color: "#FFFFFF" }, layers: [] },
      landscape: { aspect: template.defaultLayout.landscape.aspect, background: { color: "#FFFFFF" }, layers: [] },
    };
    onChange({ ...template, extraLayouts: [...extras, { id, name: t("admin.designer.styleDefaultNameNumbered", { number: extras.length + 1 }), defaultLayout: fresh }] });
    onSelect(id);
  }

  function duplicateCurrent() {
    const id = `style-${Date.now().toString(36)}`;
    const src = isStandard(editingLayoutId)
      ? { defaultLayout: template.defaultLayout, canvasLayout: template.canvasLayout }
      : (() => {
          const e = extras.find((l) => l.id === editingLayoutId);
          return e ? { defaultLayout: e.defaultLayout, canvasLayout: e.canvasLayout } : null;
        })();
    if (!src) return;
    const cloned: any = JSON.parse(JSON.stringify(src));
    for (const o of ["portrait", "landscape"] as const) {
      cloned.defaultLayout[o].layers = cloned.defaultLayout[o].layers.map((l: TemplateLayer, i: number) => ({ ...l, id: `${l.type}-${id}-${o[0]}-${i}` }));
      if (cloned.canvasLayout) {
        cloned.canvasLayout[o].layers = cloned.canvasLayout[o].layers.map((l: TemplateLayer, i: number) => ({ ...l, id: `${l.type}-${id}-c${o[0]}-${i}` }));
      }
    }
    const baseName = isStandard(editingLayoutId)
      ? (template.defaultLayoutName?.trim() || t("admin.designer.styleDefaultName"))
      : (extras.find((l) => l.id === editingLayoutId)?.name ?? t("admin.designer.styleFallbackName"));
    onChange({ ...template, extraLayouts: [...extras, { id, name: t("admin.designer.styleCopyName", { name: baseName }), ...cloned }] });
    onSelect(id);
  }

  function rename(id: string) {
    if (isStandard(id)) {
      const cur = template.defaultLayoutName?.trim() || t("admin.designer.styleDefaultName");
      const name = window.prompt(t("admin.designer.namePrompt"), cur);
      if (!name?.trim()) return;
      onChange({ ...template, defaultLayoutName: name.trim() });
      return;
    }
    const cur = extras.find((l) => l.id === id);
    if (!cur) return;
    const name = window.prompt(t("admin.designer.namePrompt"), cur.name);
    if (!name?.trim()) return;
    onChange({ ...template, extraLayouts: extras.map((l) => l.id === id ? { ...l, name: name.trim() } : l) });
  }

  function remove(id: string) {
    if (isStandard(id)) return;
    if (!window.confirm(t("admin.designer.removeStyleConfirm"))) return;
    onChange({ ...template, extraLayouts: extras.filter((l) => l.id !== id) });
    if (editingLayoutId === id) onSelect(DEFAULT_LAYOUT_ID);
  }

  function makeDefault(id: string) {
    const cur = extras.find((l) => l.id === id);
    if (!cur) return;
    if (!window.confirm(t("admin.designer.makeDefaultConfirm"))) return;
    const oldStandard = {
      id: `style-${Date.now().toString(36)}`,
      name: template.defaultLayoutName?.trim() || t("admin.designer.previousDefaultName"),
      thumbnailUrl: template.defaultLayoutThumbnailUrl,
      defaultLayout: template.defaultLayout,
      canvasLayout: template.canvasLayout,
    };
    const nextExtras = extras.filter((l) => l.id !== id).concat([oldStandard]);
    onChange({
      ...template,
      defaultLayout: cur.defaultLayout,
      canvasLayout: cur.canvasLayout,
      defaultLayoutName: cur.name,
      defaultLayoutThumbnailUrl: cur.thumbnailUrl,
      extraLayouts: nextExtras,
    });
    onSelect(DEFAULT_LAYOUT_ID);
  }

  function setThumbnailUrl(id: string, url: string | undefined) {
    const trimmed = url?.trim();
    const value = trimmed && trimmed.length > 0 ? trimmed : undefined;
    if (isStandard(id)) {
      onChange({ ...template, defaultLayoutThumbnailUrl: value });
      return;
    }
    onChange({
      ...template,
      extraLayouts: extras.map((l) => l.id === id
        ? { ...l, thumbnailUrl: value }
        : l),
    });
  }

  async function handleFileSelected(id: string, file: File) {
    setUploadingThumb(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const { uploadCartPreview } = await import("@/lib/upload-preview");
      const designId = `style-thumb-${id}-${Date.now()}`;
      const url = await uploadCartPreview(dataUrl, designId);
      setThumbUrlDraft(url);
      setThumbnailUrl(id, url);
      toast.success(t("admin.designer.thumbnailUploaded"));
    } catch (e) {
      console.error("[styles] thumbnail upload failed", e);
      toast.error(t("admin.designer.uploadFailed"), { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setUploadingThumb(false);
    }
  }

  async function generateThumbnail(id: string) {
    const isStd = isStandard(id);
    const sourceBlock = isStd
      ? { defaultLayout: template.defaultLayout, canvasLayout: template.canvasLayout, name: template.defaultLayoutName?.trim() || t("admin.designer.styleDefaultName") }
      : (() => {
          const l = extras.find((x) => x.id === id);
          return l ? { defaultLayout: l.defaultLayout, canvasLayout: l.canvasLayout, name: l.name } : null;
        })();
    if (!sourceBlock) return;
    setGeneratingId(id);
    try {
      const { renderTemplateSnapshot } = await import("@/lib/template-snapshot");
      const { uploadCartPreview } = await import("@/lib/upload-preview");
      const tempTemplate: Template = {
        ...template,
        defaultLayout: sourceBlock.defaultLayout,
        canvasLayout: sourceBlock.canvasLayout,
        extraLayouts: [],
      };
      const allowedSizes = template.productOptions.poster?.allowedSizes
        ?? template.productOptions.canvas?.allowedSizes
        ?? template.productOptions.aluminum?.allowedSizes
        ?? template.productOptions.acrylic?.allowedSizes
        ?? [];
      const size = allowedSizes[0] ?? "30x40";
      const dataUrl = await renderTemplateSnapshot({
        template: tempTemplate,
        orientation: "portrait",
        size,
        productType: productType ?? "posters",
        whiteMarginEnabled: true,
        livePosterBgColor: sourceBlock.defaultLayout.portrait.background.color,
        liveMapCenter: [18.0686, 59.3293],
        liveMapZoom: 12,
        liveMapStyleId: sourceBlock.defaultLayout.portrait.layers.find((l) => l.type === "map")?.defaults.styleId ?? "light-v11",
        liveMapShape: "circle",
        liveShowLabels: false,
        liveText: "",
        liveTextFont: "Inter",
        liveTextVisible: true,
        maxPxOverride: 480,
      });
      const designId = `style-thumb-${id}-${Date.now()}`;
      const url = await uploadCartPreview(dataUrl, designId);
      setThumbUrlDraft(url);
      setThumbnailUrl(id, url);
      toast.success(t("admin.designer.thumbnailGenerated"));
    } catch (e) {
      console.error("[styles] thumbnail generation failed", e);
      toast.error(t("admin.designer.thumbnailGenerateFailed"), { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setGeneratingId(null);
    }
  }

  type CardItem = {
    id: string;
    name: string;
    isDefault: boolean;
    thumbnailUrl?: string;
    defaultLayout: Template["defaultLayout"];
    canvasLayout?: Template["canvasLayout"];
  };
  const items: CardItem[] = [
    {
      id: DEFAULT_LAYOUT_ID,
      name: template.defaultLayoutName?.trim() || t("admin.designer.styleDefaultName"),
      isDefault: true,
      thumbnailUrl: template.defaultLayoutThumbnailUrl,
      defaultLayout: template.defaultLayout,
      canvasLayout: template.canvasLayout,
    },
    ...extras.map((l) => ({
      id: l.id,
      name: l.name,
      isDefault: false,
      thumbnailUrl: l.thumbnailUrl,
      defaultLayout: l.defaultLayout,
      canvasLayout: l.canvasLayout,
    })),
  ];

  const dialogItem = thumbDialogId ? items.find((l) => l.id === thumbDialogId) : null;

  function openThumbDialog(id: string, currentUrl?: string) {
    setThumbDialogId(id);
    setThumbUrlDraft(currentUrl ?? "");
    setThumbMode("url");
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">{t("admin.designer.stylesTitle")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("admin.designer.stylesDescription")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={duplicateCurrent}>{t("admin.designer.duplicateSelected")}</Button>
          <Button size="sm" variant="outline" onClick={addEmpty}>{t("admin.designer.emptyStyle")}</Button>
        </div>
      </div>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
        {items.map((it) => {
          const active = it.id === editingLayoutId;
          const aspect = it.defaultLayout.portrait?.aspect ?? "3:4";
          const aspectClass =
            aspect === "1:1" ? "aspect-square" : aspect === "4:3" ? "aspect-[4/3]" : "aspect-[3/4]";
          return (
            <div
              key={it.id}
              className={`relative rounded-xl border bg-card transition overflow-hidden ${
                active ? "ring-2 ring-primary border-transparent" : "border-border hover:border-foreground/30"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(it.id)}
                className="block w-full text-left"
              >
                <div className={`${aspectClass} bg-muted overflow-hidden relative`}>
                  {it.thumbnailUrl ? (
                    <img src={it.thumbnailUrl} alt={it.name} className="w-full h-full object-cover" />
                  ) : (
                    <>
                      <TemplateThumbnail
                        template={template}
                        layoutOverride={{ defaultLayout: it.defaultLayout, canvasLayout: it.canvasLayout }}
                        orientation="portrait"
                        productType={productType}
                        fill
                      />
                      <span className="absolute top-1 left-1 text-[8px] uppercase tracking-wider font-semibold bg-background/80 backdrop-blur-sm px-1.5 py-0.5 rounded text-muted-foreground">
                        {t("admin.designer.autoBadge")}
                      </span>
                    </>
                  )}
                </div>
                <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-medium truncate">{it.name}</span>
                  {it.isDefault && <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{t("admin.designer.defaultBadge")}</span>}
                </div>
              </button>
              <div className="px-2 pb-2 flex items-center gap-1 text-[11px]">
                <button type="button" title={t("admin.designer.renameTooltip")} onClick={() => rename(it.id)} className="px-1.5 py-1 rounded hover:bg-muted">✎</button>
                <button type="button" title={t("admin.designer.setThumbnailTooltip")} onClick={() => openThumbDialog(it.id, it.thumbnailUrl)} className="px-1.5 py-1 rounded hover:bg-muted">🖼</button>
                {!it.isDefault && (
                  <>
                    <button type="button" title={t("admin.designer.setAsDefaultTooltip")} onClick={() => makeDefault(it.id)} className="px-1.5 py-1 rounded hover:bg-muted">★</button>
                    <button type="button" title={t("admin.designer.removeTooltip")} onClick={() => remove(it.id)} className="ml-auto px-1.5 py-1 rounded hover:bg-muted text-destructive">×</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>


      {dialogItem && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setThumbDialogId(null)}
        >
          <div
            className="bg-card border rounded-xl p-5 w-full max-w-md space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-base font-semibold">{t("admin.designer.thumbnailDialogTitle", { name: dialogItem.name })}</h3>
              <p className="text-xs text-muted-foreground">{t("admin.designer.thumbnailDialogDescription")}</p>
            </div>

            <Tabs value={thumbMode} onValueChange={(v) => setThumbMode(v as "url" | "file")}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="url">{t("admin.designer.tabUrl")}</TabsTrigger>
                <TabsTrigger value="file">{t("admin.designer.tabUploadFile")}</TabsTrigger>
              </TabsList>
            </Tabs>

            {thumbMode === "url" ? (
              <div className="space-y-2">
                <Label className="text-xs">{t("admin.designer.imageUrlLabel")}</Label>
                <input
                  type="url"
                  value={thumbUrlDraft}
                  onChange={(e) => setThumbUrlDraft(e.target.value)}
                  placeholder="https://…"
                  className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs">{t("admin.designer.chooseImageFile")}</Label>
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadingThumb}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelected(dialogItem.id, f);
                    e.target.value = "";
                  }}
                  className="w-full text-sm"
                />
                {uploadingThumb && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> {t("admin.designer.uploading")}
                  </div>
                )}
              </div>
            )}

            {thumbUrlDraft.trim() && (
              <div className="aspect-square w-32 rounded-md overflow-hidden border bg-muted">
                <img src={thumbUrlDraft} alt={t("admin.designer.previewAlt")} className="w-full h-full object-cover" />
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                disabled={generatingId === dialogItem.id}
                onClick={() => generateThumbnail(dialogItem.id)}
              >
                {generatingId === dialogItem.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                {t("admin.designer.generateFromStyle")}
              </Button>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setThumbnailUrl(dialogItem.id, undefined); setThumbDialogId(null); }}
                >
                  {t("admin.designer.remove")}
                </Button>
                <Button
                  size="sm"
                  onClick={() => { setThumbnailUrl(dialogItem.id, thumbUrlDraft); setThumbDialogId(null); }}
                >
                  {t("admin.designer.save")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
