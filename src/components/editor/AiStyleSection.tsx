// Customer-side AI-style picker. Visible when a photo is uploaded and the
// active product template defines `aiStyles`. Each preset triggers the
// `replicate-style` edge function which returns a `printFileUrl` already
// uploaded to the print-files bucket.
import { useState } from "react";
import { Loader2, Sparkles, Undo2 } from "lucide-react";
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
    setBusyId(preset.id);
    try {
      const imageUrl = await ensureUploadedPhotoUrl();
      if (!imageUrl) return;

      const designId = (crypto as any)?.randomUUID?.() ?? `${Date.now()}`;
      const { data, error } = await supabase.functions.invoke("replicate-style", {
        body: { imageUrl, prompt: preset.prompt, designId },
      });
      if (error) throw error;
      const printFileUrl = (data as { printFileUrl?: string })?.printFileUrl;
      if (!printFileUrl) throw new Error("AI-tjänsten returnerade ingen bild");
      setAiPrintFileUrl(printFileUrl);
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        Välj stil
      </div>
      <div className="grid grid-cols-3 gap-2">
        {visiblePresets.map((p) => {
          const busy = busyId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              disabled={!!busyId}
              onClick={() => applyStyle(p)}
              className={cn(
                "group relative aspect-square rounded-xl overflow-hidden ring-1 ring-border bg-muted hover:-translate-y-0.5 transition disabled:opacity-50 disabled:translate-y-0",
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
              <span className="absolute bottom-0 inset-x-0 bg-background/85 backdrop-blur-sm text-[10px] py-1 text-center font-medium">
                {p.label}
              </span>
            </button>
          );
        })}
      </div>
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
