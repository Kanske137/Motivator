// Customer-side AI-style picker. Visible when a photo is uploaded and the
// active product template defines `aiStyles`. Each preset triggers the
// `replicate-style` edge function which returns a `printFileUrl` already
// uploaded to the print-files bucket.
//
// Cache: results are keyed by (originalPhotoUrl, presetId) and persisted in
// localStorage so revisiting a previously-tried style is instant and free.
import { useState } from "react";
import { Loader2, Sparkles, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/stores/editorStore";
import { supabase } from "@/integrations/supabase/client";
import { uploadCartPreview } from "@/lib/upload-preview";
import type { AiStylePreset } from "@/lib/template-schema";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  presets: AiStylePreset[];
}

/** Convert a Blob to a JPEG dataURL via canvas (Replicate prefers HTTPS URLs,
 *  but we stage the original via uploadCartPreview which accepts a dataURL). */
async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("blobToDataUrl failed"));
    r.readAsDataURL(blob);
  });
}

export function AiStyleSection({ presets }: Props) {
  const photoFile = useEditorStore((s) => s.photoFile);
  const photoPreviewUrl = useEditorStore((s) => s.photoPreviewUrl);
  const originalPhotoUrl = useEditorStore((s) => s.originalPhotoUrl);
  const setOriginalPhotoUrl = useEditorStore((s) => s.setOriginalPhotoUrl);
  const aiPrintFileUrl = useEditorStore((s) => s.aiPrintFileUrl);
  const setAiPrintFileUrl = useEditorStore((s) => s.setAiPrintFileUrl);
  const setPhotoSource = useEditorStore((s) => s.setPhotoSource);
  const addAiResultToCache = useEditorStore((s) => s.addAiResultToCache);
  const getCachedAiResult = useEditorStore((s) => s.getCachedAiResult);
  const listAiResultsForPhoto = useEditorStore((s) => s.listAiResultsForPhoto);
  const clearAiResult = useEditorStore((s) => s.clearAiResult);
  // Subscribe to the cache so the history list re-renders when entries change.
  const aiResultCache = useEditorStore((s) => s.aiResultCache);

  const [busyId, setBusyId] = useState<string | null>(null);

  const ensureUploadedPhotoUrl = async (): Promise<string | null> => {
    if (originalPhotoUrl) return originalPhotoUrl;
    if (!photoFile) return null;
    try {
      const dataUrl = await blobToDataUrl(photoFile);
      const designId = `src-${(crypto as any)?.randomUUID?.() ?? Date.now()}`;
      const url = await uploadCartPreview(dataUrl, designId);
      setOriginalPhotoUrl(url);
      return url;
    } catch (e) {
      console.error("[AiStyle] upload failed", e);
      toast.error("Kunde inte ladda upp bilden");
      return null;
    }
  };

  const applyStyle = async (preset: AiStylePreset) => {
    if (!photoFile) {
      toast.error("Ladda upp en bild först");
      return;
    }

    // Try cache first using whichever photoKey we already have (no upload yet).
    const knownKey = originalPhotoUrl;
    if (knownKey) {
      const cached = getCachedAiResult(knownKey, preset.id);
      if (cached) {
        setAiPrintFileUrl(cached);
        toast.success(`Stil "${preset.label}" återanvänd`);
        return;
      }
    }

    setBusyId(preset.id);
    try {
      const imageUrl = await ensureUploadedPhotoUrl();
      if (!imageUrl) return;

      // Re-check cache once we have the resolved photoKey (covers the case
      // where the upload just happened and an entry already exists from a
      // previous session).
      const cached = getCachedAiResult(imageUrl, preset.id);
      if (cached) {
        setAiPrintFileUrl(cached);
        toast.success(`Stil "${preset.label}" återanvänd`);
        return;
      }

      const designId = (crypto as any)?.randomUUID?.() ?? `${Date.now()}`;
      const { data, error } = await supabase.functions.invoke("replicate-style", {
        body: { imageUrl, prompt: preset.prompt, designId },
      });
      if (error) throw error;
      const printFileUrl = (data as { printFileUrl?: string })?.printFileUrl;
      if (!printFileUrl) throw new Error("AI-tjänsten returnerade ingen bild");
      setAiPrintFileUrl(printFileUrl);
      addAiResultToCache(imageUrl, preset.id, preset.label, printFileUrl);
      toast.success(`Stil "${preset.label}" tillämpad`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Okänt fel";
      console.error("[AiStyle] failed", e);
      toast.error("Kunde inte tillämpa stilen", { description: msg });
    } finally {
      setBusyId(null);
    }
  };

  const undoAi = () => {
    // Drop AI result; keep the original photo as design source.
    if (photoFile) setPhotoSource(photoFile, photoPreviewUrl);
    else setAiPrintFileUrl(null);
  };

  if (!photoFile) {
    return (
      <p className="text-xs text-muted-foreground">
        Ladda upp en bild först för att kunna välja AI-stil.
      </p>
    );
  }

  const visiblePresets = presets.filter((p) => p.enabled !== false);
  if (visiblePresets.length === 0) return null;

  // History for the active photo (if uploaded).
  const history = originalPhotoUrl ? listAiResultsForPhoto(originalPhotoUrl) : [];
  // Cheap subscription tickle (avoid lint warning for unused var).
  void aiResultCache;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        Välj stil
      </div>
      <div className="grid grid-cols-3 gap-2">
        {visiblePresets.map((p) => {
          const busy = busyId === p.id;
          const cachedUrl = originalPhotoUrl ? getCachedAiResult(originalPhotoUrl, p.id) : null;
          const isActive = !!cachedUrl && aiPrintFileUrl === cachedUrl;
          return (
            <button
              key={p.id}
              type="button"
              disabled={!!busyId}
              onClick={() => applyStyle(p)}
              className={cn(
                "group relative aspect-square rounded-xl overflow-hidden ring-1 ring-border bg-muted hover:-translate-y-0.5 transition disabled:opacity-50 disabled:translate-y-0",
                isActive && "ring-2 ring-primary",
              )}
            >
              {p.thumbnailUrl ? (
                <img
                  src={p.thumbnailUrl}
                  alt={p.label}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-muted to-accent/30 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              {busy && (
                <div className="absolute inset-0 bg-background/70 backdrop-blur-sm flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
              {cachedUrl && !busy && (
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

      {history.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Dina provade stilar
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {history.map((entry) => {
              const isActive = aiPrintFileUrl === entry.url;
              return (
                <div key={entry.presetId} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setAiPrintFileUrl(entry.url);
                      toast.success(`Stil "${entry.presetLabel}" återanvänd`);
                    }}
                    className={cn(
                      "block w-16 h-16 rounded-lg overflow-hidden ring-1 ring-border bg-muted hover:-translate-y-0.5 transition",
                      isActive && "ring-2 ring-primary",
                    )}
                    title={entry.presetLabel}
                  >
                    <img
                      src={entry.url}
                      alt={entry.presetLabel}
                      className="w-full h-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearAiResult(entry.photoKey, entry.presetId);
                    }}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-background/90 ring-1 ring-border flex items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label="Ta bort från historik"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {aiPrintFileUrl && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={undoAi}
          className="w-full"
        >
          <Undo2 className="h-3.5 w-3.5 mr-1.5" />
          Återgå till foto utan stil
        </Button>
      )}
    </div>
  );
}
