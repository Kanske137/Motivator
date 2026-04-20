import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

interface Mockup {
  url: string;
  label: string;
  fallback?: boolean;
}

const ENV_LABELS_POSTER = ["Vardagsrum", "Sovrum", "Kontor", "På vägg"];
const ENV_LABELS_CANVAS = ["Vardagsrum", "Sovrum", "Sidovy", "Närbild"];

export function MockupGallery() {
  const { config, size, variant, orientation, mapStyleId, mapCenter, mapZoom, text, textFont } =
    useEditorStore();
  const [mockups, setMockups] = useState<Mockup[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!config || !size || !variant) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      const labels = config.product_type === "canvas" ? ENV_LABELS_CANVAS : ENV_LABELS_POSTER;
      try {
        // Step 1: generate print file (returns public URL)
        const printRes = await supabase.functions.invoke("generate-print-file", {
          body: {
            styleId: mapStyleId,
            center: mapCenter,
            zoom: mapZoom,
            size,
            orientation,
            text,
            textFont,
          },
        });
        const printUrl: string | undefined = printRes.data?.url;
        if (!printUrl) throw new Error("no print url");

        // Step 2: resolve productUid from sku map
        const skuMap = (config.gelato_sku_map ?? {}) as Record<string, Record<string, string>>;
        const productUid = skuMap?.[size]?.[variant];

        if (!productUid) {
          // No mapping → just show print file as preview
          setMockups(
            labels.map((label) => ({ label, url: printUrl, fallback: true })),
          );
          return;
        }

        // Step 3: gelato mockup (single call — Gelato returns one composed image per call)
        const mockupRes = await supabase.functions.invoke("gelato-mockup", {
          body: { productUid, imageUrl: printUrl },
        });
        const mockupUrl: string | null = mockupRes.data?.mockupUrl ?? null;

        // Use mockup as the first thumbnail; print file as the rest
        const items: Mockup[] = labels.map((label, i) => ({
          label,
          url: i === 0 && mockupUrl ? mockupUrl : printUrl,
          fallback: !(i === 0 && mockupUrl),
        }));
        setMockups(items);
      } catch (e) {
        console.warn("[MockupGallery] failed", e);
        setMockups(labels.map((label) => ({ label, url: "", fallback: true })));
      } finally {
        setLoading(false);
      }
    }, 600);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [config, size, variant, orientation, mapStyleId, mapCenter, mapZoom, text, textFont]);

  if (!config) return null;

  return (
    <div className="border-t bg-[hsl(var(--paper))]">
      <div className="px-4 py-3">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
          Förhandsgranska i miljö
        </h3>
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x">
          {loading && mockups.length === 0 ? (
            <div className="flex items-center justify-center w-full py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            mockups.map((m, i) => (
              <div
                key={i}
                className="flex-shrink-0 w-32 h-32 md:w-40 md:h-40 rounded-2xl overflow-hidden bg-card border snap-start relative group cursor-pointer hover:shadow-lg transition"
              >
                {m.url ? (
                  <img src={m.url} alt={m.label} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50 text-muted-foreground text-xs">
                    {m.label}
                  </div>
                )}
                <div className="absolute bottom-0 inset-x-0 bg-background/85 backdrop-blur-sm text-[11px] py-1 text-center font-medium">
                  {m.label}
                  {m.fallback && <span className="text-muted-foreground"> · Förhandsgranskning</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
