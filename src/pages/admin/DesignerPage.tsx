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
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Eye, Image as ImageIcon, Loader2, MapPin, Save, Send, Type, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { createDefaultLayout, createLayer, moveLayer, normaliseZIndex } from "@/lib/layer-utils";
import { Sparkles } from "lucide-react";
import ProductOptionsSection from "@/components/admin/ProductOptionsSection";
import ShopifyPublishingSection from "@/components/admin/ShopifyPublishingSection";
import LayerCanvas from "@/components/admin/LayerCanvas";
import LayerList, { toggleAllLocks } from "@/components/admin/LayerList";
import LayerInspector from "@/components/admin/LayerInspector";

export default function DesignerPage() {
  const { handle } = useParams<{ handle: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [config, setConfig] = useState<ProductConfig | null>(null);
  const [template, setTemplate] = useState<Template | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  // Active orientation layout
  const layout = template?.defaultLayout[orientation] ?? null;
  const layers = useMemo(() => layout?.layers ?? [], [layout]);
  const selectedLayer = useMemo(
    () => layers.find((l) => l.id === selectedId) ?? null,
    [layers, selectedId],
  );

  // ---------- mutators ----------
  function setLayers(next: TemplateLayer[]) {
    if (!template) return;
    setTemplate({
      ...template,
      defaultLayout: {
        ...template.defaultLayout,
        [orientation]: { ...template.defaultLayout[orientation], layers: next },
      },
    });
  }

  function addLayer(type: LayerType) {
    const nextLayer = createLayer(type, layers);
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

  // ---------- persist ----------
  async function persistTemplate(opts: { publish: boolean }) {
    if (!handle || !template) return;
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
    const { error } = await supabase
      .from("product_configs")
      .update({ template: finalTemplate as unknown as never })
      .eq("shopify_handle", handle);
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
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <ProductOptionsSection
          config={config}
          value={template.productOptions}
          onChange={(productOptions) => setTemplate({ ...template, productOptions })}
        />

        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold">Designyta</h2>
              <p className="text-xs text-muted-foreground">
                Drag & drop · 5% snap · alignment-guides under drag.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Tabs value={orientation} onValueChange={(v) => setOrientation(v as Orientation)}>
                <TabsList>
                  <TabsTrigger value="portrait">Stående</TabsTrigger>
                  <TabsTrigger value="landscape">Liggande</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="h-6 w-px bg-border" />
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
            </div>
          </div>

          <div className="relative">
            <LayerCanvas
              aspect={layout.aspect}
              background={layout.background.color}
              layers={layers}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={updateLayer}
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
