// Customer-side AI section. One instance per `aiPhoto` layer.
//
// The layer's legacy `subjectKind` (+ simpleStyleMode + the customer's chosen
// style) is resolved to a built-in recipe by `resolveLegacyRecipe`, and this
// component sends that recipe — model + prompt + params + steps + the injected
// {style} option + the {motif} — to `replicate-face-swap`. It no longer sends
// the old bag of behaviour flags; the edge routes purely on `recipe`. The five
// legacy modes map to: face-swap (human), pet, and the three removeBackground
// recipes (style→cutout chain, Nano watercolor, Nano backdrop).
//
// Results are cached in localStorage keyed by (layerId, faceHash, slot) where
// `slot` is `aiRecipeCacheSlot` (recipe id + injected option values + motif +
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
import { resolveLegacyRecipe, aiRecipeCacheSlot } from "@/lib/legacy-ai-recipe";
import type { TemplateLayer, AiStylePreset } from "@/lib/template-schema";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AiProgress } from "./AiProgress";

type AiPhotoLayer = Extract<TemplateLayer, { type: "aiPhoto" }>;

interface Props {
  layer: AiPhotoLayer;
  /** Heading shown when there are multiple aiPhoto layers in one template. */
  heading?: string | null;
  /** Template-level AI style presets. Only `enabled !== false` ones are shown,
   *  and only when the layer is in "removeBackground" mode. */
  aiStylePresets?: AiStylePreset[];
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

export function AiPhotoSection({ layer, heading, aiStylePresets }: Props) {
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
  const subjectKind = layer.defaults.subjectKind ?? "human";
  const isRemoveBg = subjectKind === "removeBackground";
  const simpleStyleMode = isRemoveBg && layer.defaults.simpleStyleMode === true;
  // Legacy aiPhoto layers carry the motif on the (misnamed) fluxStylePrompt
  // field. It fills the recipe's reserved {motif} token — load-bearing for the
  // Nano paths, ignored by the reference-based (face-swap / pet) recipes.
  const motif = layer.defaults.fluxStylePrompt ?? undefined;

  /** Single source of truth for the built-in recipe, its injected option values
   *  and the cache slot, given a style pick + reference. Running a swap and
   *  looking up cached thumbnails both go through this, so a written cache entry
   *  and a later lookup can never compute different keys. */
  const resolveFor = (style: AiStylePreset | null, refForSlot: string | null) => {
    const { recipe, optionValues } = resolveLegacyRecipe({
      subjectKind,
      simpleStyleMode,
      style: style
        ? { prompt: style.prompt, styleInstruction: style.styleInstruction, bridge: style.bridge, label: style.label }
        : null,
    });
    const slot = aiRecipeCacheSlot({
      recipeId: recipe.id,
      optionValues,
      motif,
      referenceImageUrl: isRemoveBg ? null : refForSlot,
    });
    return { recipe, optionValues, slot };
  };

  // Resolve admin-configured reference subjects. Falls back to the legacy
  // single `referenceImageUrl` so old templates keep working unchanged.
  const allReferenceImages = (() => {
    const list = layer.defaults.referenceImages ?? [];
    if (list.length > 0) return list;
    if (layer.defaults.referenceImageUrl) {
      return [{ id: "legacy", url: layer.defaults.referenceImageUrl, label: undefined, orientation: "any" as const }];
    }
    return [];
  })();

  // Filter by current canvas orientation. Refs tagged "any" (or missing the
  // field on legacy data) show in both. The face-swap cache is already keyed
  // by refUrl, so flipping orientation → different refUrl → automatically
  // either re-uses a cached swap or shows the unswapped landscape/portrait ref.
  const editorOrientation = useEditorStore((s) => s.orientation);
  const referenceImages = allReferenceImages.filter((r) => {
    const o = (r as { orientation?: string }).orientation ?? "any";
    return o === "any" || o === editorOrientation;
  });
  const showSubjectPicker = !isRemoveBg && referenceImages.length >= 2;

  // Customer-selected reference. Defaults to the first one on mount/change.
  const selectedRefUrlFromStore = aiPhotoSelectedRefUrl[layer.id] ?? null;
  const selectedRef =
    referenceImages.find((r) => r.url === selectedRefUrlFromStore) ?? referenceImages[0] ?? null;
  const refUrl = selectedRef?.url ?? layer.defaults.referenceImageUrl ?? null;

  useEffect(() => {
    // Initialize / heal the store's selection when references or orientation change.
    if (isRemoveBg) return;
    if (referenceImages.length === 0) return;
    const stored = aiPhotoSelectedRefUrl[layer.id];
    if (!stored || !referenceImages.some((r) => r.url === stored)) {
      setAiPhotoSelectedRef(layer.id, referenceImages[0].url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.id, isRemoveBg, editorOrientation, referenceImages.map((r) => r.url).join("|")]);

  // Sync the visible swap result to whatever reference subject is currently
  // selected. If we have a cached swap for (face, ref) → show it instantly.
  // Otherwise clear the stale result so the editor falls back to the newly
  // selected reference image (the customer can then tap "Skapa" to swap).
  useEffect(() => {
    if (isRemoveBg) return;
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
  }, [layer.id, isRemoveBg, refUrl, source?.hash, subjectKind]);

  // Style picker state — only relevant for removeBackground mode.
  const visibleStyles = (aiStylePresets ?? []).filter((p) => p.enabled !== false);
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);

  // Auto-select the first available style when none is picked yet (the
  // "Ingen stil"/no-style option has been removed — customers must pick one).
  useEffect(() => {
    if (!isRemoveBg) return;
    if (selectedStyleId) return;
    if (visibleStyles.length === 0) return;
    setSelectedStyleId(visibleStyles[0].id);
  }, [isRemoveBg, selectedStyleId, visibleStyles]);

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
    // human/pet need a reference image; removeBackground does NOT.
    if (!isRemoveBg && !refUrl) {
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
      const selectedPreset = isRemoveBg && selectedStyleId
        ? visibleStyles.find((p) => p.id === selectedStyleId) ?? null
        : null;
      const { recipe, optionValues, slot: cacheRefSlot } = resolveFor(selectedPreset, refUrl);
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
        subjectKind,
        styleId: selectedPreset?.id ?? null,
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
          referenceImageUrls: isRemoveBg ? [] : refUrl ? [refUrl] : [],
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

  // Disabled state for the create button. Reference image is only required
  // for non-removeBackground modes.
  const disabledCreate = !source || busy || (!isRemoveBg && !refUrl);

  return (
    <div className="space-y-3">
      {heading && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {heading}
        </h4>
      )}

      {!isRemoveBg && !refUrl && (
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
            {referenceImages.map((r) => {
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
            <span className="text-[10px] text-muted-foreground px-3 text-center">
              {subjectKind === "pet"
                ? t("aiPhoto.subjectHintPet")
                : subjectKind === "removeBackground"
                  ? t("aiPhoto.subjectHintRemoveBg")
                  : t("aiPhoto.subjectHintHuman")}
            </span>
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

      {/* Style picker — only for removeBackground when the template has presets. */}
      {isRemoveBg && visibleStyles.length > 1 && (
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("aiPhoto.chooseStyleOptional")}
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {visibleStyles.map((p) => {
              const isActive = selectedStyleId === p.id;
              const cachedUrl = source?.hash
                ? getCachedFaceSwap(layer.id, source.hash, resolveFor(p, null).slot)
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
