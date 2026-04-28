import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { getScenesFor, frameColorFromVariant, type MockupScene } from "@/lib/mockup-scenes";
import { compositeMockup } from "@/lib/mockup-composite";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Canvas3DPreview } from "./Canvas3DPreview";
import { renderTemplateSnapshot } from "@/lib/template-snapshot";

interface MockupSlot {
  scene: MockupScene;
  url: string | null;
  loading: boolean;
  error?: string;
}

export function MockupGallery() {
  const {
    config, template, size, variant, orientation,
    mapStyleId, mapCenter, mapZoom,
    text, textFont, textVisible,
    showLabels, mapShape, posterBgColor,
    layerValues,
    layerTransforms,
    designSource, photoPreviewUrl, aiPrintFileUrl,
    aiPhotoResults,
    whiteMarginEnabled,
  } = useEditorStore();
  const [slots, setSlots] = useState<MockupSlot[]>([]);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | undefined>();
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const debounceRef = useRef<number | null>(null);
  const reqIdRef = useRef(0);

  const isCanvas = config?.product_type === "canvas";

  // Compute canvas wrap depth from variant (e.g. "2 cm" → 2). Used both for
  // the snapshot (extends print area with wrap+bleed) AND the 3D preview UVs.
  const canvasDepthCm = isCanvas
    ? (variant?.match(/(\d+)/)?.[1] ? parseInt(variant!.match(/(\d+)/)![1], 10) : 2)
    : 0;
  const BLEED_CM = 0.3; // Gelato canvas bleed per side

  useEffect(() => {
    if (!config || !size || !template) return;
    // Invalidate any in-flight render synchronously so stale results never overwrite.
    reqIdRef.current++;
    const scenes = isCanvas ? [] : getScenesFor(config.product_type);
    setSlots(scenes.map((s) => ({ scene: s, url: null, loading: true })));
    setSnapshotLoading(true);
    setSnapshotError(undefined);

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      const myReq = ++reqIdRef.current;
      try {
        // Multi-layer snapshot: walks template layers (all maps + texts + lines
        // + margins + images) using per-layer values from the store.
        const newSnapshot = await renderTemplateSnapshot({
          template,
          orientation,
          size,
          layerValues,
          layerTransforms,
          whiteMarginEnabled,
          livePosterBgColor: posterBgColor,
          liveMapCenter: mapCenter,
          liveMapZoom: mapZoom,
          liveMapStyleId: mapStyleId,
          liveMapShape: mapShape,
          liveShowLabels: showLabels,
          liveText: text,
          liveTextFont: textFont,
          liveTextVisible: textVisible,
          wrapCm: isCanvas ? canvasDepthCm : 0,
          bleedCm: isCanvas ? BLEED_CM : 0,
          photoOverlayUrl:
            designSource === "ai"
              ? aiPrintFileUrl ?? undefined
              : designSource === "photo"
              ? photoPreviewUrl ?? undefined
              : undefined,
          aiPhotoResults,
        });
        if (myReq !== reqIdRef.current) return;

        setSnapshotUrl(newSnapshot);
        setSnapshotLoading(false);

        if (isCanvas) return; // canvas uses 3D — no scene compositing needed

        const sceneCanvasDepthCm = 2;
        const frameColor = frameColorFromVariant(variant);

        const results = await Promise.all(
          scenes.map(async (scene) => {
            try {
              const url = await compositeMockup({
                scene,
                printUrl: newSnapshot,
                size,
                orientation,
                productType: config.product_type,
                canvasDepthCm: sceneCanvasDepthCm,
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
        setSnapshotError(msg);
        setSnapshotLoading(false);
        setSlots(scenes.map((s) => ({ scene: s, url: null, loading: false, error: msg })));
      }
    }, 600);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [
    config, template, size, variant, orientation, isCanvas, canvasDepthCm,
    layerValues, layerTransforms, posterBgColor, whiteMarginEnabled,
    mapStyleId, mapCenter, mapZoom, showLabels, mapShape,
    text, textFont, textVisible,
    designSource, photoPreviewUrl, aiPrintFileUrl,
    aiPhotoResults,
  ]);

  if (!config) return null;

  // Canvas → Three.js 3D preview, no scene composites
  if (isCanvas) {
    const [a, b] = (size ?? "30x40").split("x").map(Number);
    const widthCm = orientation === "portrait" ? Math.min(a, b) : Math.max(a, b);
    const heightCm = orientation === "portrait" ? Math.max(a, b) : Math.min(a, b);
    return (
      <Canvas3DPreview
        printUrl={snapshotUrl}
        loading={snapshotLoading}
        error={snapshotError}
        widthCm={widthCm}
        heightCm={heightCm}
        depthCm={canvasDepthCm}
        bleedCm={BLEED_CM}
      />
    );
  }

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
