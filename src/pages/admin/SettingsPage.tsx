// Wallery admin — Settings. Currently the per-merchant GLOBAL default prices
// (empty by default; the merchant fills them in). Future home for POD selection
// and other overall settings too.
//
// Prices are keyed generically (material / size / variant) and saved via the
// guarded `admin-settings` edge function into the per-tenant `pricing_rules`
// table. The sync uses them (override ?? global) as the Shopify variant price.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { invokeAdmin } from "@/lib/admin-api";
import {
  POSTER_SIZES,
  POSTER_FRAMES,
  CANVAS_SIZES,
  CANVAS_DEPTHS,
  ALUMINUM_SIZES,
  ALUMINUM_MATERIALS,
  ACRYLIC_SIZES,
  ACRYLIC_FINISHES,
} from "@/lib/pricing";

// The known catalog per material (Gelato today). New POD providers add their own
// materials/sizes/variants later — the storage model is already generic.
const MATERIALS: {
  key: string;
  label: string;
  variantLabel: string;
  sizes: readonly string[];
  variants: readonly string[];
}[] = [
  { key: "poster", label: "Poster", variantLabel: "Ram", sizes: POSTER_SIZES, variants: POSTER_FRAMES },
  { key: "canvas", label: "Canvas", variantLabel: "Djup", sizes: CANVAS_SIZES, variants: CANVAS_DEPTHS },
  { key: "aluminum", label: "Aluminium", variantLabel: "Variant", sizes: ALUMINUM_SIZES, variants: ALUMINUM_MATERIALS },
  { key: "acrylic", label: "Akryl", variantLabel: "Finish", sizes: ACRYLIC_SIZES, variants: ACRYLIC_FINISHES },
];

// material -> size -> variant -> price (string, for the input fields)
type PriceMap = Record<string, Record<string, Record<string, string>>>;

interface PriceRow {
  provider?: string;
  material: string;
  size: string;
  variant: string;
  price: number;
}

export default function SettingsPage() {
  const [prices, setPrices] = useState<PriceMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState(MATERIALS[0].key);
  const [currency, setCurrency] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await invokeAdmin<{ prices: PriceRow[]; currency: string | null }>(
          "prices-list",
          {},
          "admin-settings",
        );
        setCurrency(res.currency ?? null);
        const map: PriceMap = {};
        for (const r of res.prices ?? []) {
          ((map[r.material] ??= {})[r.size] ??= {})[r.variant] = String(r.price);
        }
        setPrices(map);
      } catch (e) {
        toast.error("Kunde inte ladda priser", {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function setPrice(material: string, size: string, variant: string, value: string) {
    setPrices((prev) => {
      const next = { ...prev };
      const byMaterial = { ...(next[material] ?? {}) };
      const bySize = { ...(byMaterial[size] ?? {}) };
      bySize[variant] = value;
      byMaterial[size] = bySize;
      next[material] = byMaterial;
      return next;
    });
  }

  const filledCount = useMemo(() => {
    let n = 0;
    for (const m of Object.values(prices)) {
      for (const s of Object.values(m)) {
        for (const v of Object.values(s)) {
          if (v !== "" && !Number.isNaN(Number(v))) n++;
        }
      }
    }
    return n;
  }, [prices]);

  async function save() {
    const rows: PriceRow[] = [];
    for (const material of Object.keys(prices)) {
      for (const size of Object.keys(prices[material])) {
        for (const variant of Object.keys(prices[material][size])) {
          const raw = prices[material][size][variant];
          if (raw === "" || raw == null) continue;
          const price = Number(raw);
          if (Number.isNaN(price) || price < 0) continue;
          rows.push({ material, size, variant, price });
        }
      }
    }
    if (rows.length === 0) {
      toast.message("Inga priser att spara", { description: "Fyll i minst ett pris." });
      return;
    }
    setSaving(true);
    try {
      await invokeAdmin("prices-upsert", { prices: rows }, "admin-settings");
      toast.success("Priser sparade", { description: `${rows.length} pris(er) uppdaterade` });
    } catch (e) {
      toast.error("Kunde inte spara", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  const activeMaterial = MATERIALS.find((m) => m.key === active)!;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Button asChild variant="ghost" size="icon">
              <Link to="/admin/configs" aria-label="Tillbaka">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="text-xl font-bold">Prisinställningar</h1>
              <p className="text-sm text-muted-foreground">
                Globala standardpriser per material och variant, i{" "}
                <span className="font-medium">{currency ?? "butikens valuta"}</span>{" "}
                (butikens valuta — kan inte ändras). Tomma fält = erbjuds ej.
              </p>
            </div>
          </div>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Spara priser
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap mb-4">
              {MATERIALS.map((m) => (
                <Button
                  key={m.key}
                  variant={active === m.key ? "default" : "outline"}
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
                    <th className="text-left font-medium p-2 sticky left-0 bg-card">Storlek</th>
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
                      {activeMaterial.variantLabel} · pris i {currency ?? "butikens valuta"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeMaterial.sizes.map((size) => (
                    <tr key={size} className="border-t">
                      <td className="p-2 font-mono text-xs whitespace-nowrap sticky left-0 bg-card">{size}</td>
                      {activeMaterial.variants.map((variant) => (
                        <td key={variant} className="p-1">
                          <Input
                            type="number"
                            min={0}
                            inputMode="decimal"
                            placeholder="—"
                            className="h-8 w-24"
                            value={prices[activeMaterial.key]?.[size]?.[variant] ?? ""}
                            onChange={(e) => setPrice(activeMaterial.key, size, variant, e.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <p className="text-xs text-muted-foreground mt-3">
              {filledCount} pris(er) ifyllda totalt. Priser som lämnas tomma hoppas över vid
              synk (varianten skapas inte i Shopify förrän ett pris angetts).
            </p>
          </>
        )}
      </main>
    </div>
  );
}
