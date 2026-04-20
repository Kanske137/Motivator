import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertCircle } from "lucide-react";
import { resolveProductUid } from "@/lib/gelato";
import { getScenesFor } from "@/lib/gelato-scenes";

interface Mockup {
  url: string | null;
  label: string;
  loading: boolean;
  error?: string;
  isRealMockup?: boolean;
}

export function MockupGallery() {
  const { config, size, variant, orientation, mapStyleId, mapCenter, mapZoom, text, textFont } =
    useEditorStore();
  const [mockups, setMockups] = useState<Mockup[]>([]);
  const debounceRef = useRef<number | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!config || !size) return;
    const scenes = getScenesFor(config.product_type);

    setMockups(scenes.map((s) => ({ label: s.label, url: null, loading: true })));

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      const myReq = ++reqIdRef.current;
      try {
        const resolved = resolveProductUid({
          productType: config.product_type,
          size,
          variant,
          orientation,
          dbMap: config.gelato_sku_map as Record<string, Record<string, string>>,
        });
        console.log("[MockupGallery] resolved UID:", resolved);

        // Step 1: print file
        const printRes = await supabase.functions.invoke("generate-print-file", {
          body: { styleId: mapStyleId, center: mapCenter, zoom: mapZoom, size, orientation, text, textFont },
        });
        if (myReq !== reqIdRef.current) return;
        console.log("[MockupGallery] generate-print-file:", printRes);

        if (printRes.error || !printRes.data?.url) {
          const msg = printRes.error?.message || "Ingen tryckfil";
          setMockups(scenes.map((s) => ({ label: s.label, url: null, loading: false, error: msg })));
          return;
        }
        const printUrl: string = printRes.data.url;

        if (!resolved.productUid) {
          setMockups(
            scenes.map((s) => ({
              label: s.label,
              url: printUrl,
              loading: false,
              isRealMockup: false,
              error: "Saknar Gelato-mapping",
            })),
          );
          return;
        }

        // Step 2: parallel mockup-requests, en per scen
        const results = await Promise.all(
          scenes.map(async (s) => {
            try {
              const r = await supabase.functions.invoke("gelato-mockup", {
                body: {
                  productUid: resolved.productUid,
                  imageUrl: printUrl,
                  mockupSceneId: s.mockupSceneId,
                },
              });
              const mockupUrl: string | null = r.data?.mockupUrl ?? null;
              const err: string | undefined = r.data?.error || r.error?.message;
              return { scene: s, mockupUrl, error: err };
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Mockup misslyckades";
              return { scene: s, mockupUrl: null, error: msg };
            }
          }),
        );
        if (myReq !== reqIdRef.current) return;

        setMockups(
          results.map((r) => ({
            label: r.scene.label,
            url: r.mockupUrl ?? printUrl,
            loading: false,
            isRealMockup: !!r.mockupUrl,
            error: r.mockupUrl ? undefined : r.error || "Mockup ej tillgänglig",
          })),
        );
      } catch (e) {
        if (myReq !== reqIdRef.current) return;
        console.error("[MockupGallery] failed", e);
        const msg = e instanceof Error ? e.message : "Något gick fel";
        setMockups(scenes.map((s) => ({ label: s.label, url: null, loading: false, error: msg })));
      }
    }, 900);

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
          {mockups.map((m, i) => (
            <div
              key={i}
              className="flex-shrink-0 w-32 h-32 md:w-40 md:h-40 rounded-2xl overflow-hidden bg-card border snap-start relative group"
            >
              {m.loading ? (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/40 animate-pulse">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : m.url ? (
                <>
                  <img src={m.url} alt={m.label} className="w-full h-full object-cover" />
                  {!m.isRealMockup && (
                    <div className="absolute top-1 left-1 right-1 bg-background/85 backdrop-blur-sm text-foreground text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1">
                      <AlertCircle className="h-2.5 w-2.5 flex-shrink-0" />
                      <span className="line-clamp-1">Tryckfil · {m.error ?? "Ingen mockup"}</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-destructive/5 text-destructive text-[10px] p-2 text-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  <span className="line-clamp-3">{m.error ?? "Ingen bild"}</span>
                </div>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-background/85 backdrop-blur-sm text-[11px] py-1 text-center font-medium">
                {m.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
