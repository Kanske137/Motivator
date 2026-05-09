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
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ChevronDown, Eye, Image as ImageIcon, Loader2, MapPin, Minus, Save, Send, Shapes, Sparkle, Square, Type, Undo2, Zap } from "lucide-react";
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
import { loadConfig, type ProductConfig } from "@/lib/product-config";
import { resolveTemplate } from "@/lib/template-migrate";
import {
  parseTemplate,
  type LayerType,
  type Orientation,
  type Template,
  type TemplateLayer,
} from "@/lib/template-schema";
import { createDefaultLayout, createLayer, createShapeLayer, moveLayer, normaliseZIndex } from "@/lib/layer-utils";
import type { ShapeKind } from "@/lib/template-schema";
import { Sparkles } from "lucide-react";
import ProductOptionsSection from "@/components/admin/ProductOptionsSection";
import ShopifyPublishingSection from "@/components/admin/ShopifyPublishingSection";
import LayerCanvas from "@/components/admin/LayerCanvas";
import LayerList, { toggleAllLocks } from "@/components/admin/LayerList";
import LayerInspector from "@/components/admin/LayerInspector";
import DeleteTemplateDialog from "@/components/admin/DeleteTemplateDialog";

export default function DesignerPage() {
  const { handle } = useParams<{ handle: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [config, setConfig] = useState<ProductConfig | null>(null);
  const [template, setTemplate] = useState<Template | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Designyta-läge: 'standard' = poster/metall/plexi-layout, 'canvas' = canvas-wrap.
  // Endast meningsfullt för konsoliderade mallar med både canvas och annan typ.
  const [designMode, setDesignMode] = useState<"standard" | "canvas">("standard");

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
  async function syncToShopify() {
    if (!handle) return;
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("shopify-sync-template", {
      body: { handle },
    });
    setSyncing(false);
    const code = (data as { code?: string } | null)?.code;
    if (error || !data?.ok) {
      const isAuth = code === "invalid_token" || code === "no_token" || code === "missing_scope";
      toast.error(isAuth ? "Shopify-anslutningen är ogiltig" : "Synk misslyckades", {
        description: isAuth
          ? "Backendens Shopify Admin-token avvisades. Återanslut Shopify-integrationen i Lovable och försök igen."
          : (error?.message ?? data?.error ?? "Okänt fel"),
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
      parts.push(`${results.length} produkt(er)`);
      if (totalCreated) parts.push(`${totalCreated} nya varianter`);
      if (totalUpdated) parts.push(`${totalUpdated} uppdaterade`);
      if (totalSkipped) parts.push(`${totalSkipped} hoppades över`);
      parts.push(
        allPublished ? "publicerade i Online Store" : "OBS: ej publicerade i Online Store",
      );
      toast.success("Synkad till Shopify", { description: parts.join(" · ") });
      if (totalSkippedFields > 0) {
        const sample = results
          .flatMap((r) => r.skippedFields ?? [])
          .slice(0, 5)
          .map((f) => `${f.field} (${f.reason})`)
          .join(", ");
        toast.warning(`${totalSkippedFields} fält hoppades över — ändrade i Shopify`, {
          description: sample,
        });
      }
    }
  }

  useEffect(() => {
    if (!handle) return;
    (async () => {
      setLoading(true);
      const cfg = await loadConfig(handle);
      if (!cfg) {
        toast.error("Hittade ingen produkt med detta handle");
        setLoading(false);
        return;
      }
      const raw = (cfg as unknown as { template?: unknown }).template;
      const { template: tpl, fellBack } = resolveTemplate(cfg, raw);
      if (fellBack) {
        toast.message("Mall genererades från legacy-config", {
          description: "Spara för att låsa in den i databasen.",
        });
      }
      setConfig(cfg);
      setTemplate(tpl);
      setLoading(false);
    })();
  }, [handle]);

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
  const layoutBlock = template
    ? (isCanvasProduct && template.canvasLayout) || template.defaultLayout
    : null;
  const layout = layoutBlock?.[orientation] ?? null;
  const layers = useMemo(() => layout?.layers ?? [], [layout]);
  const selectedLayer = useMemo(
    () => layers.find((l) => l.id === selectedId) ?? null,
    [layers, selectedId],
  );

  // ---------- mutators ----------
  function setLayers(next: TemplateLayer[]) {
    if (!template) return;
    if (isCanvasProduct) {
      const cl = template.canvasLayout ?? template.defaultLayout;
      commitTemplate({
        ...template,
        canvasLayout: {
          ...cl,
          [orientation]: { ...cl[orientation], layers: next },
        },
      });
    } else {
      commitTemplate({
        ...template,
        defaultLayout: {
          ...template.defaultLayout,
          [orientation]: { ...template.defaultLayout[orientation], layers: next },
        },
      });
    }
  }

  function setLayoutBackground(color: string) {
    if (!template || !layout) return;
    if (isCanvasProduct) {
      const cl = template.canvasLayout ?? template.defaultLayout;
      commitTemplate({
        ...template,
        canvasLayout: {
          ...cl,
          [orientation]: { ...cl[orientation], background: { color } },
        },
      });
    } else {
      commitTemplate({
        ...template,
        defaultLayout: {
          ...template.defaultLayout,
          [orientation]: { ...layout, background: { color } },
        },
      });
    }
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
      toast.error("Minst en orientering måste vara aktiv");
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
      toast.error("Mallen är ogiltig", { description: parsed.error.issues[0]?.message });
      return;
    }

    setSaving(true);
    // Sync legacy `map_styles` column from new productOptions.mapStyles so
    // older code paths (Shopify sync, customer editor fallback) stay in sync.
    const enabledMapStyleIds = (finalTemplate.productOptions?.mapStyles ?? [])
      .filter((s) => s.enabled !== false)
      .map((s) => s.id);

    // Write to current row first (template + Shopify-meta belong to this product)
    const { error } = await supabase
      .from("product_configs")
      .update({
        template: finalTemplate as unknown as never,
        tags: config.tags ?? [],
        category_gid: config.category_gid ?? null,
        status: config.status ?? "DRAFT",
        sales_channels: config.sales_channels ?? ["online_store"],
        description_html: config.description_html ?? null,
        seo_title: config.seo_title ?? null,
        seo_description: config.seo_description ?? null,
        map_styles: enabledMapStyleIds.length > 0 ? (enabledMapStyleIds as unknown as never) : ([] as unknown as never),
      })
      .eq("shopify_handle", handle);

    // Propagate the shared template (layouts, dekor, AI-/karta-stilar) to
    // sibling rows with the same template_slug — but PRESERVE each sibling's
    // own `productOptions.poster` / `productOptions.canvas` (per-rad).
    // Annars skriver canvas-radens disable av poster-blocket över
    // poster-radens egna storlekar/ramar och vice versa.
    const slug = config.template_slug;
    if (!error && slug) {
      const { data: siblings } = await supabase
        .from("product_configs")
        .select("shopify_handle, template")
        .eq("template_slug", slug)
        .neq("shopify_handle", handle);

      if (siblings && siblings.length > 0) {
        await Promise.all(
          siblings.map((s) => {
            const sibTemplate = (s.template ?? {}) as Template;
            // Per-row layouts must NOT cross-contaminate: poster siblings
            // own `defaultLayout`, canvas siblings own `canvasLayout`. We
            // only propagate the layout block matching THIS row's product
            // type and otherwise keep the sibling's existing block.
            const isCurrentCanvas = isCanvasProduct;
            const mergedSibling: Template = {
              ...finalTemplate,
              defaultLayout: isCurrentCanvas
                ? (sibTemplate.defaultLayout ?? finalTemplate.defaultLayout)
                : finalTemplate.defaultLayout,
              canvasLayout: isCurrentCanvas
                ? finalTemplate.canvasLayout
                : (sibTemplate.canvasLayout ?? finalTemplate.canvasLayout),
              productOptions: {
                ...(finalTemplate.productOptions ?? {}),
                poster: sibTemplate.productOptions?.poster ?? finalTemplate.productOptions?.poster,
                canvas: sibTemplate.productOptions?.canvas ?? finalTemplate.productOptions?.canvas,
              },
            };
            return supabase
              .from("product_configs")
              .update({
                template: mergedSibling as unknown as never,
                map_styles: enabledMapStyleIds.length > 0 ? (enabledMapStyleIds as unknown as never) : ([] as unknown as never),
              })
              .eq("shopify_handle", s.shopify_handle);
          }),
        );
      }
    }
    setSaving(false);

    if (error) {
      toast.error("Kunde inte spara", { description: error.message });
      return;
    }
    setTemplate(finalTemplate);
    toast.success(opts.publish ? "Publicerad" : "Sparad som draft");
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
        <p className="text-muted-foreground">Mall kunde inte laddas.</p>
        <Button asChild variant="outline">
          <Link to="/admin/configs">Tillbaka</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button asChild variant="ghost" size="icon">
              <Link to="/admin/configs" aria-label="Tillbaka">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">{config.title}</h1>
              <p className="text-xs text-muted-foreground font-mono truncate">
                {config.shopify_handle}
                {template.publishedAt ? " · publicerad" : " · draft"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <a
                href={`/editor?handle=${handle}&preview=draft`}
                target="_blank"
                rel="noreferrer"
              >
                <Eye className="h-4 w-4 mr-2" />
                Visa som kund
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={!canUndo}
              title="Ångra (Cmd/Ctrl+Z)"
            >
              <Undo2 className="h-4 w-4 mr-2" />
              Ångra
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => persistTemplate({ publish: false })}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Spara draft
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={syncToShopify}
              disabled={syncing}
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
              Synka till Shopify
            </Button>
            <Button
              size="sm"
              onClick={() => persistTemplate({ publish: true })}
              disabled={saving}
            >
              <Send className="h-4 w-4 mr-2" />
              Publicera
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

        <ShopifyPublishingSection config={config} onChange={updateConfigMeta} />

        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold">Designyta</h2>
              <p className="text-xs text-muted-foreground">
                Drag & drop · 5% snap · alignment-guides under drag.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Tabs value={orientation} onValueChange={(v) => setOrientation(v as Orientation)}>
                <TabsList>
                  <TabsTrigger value="portrait" disabled={!template.orientations.includes("portrait")}>
                    Stående
                  </TabsTrigger>
                  <TabsTrigger value="landscape" disabled={!template.orientations.includes("landscape")}>
                    Liggande
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="flex items-center gap-3 px-2 border-l border-r h-9">
                <Label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Switch
                    checked={template.orientations.includes("portrait")}
                    onCheckedChange={(c) => toggleOrientationEnabled("portrait", c)}
                  />
                  Aktiv stående
                </Label>
                <Label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Switch
                    checked={template.orientations.includes("landscape")}
                    onCheckedChange={(c) => toggleOrientationEnabled("landscape", c)}
                  />
                  Aktiv liggande
                </Label>
              </div>
              <Button size="sm" variant="outline" onClick={() => addLayer("map")}>
                <MapPin className="h-3.5 w-3.5 mr-1.5" />
                Lägg till karta
              </Button>
              <Button size="sm" variant="outline" onClick={() => addLayer("text")}>
                <Type className="h-3.5 w-3.5 mr-1.5" />
                Lägg till text
              </Button>
              <Button size="sm" variant="outline" onClick={() => addLayer("photo")}>
                <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
                Lägg till bild
              </Button>
              <Button size="sm" variant="outline" onClick={() => addLayer("aiPhoto")}>
                <Sparkle className="h-3.5 w-3.5 mr-1.5" />
                Lägg till AI-referensbild
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Shapes className="h-3.5 w-3.5 mr-1.5" />
                    Lägg till figur
                    <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => addShape("line-horizontal")}>
                    <Minus className="h-3.5 w-3.5 mr-2" /> Horisontell linje
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => addShape("line-vertical")}>
                    <Minus className="h-3.5 w-3.5 mr-2 rotate-90" /> Vertikal linje
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => addShape("frame-rect")}>
                    <Square className="h-3.5 w-3.5 mr-2" /> Rektangulär ram
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => addShape("frame-oval")}>
                    <Square className="h-3.5 w-3.5 mr-2 rounded-full" /> Oval ram
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => addShape("frame-rounded")}>
                    <Square className="h-3.5 w-3.5 mr-2" /> Rundad ram
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => addShape("frame-double")}>
                    <Square className="h-3.5 w-3.5 mr-2" /> Dubbel ram
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => addShape("frame-corners")}>
                    <Square className="h-3.5 w-3.5 mr-2" /> Hörn-dekoration
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="outline" onClick={() => addLayer("margin")}>
                <Square className="h-3.5 w-3.5 mr-1.5" />
                Lägg till marginal
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3 pb-3 border-b mb-4">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Bakgrundsfärg
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
              Sätter kundens default-bakgrund för {orientation === "portrait" ? "stående" : "liggande"}.
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
                <span className="inline-block h-2 w-2 rounded-sm bg-muted border" />
                Canvas-design · djup {designDepthCm} cm · grå zon = wrap (motivet syns runt kanten)
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
              wrapInsetPctX={(() => {
                if (!isCanvasProduct) return 0;
                const sizeCm = orientation === "portrait" ? 30 : 40;
                const depth = template?.productOptions?.canvas?.canvasDesignDepthCm ?? 2;
                return depth / (sizeCm + 2 * depth);
              })()}
              wrapInsetPctY={(() => {
                if (!isCanvasProduct) return 0;
                const sizeCm = orientation === "portrait" ? 40 : 30;
                const depth = template?.productOptions?.canvas?.canvasDesignDepthCm ?? 2;
                return depth / (sizeCm + 2 * depth);
              })()}
            />
            {layers.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="pointer-events-auto bg-background/95 backdrop-blur border-2 border-dashed border-primary/40 rounded-lg p-6 text-center max-w-xs shadow-lg">
                  <Sparkles className="h-6 w-6 mx-auto mb-2 text-primary" />
                  <p className="text-sm font-medium mb-1">Tomt — börja här</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Skapa en standardlayout (karta + text) eller lägg till lager manuellt ovan.
                  </p>
                  <Button
                    size="sm"
                    onClick={() => {
                      const seed = createDefaultLayout();
                      setLayers(seed);
                      setSelectedId(seed[0]?.id ?? null);
                    }}
                  >
                    Skapa standardlayout
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Card className="p-5">
            <h2 className="text-base font-semibold mb-3">Lager</h2>
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
            <h2 className="text-base font-semibold mb-3">Egenskaper</h2>
            <LayerInspector
              config={config}
              layer={selectedLayer}
              allLayers={layers}
              onChange={updateLayer}
              onLayersChange={setLayers}
            />
          </Card>
        </div>
      </main>
    </div>
  );
}
