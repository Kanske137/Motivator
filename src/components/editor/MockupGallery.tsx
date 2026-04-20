import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertCircle } from "lucide-react";
import { getScenesFor, type MockupScene } from "@/lib/mockup-scenes";
import { compositeMockup } from "@/lib/mockup-composite";

interface MockupSlot {
  scene: MockupScene;
  url: string | null;
  loading: boolean;
  error?: string;
}

export function MockupGallery() {
  const { config, size, variant, orientation, mapStyleId, mapCenter, mapZoom, text, textFont } =
    useEditorStore();
  const [slots, setSlots] = useState<MockupSlot[]>([]);
  const debounceRef = useRef<number | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!config || !size) return;
    const scenes = getScenesFor(config.product_type);
    setSlots(scenes.map((s) => ({ scene: s, url: null, loading: true })));

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      const myReq = ++reqIdRef.current;
      try {
        // 1) Generera tryckfil
        const printRes = await supabase.functions.invoke("generate-print-file", {
          body: { styleId: mapStyleId, center: mapCenter, zoom: mapZoom, size, orientation, text, textFont },
        });
        if (myReq !== reqIdRef.current) return;

        if (printRes.error || !printRes.data?.url) {
          const msg = printRes.error?.message || "Ingen tryckfil";
          setSlots(scenes.map((s) => ({ scene: s, url: null, loading: false, error: msg })));
          return;
        }
        const printUrl: string = printRes.data.url;

        // 2) Canvas-djup om relevant: variant ex "2 cm" eller "4 cm"
        const canvasDepthCm = config.product_type === "canvas"
          ? (variant?.match(/(\d+)/)?.[1] ? parseInt(variant!.match(/(\d+)/)![1], 10) : 2)
          : 2;

        // 3) Composit per scen parallellt
        const results = await Promise.all(
          scenes.map(async (scene) => {
            try {
              const url = await compositeMockup({
                scene,
                printUrl,
                size,
                orientation,
                productType: config.product_type,
                canvasDepthCm,
              });
              return { scene, url, error: undefined as string | undefined };
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Composit misslyckades";
              return { scene, url: null as string | null, error: msg };
            }
          }),
        );
        if (myReq !== reqIdRef.current) return;

        setSlots(
          results.map((r) => ({
            scene: r.scene,
            url: r.url,
            loading: false,
            error: r.error,
          })),
        );
      } catch (e) {
        if (myReq !== reqIdRef.current) return;
        console.error("[MockupGallery] failed", e);
        const msg = e instanceof Error ? e.message : "Något gick fel";
        setSlots(scenes.map((s) => ({ scene: s, url: null, loading: false, error: msg })));
      }
    }, 700);

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
          {slots.map((s, i) => (
            <div
              key={i}
              className="flex-shrink-0 w-32 h-32 md:w-40 md:h-40 rounded-2xl overflow-hidden bg-card border snap-start relative"
            >
              {s.loading ? (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/40 animate-pulse">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : s.url ? (
                <img src={s.url} alt={s.scene.label} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-destructive/5 text-destructive text-[10px] p-2 text-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  <span className="line-clamp-3">{s.error ?? "Ingen bild"}</span>
                </div>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-background/85 backdrop-blur-sm text-[11px] py-1 text-center font-medium">
                {s.scene.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
