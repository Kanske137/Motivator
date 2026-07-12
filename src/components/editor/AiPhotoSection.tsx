// Customer-side AI section. Renders for an AI layer — either a photo layer with
// a recipe `.ai` binding (the unified media layer) or a legacy `aiPhoto` layer.
//
// `buildAiLayerDriver` normalizes both into one driver (style choices, whether a
// reference is needed, motif, and a `resolve(styleId, refUrl)`), so nothing here
// branches on layer type. The driver's recipe — model + prompt + params + steps
// + the injected {style} option + the {motif} — is POSTed to `replicate-face-swap`,
// which routes purely on `recipe`.
//
// Results are cached in localStorage keyed by (layerId, faceHash, slot) where
// `slot` comes from the driver (recipe id + injected option values + motif +
// reference URL) — two runs share a slot only if they'd send the model
// identical inputs, so a cached image is never reused for a different recipe.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useEditorStore } from "@/stores/editorStore";
import { useAiBusyStore } from "@/stores/aiBusyStore";
import { supabase } from "@/integrations/supabase/client";
import { uploadCartPreview } from "@/lib/upload-preview";
import { hashFile } from "@/lib/ai-cache-storage";
import { buildAiLayerDriver } from "@/lib/ai-layer-driver";
import type { TemplateLayer } from "@/lib/template-schema";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AiProgress } from "./AiProgress";

/** A photo layer carrying an `.ai` recipe binding. */
type MediaLayer = Extract<TemplateLayer, { type: "photo" }>;

interface Props {
  layer: MediaLayer;
  /** Heading shown when there are multiple AI layers in one template. */
  heading?: string | null;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";
const MAX_BYTES = 25 * 1024 * 1024;

// Subject hints moved to i18n (aiPhoto.subjectHint*).

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("blobToDataUrl failed"));
    r.readAsDataURL(blob);
  });
}

export function AiPhotoSection({ layer, heading }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const sources = useEditorStore((s) => s.aiPhotoSources);
  const results = useEditorStore((s) => s.aiPhotoResults);
  const setAiPhotoSource = useEditorStore((s) => s.setAiPhotoSource);
  const setAiPhotoHash = useEditorStore((s) => s.setAiPhotoHash);
  const setAiPhotoUploadedUrl = useEditorStore((s) => s.setAiPhotoUploadedUrl);
  const setAiPhotoResult = useEditorStore((s) => s.setAiPhotoResult);
  const clearAiPhoto = useEditorStore((s) => s.clearAiPhoto);
  const addFaceSwapToCache = useEditorStore((s) => s.addFaceSwapToCache);
  const getCachedFaceSwap = useEditorStore((s) => s.getCachedFaceSwap);
  const aiPhotoSelectedRefUrl = useEditorStore((s) => s.aiPhotoSelectedRefUrl);
  const setAiPhotoSelectedRef = useEditorStore((s) => s.setAiPhotoSelectedRef);
  // Subscribe to the cache so thumbnails re-render when new swaps complete.
  const faceSwapCache = useEditorStore((s) => s.faceSwapCache);
  void faceSwapCache;

  const source = sources[layer.id];
  const result = results[layer.id] ?? null;
  // Filter references by the current canvas orientation inside the driver. Refs
  // tagged "any" show in both; the cache is keyed by refUrl, so flipping
  // orientation → different refUrl → either re-uses a cached swap or shows the
  // unswapped ref.
  const editorOrientation = useEditorStore((s) => s.orientation);

  // Normalize both worlds — a bound photo layer and a legacy aiPhoto layer — to
  // one driver, so nothing below branches on layer type. Null only for a plain
  // photo (no recipe), which ControlPanel never routes here (guarded on render).
  const driver = buildAiLayerDriver(layer, editorOrientation);
  const needsReference = driver?.needsReference ?? false;
  const references = driver?.references ?? [];
  const styleChoices = driver?.styleChoices ?? [];
  const motif = driver?.motif;
  const hintKey = driver?.hintKey;
  /** Single source of truth for the recipe to POST, its option values and the
   *  cache slot, given a style pick + reference. Running a swap and cached-
   *  thumbnail lookups both go through this, so a written entry and a later
   *  lookup can never compute different keys. */
  const resolveFor = driver?.resolve ?? ((): never => { throw new Error("AiPhotoSection: no driver"); });

  const showSubjectPicker = needsReference && references.length >= 2;

  // Customer-selected reference. Defaults to the first one on mount/change.
  const selectedRefUrlFromStore = aiPhotoSelectedRefUrl[layer.id] ?? null;
  const selectedRef =
    references.find((r) => r.url === selectedRefUrlFromStore) ?? references[0] ?? null;
  const refUrl = selectedRef?.url ?? null;

  useEffect(() => {
    // Initialize / heal the store's selection when references or orientation change.
    if (!needsReference) return;
    if (references.length === 0) return;
    const stored = aiPhotoSelectedRefUrl[layer.id];
    if (!stored || !references.some((r) => r.url === stored)) {
      setAiPhotoSelectedRef(layer.id, references[0].url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.id, needsReference, editorOrientation, references.map((r) => r.url).join("|")]);

  // Sync the visible swap result to whatever reference subject is currently
  // selected. If we have a cached swap for (face, ref) → show it instantly.
  // Otherwise clear the stale result so the editor falls back to the newly
  // selected reference image (the customer can then tap "Skapa" to swap).
  useEffect(() => {
    if (!needsReference) return;
    if (!refUrl) return;
    const hash = source?.hash;
    if (!hash) return;
    const { slot } = resolveFor(null, refUrl);
    const cached = getCachedFaceSwap(layer.id, hash, slot);
    if (cached) {
      if (results[layer.id] !== cached) setAiPhotoResult(layer.id, cached);
    } else if (results[layer.id]) {
      setAiPhotoResult(layer.id, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.id, needsReference, refUrl, source?.hash]);

  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);

  // Auto-select the first style when none is picked yet (the "no style" option
  // was removed — a customer must pick one).
  useEffect(() => {
    if (selectedStyleId) return;
    if (styleChoices.length === 0) return;
    setSelectedStyleId(styleChoices[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStyleId, styleChoices.map((c) => c.id).join("|")]);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  // All three routes now run through Nano Banana 2 — expect ~18s end-to-end
  // including potential retry backoff.
  const expectedSeconds = 18;

  // Hash the face photo whenever it changes.
  useEffect(() => {
    if (!source?.file || source.hash) return;
    let cancelled = false;
    hashFile(source.file)
      .then((h) => { if (!cancelled) setAiPhotoHash(layer.id, h); })
      .catch((e) => console.warn("[AiPhoto] hashFile failed", e));
    return () => { cancelled = true; };
  }, [source?.file, source?.hash, layer.id, setAiPhotoHash]);

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.match(/^image\//)) {
      toast.error(t("photo.errorOnlyImages"));
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error(t("photo.errorTooLarge"), { description: t("photo.errorTooLargeHint") });
      return;
    }
    const url = URL.createObjectURL(f);
    setAiPhotoSource(layer.id, f, url);
  };

  const ensureUploadedUrl = async (): Promise<string | null> => {
    if (source?.uploadedUrl) return source.uploadedUrl;
    if (!source?.file) return null;
    try {
      const dataUrl = await blobToDataUrl(source.file);
      const designId = `face-${(crypto as { randomUUID?: () => string }).randomUUID?.() ?? Date.now()}`;
      const url = await uploadCartPreview(dataUrl, designId);
      setAiPhotoUploadedUrl(layer.id, url);
      return url;
    } catch (e) {
      console.error("[AiPhoto] upload failed", e);
      toast.error("Kunde inte ladda upp bilden");
      return null;
    }
  };

  const ensureHash = async (): Promise<string | null> => {
    if (source?.hash) return source.hash;
    if (!source?.file) return null;
    try {
      const h = await hashFile(source.file);
      setAiPhotoHash(layer.id, h);
      return h;
    } catch {
      return null;
    }
  };

  const runSwap = async (opts: { force?: boolean } = {}) => {
    // Reference-based recipes (face-swap / pet) need a reference; the
    // removeBackground / style recipes do not.
    if (needsReference && !refUrl) {
      toast.error(t("aiPhoto.missingReference"));
      return;
    }
    if (!source?.file) {
      toast.error(t("ai.uploadFirstShort"));
      return;
    }
    setBusy(true);
    setStage(t("ai.stagePrep"));
    const jobId = `ai-photo:${layer.id}`;
    const { startAiJob, updateAiJobStage, endAiJob } = useAiBusyStore.getState();
    startAiJob(jobId, { label: t("ai.creatingImage"), expectedSeconds, stage: t("ai.stagePrep") });
    try {
      const hash = await ensureHash();
      const { recipe, optionValues, slot: cacheRefSlot } = resolveFor(selectedStyleId, refUrl);
      // Only use cache when the user hasn't explicitly asked for a regenerate.
      if (!opts.force && hash) {
        const cached = getCachedFaceSwap(layer.id, hash, cacheRefSlot);
        if (cached) {
          setAiPhotoResult(layer.id, cached);
          toast.success(t("aiPhoto.ready"));
          return;
        }
      }
      setStage(t("ai.stageUpload"));
      updateAiJobStage(jobId, t("ai.stageUpload"));
      const faceImageUrl = await ensureUploadedUrl();
      if (!faceImageUrl) return;
      const designId = `swap-${(crypto as { randomUUID?: () => string }).randomUUID?.() ?? Date.now()}`;

      console.info("[AiPhoto] invoking recipe", {
        layerId: layer.id,
        recipeId: recipe.id,
        styleId: selectedStyleId,
        motif: motif ? "set" : "none",
        force: !!opts.force,
      });

      setStage(t("ai.stageCreate"));
      updateAiJobStage(jobId, t("ai.stageCreate"));
      // Send the recipe + its inputs. Aspect ratio now rides on the recipe
      // params (match_input_image); the client still contain-renders as the
      // safety net, so the old layer-aspect hint is no longer needed here.
      const { data, error } = await supabase.functions.invoke("replicate-face-swap", {
        body: {
          recipe: { model: recipe.model, prompt: recipe.prompt, params: recipe.params, steps: recipe.steps },
          customerImageUrls: [faceImageUrl],
          referenceImageUrls: needsReference && refUrl ? [refUrl] : [],
          optionValues,
          motif,
          designId,
        },
      });
      if (error) throw error;
      setStage(t("ai.stageFetch"));
      updateAiJobStage(jobId, t("ai.stageFetch"));
      const payload = data as {
        printFileUrl?: string;
        error?: string;
        fallback?: boolean;
        userMessage?: string;
        usedReferenceImageUrl?: string;
        usedFaceImageUrl?: string;
        replicateOutputUrl?: string;
      };
      if (payload?.error) {
        const friendly = payload.userMessage ?? t("aiPhoto.friendlyFailed");
        toast.error(t("aiPhoto.failed"), { description: friendly });
        return;
      }
      const printFileUrl = payload?.printFileUrl;
      if (!printFileUrl) throw new Error(t("ai.noResult"));
      console.info("[AiPhoto] face-swap result", {
        layerId: layer.id,
        printFileUrl,
        replicateOutputUrl: payload.replicateOutputUrl,
        usedReferenceImageUrl: payload.usedReferenceImageUrl,
        usedFaceImageUrl: payload.usedFaceImageUrl,
      });
      setAiPhotoResult(layer.id, printFileUrl);
      if (hash) addFaceSwapToCache(layer.id, hash, cacheRefSlot, printFileUrl);
      toast.success(t("aiPhoto.ready"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("common.unknownError");
      console.error("[AiPhoto] swap failed", e);
      toast.error(t("aiPhoto.failed"), { description: msg });
    } finally {
      setBusy(false);
      setStage(null);
      endAiJob(jobId);
    }
  };

  // Disabled state for the create button. A reference is only required for the
  // reference-based recipes.
  const disabledCreate = !source || busy || (needsReference && !refUrl);

  // Plain photo (no recipe) is never routed here; render nothing defensively.
  if (!driver) return null;

  return (
    <div className="space-y-3">
      {heading && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {heading}
        </h4>
      )}

      {needsReference && !refUrl && (
        <p className="text-xs text-destructive">
          {t("aiPhoto.notConfigured")}
        </p>
      )}

      {showSubjectPicker && (
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("aiPhoto.chooseSubject")}
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {references.map((r) => {
              const isActive = (selectedRef?.url ?? null) === r.url;
              const cachedUrl = source?.hash
                ? getCachedFaceSwap(layer.id, source.hash, resolveFor(null, r.url).slot)
                : null;
              const thumbSrc = cachedUrl ?? r.url;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setAiPhotoSelectedRef(layer.id, r.url)}
                  className={cn(
                    "relative aspect-square rounded-xl overflow-hidden ring-1 ring-border bg-muted transition hover:-translate-y-0.5",
                    isActive && "ring-2 ring-primary",
                  )}
                >
                  <img src={thumbSrc} alt={r.label ?? ""} className="w-full h-full object-cover" />
                  {cachedUrl && (
                    <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[9px] font-semibold px-1.5 py-0.5 rounded-full leading-none">
                      ✓
                    </span>
                  )}
                  {r.label && (
                    <span className="absolute bottom-0 inset-x-0 bg-background/85 backdrop-blur-sm text-[10px] py-1 text-center font-medium">
                      {r.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("aiPhoto.yourImage")}
        </Label>
        {!source ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={cn(
              "w-full h-28 rounded-2xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1.5 transition hover:bg-accent/30",
            )}
          >
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">{t("photo.uploadCta")}</span>
            {hintKey && (
              <span className="text-[10px] text-muted-foreground px-3 text-center">
                {t(hintKey)}
              </span>
            )}
          </button>
        ) : (
          <div className="space-y-2">
            <div className="relative rounded-xl overflow-hidden border bg-muted aspect-square w-24">
              <img src={source.previewUrl} alt={t("aiPhoto.yourImage")} className="w-full h-full object-cover" />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                className="flex-1"
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                {t("photo.swap")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => clearAiPhoto(layer.id)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      {/* Style picker — shown whenever the recipe offers style choices. */}
      {styleChoices.length > 1 && (
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("aiPhoto.chooseStyleOptional")}
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {styleChoices.map((p) => {
              const isActive = selectedStyleId === p.id;
              const cachedUrl = source?.hash
                ? getCachedFaceSwap(layer.id, source.hash, resolveFor(p.id, null).slot)
                : null;
              const thumbSrc = cachedUrl ?? p.thumbnailUrl ?? null;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (busy) return;
                    setSelectedStyleId(p.id);
                    if (cachedUrl) setAiPhotoResult(layer.id, cachedUrl);
                  }}
                  className={cn(
                    "relative aspect-square rounded-xl overflow-hidden ring-1 ring-border bg-muted transition hover:-translate-y-0.5 disabled:opacity-50 disabled:translate-y-0 disabled:cursor-not-allowed",
                    isActive && "ring-2 ring-primary",
                  )}
                >
                  {thumbSrc ? (
                    <img src={thumbSrc} alt={p.label} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-muted to-accent/30 flex items-center justify-center">
                      <Sparkles className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  {cachedUrl && (
                    <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[9px] font-semibold px-1.5 py-0.5 rounded-full leading-none">
                      ✓
                    </span>
                  )}
                  <span className="absolute bottom-0 inset-x-0 bg-background/85 backdrop-blur-sm text-[10px] py-1 text-center font-medium">
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {t("aiPhoto.styleHintBackgroundOnly")}
          </p>
        </div>
      )}

      <Button
        type="button"
        onClick={() => runSwap({ force: !!result })}
        disabled={disabledCreate}
        className="w-full"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t("aiPhoto.creating")}
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-2" />
            {result ? t("aiPhoto.recreate") : t("aiPhoto.create")}
          </>
        )}
      </Button>

      <AiProgress
        active={busy}
        expectedSeconds={expectedSeconds}
        label={t("ai.creatingImage")}
        stage={stage}
      />
    </div>
  );
}
