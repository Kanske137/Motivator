import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { getScenesFor, frameColorFromVariant, type MockupScene } from "@/lib/mockup-scenes";
import { compositeMockup } from "@/lib/mockup-composite";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Canvas3DPreview } from "./Canvas3DPreview";

interface MockupSlot {
  scene: MockupScene;
  url: string | null;
  loading: boolean;
  error?: string;
}

export function MockupGallery() {
  const {
    config, size, variant, orientation,
    mapStyleId, mapCenter, mapZoom,
    text, textFont, textVisible,
    showLabels, mapShape, posterBgColor,
  } = useEditorStore();
  const [slots, setSlots] = useState<MockupSlot[]>([]);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
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
        const printRes = await supabase.functions.invoke("generate-print-file", {
          body: {
            styleId: mapStyleId,
            center: mapCenter,
            zoom: mapZoom,
            size,
            orientation,
            text,
            textFont,
            textVisible,
            showLabels,
            mapShape,
            posterBgColor,
          },
        });
        if (myReq !== reqIdRef.current) return;

        if (printRes.error || !printRes.data?.url) {
          const msg = printRes.error?.message || "Ingen tryckfil";
          setSlots(scenes.map((s) => ({ scene: s, url: null, loading: false, error: msg })));
          return;
        }
        const printUrl: string = printRes.data.url;

        const canvasDepthCm = config.product_type === "canvas"
          ? (variant?.match(/(\d+)/)?.[1] ? parseInt(variant!.match(/(\d+)/)![1], 10) : 2)
          : 2;
        const frameColor = config.product_type === "canvas" ? null : frameColorFromVariant(variant);

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
                frameColor,
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
  }, [
    config, size, variant, orientation,
    mapStyleId, mapCenter, mapZoom,
    text, textFont, textVisible,
    showLabels, mapShape, posterBgColor,
  ]);

  if (!config) return null;

  const validSlots = slots.filter((s) => s.url);
  const lightboxSlot = lightboxIdx !== null ? validSlots[lightboxIdx] : null;

  const goPrev = () =>
    setLightboxIdx((i) => (i === null ? null : (i - 1 + validSlots.length) % validSlots.length));
  const goNext = () =>
    setLightboxIdx((i) => (i === null ? null : (i + 1) % validSlots.length));

  return (
    <>
      <div className="border-t bg-[hsl(var(--paper))]">
        <div className="px-4 py-3">
          <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
            Förhandsgranska i miljö
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x">
            {slots.map((s, i) => {
              const validIdx = validSlots.findIndex((v) => v.scene.id === s.scene.id);
              return (
                <button
                  type="button"
                  key={i}
                  disabled={!s.url}
                  onClick={() => validIdx >= 0 && setLightboxIdx(validIdx)}
                  className="group flex-shrink-0 w-32 h-32 md:w-40 md:h-40 rounded-2xl overflow-hidden bg-card border snap-start relative disabled:cursor-default cursor-zoom-in"
                  aria-label={`Förstora ${s.scene.label}`}
                >
                  {s.loading ? (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/40 animate-pulse">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : s.url ? (
                    <>
                      <img
                        src={s.url}
                        alt={s.scene.label}
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        loading="lazy"
                      />
                      <span className="absolute top-1.5 right-1.5 inline-flex items-center justify-center h-6 w-6 rounded-full bg-background/85 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition">
                        <Maximize2 className="h-3.5 w-3.5" />
                      </span>
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-destructive/5 text-destructive text-[10px] p-2 text-center gap-1">
                      <AlertCircle className="h-4 w-4" />
                      <span className="line-clamp-3">{s.error ?? "Ingen bild"}</span>
                    </div>
                  )}
                  <div className="absolute bottom-0 inset-x-0 bg-background/85 backdrop-blur-sm text-[11px] py-1 text-center font-medium pointer-events-none">
                    {s.scene.label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Dialog open={lightboxIdx !== null} onOpenChange={(o) => !o && setLightboxIdx(null)}>
        <DialogContent className="max-w-[95vw] md:max-w-4xl p-0 bg-background border-0 overflow-hidden">
          <DialogTitle className="sr-only">{lightboxSlot?.scene.label ?? "Förhandsgranska"}</DialogTitle>
          {lightboxSlot && (
            <div className="relative bg-muted">
              <img
                src={lightboxSlot.url!}
                alt={lightboxSlot.scene.label}
                className="w-full h-auto max-h-[85vh] object-contain"
              />
              {validSlots.length > 1 && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={goPrev}
                    className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full shadow-lg bg-background/90 hover:bg-background"
                    aria-label="Föregående"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={goNext}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full shadow-lg bg-background/90 hover:bg-background"
                    aria-label="Nästa"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent text-background px-4 py-3 text-sm font-medium">
                {lightboxSlot.scene.label}
                {validSlots.length > 1 && (
                  <span className="ml-2 opacity-70">
                    {(lightboxIdx ?? 0) + 1} / {validSlots.length}
                  </span>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
