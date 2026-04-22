// Admin designer page — Fas 1 scaffold.
//
// Sections (top→bottom):
//   A. Produkt & varianter (ProductOptionsSection)
//   B. Designyta (placeholder — drag & drop canvas comes next)
//   C. Lager-lista (placeholder)
//   D. Properties-panel (placeholder)
//
// State lives entirely in this page for now (zustand split comes later when the
// canvas + layer interactions land). Save / publish actions write to the
// `template` jsonb column on `product_configs`.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { loadConfig, type ProductConfig } from "@/lib/product-config";
import { resolveTemplate } from "@/lib/template-migrate";
import {
  parseTemplate,
  type Template,
} from "@/lib/template-schema";
import ProductOptionsSection from "@/components/admin/ProductOptionsSection";

export default function DesignerPage() {
  const { handle } = useParams<{ handle: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ProductConfig | null>(null);
  const [template, setTemplate] = useState<Template | null>(null);

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
      // The DB row has both legacy fields + the new `template` jsonb.
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

  async function persistTemplate(next: Template, opts: { publish: boolean }) {
    if (!handle) return;
    const finalTemplate: Template = opts.publish
      ? { ...next, publishedAt: new Date().toISOString() }
      : next;

    const parsed = parseTemplate(finalTemplate);
    if (!parsed.ok) {
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

  if (!config || !template) {
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
      <header className="border-b sticky top-0 bg-background z-10">
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => persistTemplate(template, { publish: false })}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Spara draft
            </Button>
            <Button
              size="sm"
              onClick={() => persistTemplate(template, { publish: true })}
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

        <Card className="p-5">
          <h2 className="text-base font-semibold mb-1">Designyta</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Drag & drop-canvas med snap-to-grid och alignment-guides kommer i nästa steg.
          </p>
          <div className="aspect-[3/4] max-w-sm mx-auto rounded-md border border-dashed bg-muted/30 flex items-center justify-center text-sm text-muted-foreground">
            Canvas placeholder
          </div>
        </Card>

        <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
          <Card className="p-5">
            <h2 className="text-base font-semibold mb-1">Lager</h2>
            <p className="text-xs text-muted-foreground">
              Lager-lista (zIndex, dölj/lås) implementeras i nästa steg.
            </p>
          </Card>
          <Card className="p-5">
            <h2 className="text-base font-semibold mb-1">Egenskaper</h2>
            <p className="text-xs text-muted-foreground">
              Defaults + locks per valt lager implementeras i nästa steg.
            </p>
          </Card>
        </div>
      </main>
    </div>
  );
}
