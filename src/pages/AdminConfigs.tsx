import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { loadAllConfigs, type ProductConfig } from "@/lib/product-config";
import { Loader2, ExternalLink, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function AdminConfigs() {
  const [configs, setConfigs] = useState<ProductConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    (async () => {
      setConfigs(await loadAllConfigs());
      setLoading(false);
    })();
  }, []);

  const syncToShopify = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("shopify-inject-editor", {});
    setSyncing(false);
    if (error) {
      toast.error("Synk misslyckades", { description: error.message });
    } else {
      toast.success("Synkad till Shopify", {
        description: `${data?.injected ?? 0} produkter uppdaterade`,
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Produktkonfigurationer</h1>
            <p className="text-sm text-muted-foreground">Layouter, kartstilar, storlekar och Gelato-mappning</p>
          </div>
          <Button onClick={syncToShopify} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
            Synka till Shopify
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {configs.map((c) => (
              <Card key={c.id} className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{c.title}</h2>
                    <p className="text-xs text-muted-foreground font-mono">{c.shopify_handle}</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider bg-secondary text-secondary-foreground px-2 py-1 rounded">
                    {c.product_type}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>{c.sizes.length} storlekar</div>
                  <div>{c.map_styles.length} kartstilar</div>
                  <div>{c.text_config.fonts.length} typsnitt</div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link to={`/editor?handle=${c.shopify_handle}`}>
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Öppna editor
                    </Link>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        <div className="mt-8 p-4 rounded-lg border border-dashed text-center text-sm text-muted-foreground">
          Visuell layout-editor (drag & drop) kommer i nästa iteration. För nu redigeras layout-JSON direkt i databasen.
        </div>
      </main>
    </div>
  );
}
