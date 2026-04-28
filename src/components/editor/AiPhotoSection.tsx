// Customer-side face-swap section. One instance per `aiPhoto` layer. The
// admin has uploaded a reference image (e.g. a king); the customer uploads
// a face photo, then taps "Skapa AI-bild" to run the face-swap edge
// function. Results are cached in localStorage so re-using the same selfie
// on the same reference is instant.
import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Trash2, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useEditorStore } from "@/stores/editorStore";
import { supabase } from "@/integrations/supabase/client";
import { uploadCartPreview } from "@/lib/upload-preview";
import { hashFile } from "@/lib/ai-cache-storage";
import type { TemplateLayer } from "@/lib/template-schema";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type AiPhotoLayer = Extract<TemplateLayer, { type: "aiPhoto" }>;

interface Props {
  layer: AiPhotoLayer;
  /** Heading shown when there are multiple aiPhoto layers in one template. */
  heading?: string | null;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";
const MAX_BYTES = 25 * 1024 * 1024;

const SUBJECT_HINT: Record<string, string> = {
  human: "Bilden ska visa ansiktet rakt framifrån, väl belyst.",
  cat: "Bilden ska visa kattens ansikte tydligt, gärna framifrån.",
  dog: "Bilden ska visa hundens ansikte tydligt, gärna framifrån.",
  other: "Bilden ska visa motivets ansikte tydligt och väl belyst.",
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("blobToDataUrl failed"));
    r.readAsDataURL(blob);
  });
}

export function AiPhotoSection({ layer, heading }: Props) {
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

  const source = sources[layer.id];
  const result = results[layer.id] ?? null;
  const refUrl = layer.defaults.referenceImageUrl ?? null;
  const subjectKind = layer.defaults.subjectKind ?? "human";
  const swapPrompt = layer.defaults.swapPrompt;

  const [busy, setBusy] = useState(false);

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
      toast.error("Endast bildfiler stöds");
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("Bilden är för stor", { description: "Max 25 MB." });
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

  const runSwap = async () => {
    if (!refUrl) {
      toast.error("Saknar referensbild för det här motivet");
      return;
    }
    if (!source?.file) {
      toast.error("Ladda upp en bild först");
      return;
    }
    setBusy(true);
    try {
      const hash = await ensureHash();
      if (hash) {
        const cached = getCachedFaceSwap(layer.id, hash, refUrl);
        if (cached) {
          setAiPhotoResult(layer.id, cached);
          toast.success("AI-bild återanvänd");
          return;
        }
      }
      const faceImageUrl = await ensureUploadedUrl();
      if (!faceImageUrl) return;
      const designId = `swap-${(crypto as { randomUUID?: () => string }).randomUUID?.() ?? Date.now()}`;
      const { data, error } = await supabase.functions.invoke("replicate-face-swap", {
        body: {
          referenceImageUrl: refUrl,
          faceImageUrl,
          prompt: swapPrompt,
          subjectKind,
          designId,
        },
      });
      if (error) throw error;
      const payload = data as { printFileUrl?: string; error?: string; fallback?: boolean; userMessage?: string };
      if (payload?.error) {
        const friendly = payload.userMessage ?? "Vi kunde inte skapa bilden. Prova en annan bild med tydligt ansikte och bra ljus.";
        toast.error("Kunde inte skapa bilden", { description: friendly });
        return;
      }
      const printFileUrl = payload?.printFileUrl;
      if (!printFileUrl) throw new Error("Tjänsten returnerade ingen bild");
      setAiPhotoResult(layer.id, printFileUrl);
      if (hash) addFaceSwapToCache(layer.id, hash, refUrl, printFileUrl);
      toast.success("Bilden är klar");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Okänt fel";
      console.error("[AiPhoto] swap failed", e);
      toast.error("Kunde inte skapa bilden", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {heading && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {heading}
        </h4>
      )}

      {refUrl ? (
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Stilreferens
          </Label>
          <div className="relative rounded-xl overflow-hidden border bg-muted aspect-square w-24">
            <img src={refUrl} alt="Referens" className="w-full h-full object-cover" />
          </div>
        </div>
      ) : (
        <p className="text-xs text-destructive">
          Den här produkten saknar referensbild. Be admin lägga till en.
        </p>
      )}

      <div className="space-y-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Din bild
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
            <span className="text-sm font-medium">Ladda upp bild</span>
            <span className="text-[10px] text-muted-foreground px-3 text-center">
              {SUBJECT_HINT[subjectKind] ?? SUBJECT_HINT.other}
            </span>
          </button>
        ) : (
          <div className="space-y-2">
            <div className="relative rounded-xl overflow-hidden border bg-muted aspect-square w-24">
              <img src={source.previewUrl} alt="Din bild" className="w-full h-full object-cover" />
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
                Byt bild
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

      <Button
        type="button"
        onClick={runSwap}
        disabled={!source || !refUrl || busy}
        className="w-full"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Skapar AI-bild…
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-2" />
            {result ? "Skapa AI-bild igen" : "Skapa AI-bild"}
          </>
        )}
      </Button>

      {result && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAiPhotoResult(layer.id, null)}
          className="w-full"
        >
          <Undo2 className="h-3.5 w-3.5 mr-1.5" />
          Visa referensbilden istället
        </Button>
      )}
    </div>
  );
}
