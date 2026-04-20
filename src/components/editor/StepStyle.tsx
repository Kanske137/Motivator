import { useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Sparkles } from "lucide-react";
import { STYLE_PRESETS } from "@/lib/pricing";
import { supabase } from "@/integrations/supabase/client";
import { uploadDataUrl } from "@/lib/storage";
import { toast } from "sonner";

export function StepStyle() {
  const { imageUrl, styledImageUrl, setStyledImageUrl, stylePreset, setStylePreset, next, back } = useEditorStore();
  const [busy, setBusy] = useState<string | null>(null);

  const apply = async (presetId: string, prompt: string) => {
    if (!imageUrl) return;
    setStylePreset(presetId);
    if (presetId === "none" || !prompt) {
      setStyledImageUrl(null);
      return;
    }
    setBusy(presetId);
    try {
      const { data, error } = await supabase.functions.invoke("replicate-style", {
        body: { imageUrl, prompt },
      });
      if (error) throw error;
      const output: string = data?.output;
      if (!output) throw new Error("Ingen bild från Replicate");
      // Replicate returnerar URL — ladda upp till vår storage så vi äger filen
      let finalUrl = output;
      if (output.startsWith("http")) {
        const blob = await (await fetch(output)).blob();
        finalUrl = await uploadDataUrl(URL.createObjectURL(blob), "jpg");
      }
      setStyledImageUrl(finalUrl);
      toast.success("Stil applicerad");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "AI-stil misslyckades");
      setStylePreset(null);
    } finally {
      setBusy(null);
    }
  };

  const preview = styledImageUrl || imageUrl;

  return (
    <div className="p-4 space-y-4">
      <p className="text-sm text-muted-foreground">Välj en AI-stil eller behåll originalet.</p>

      {preview && (
        <Card className="overflow-hidden">
          <img src={preview} alt="Förhandsvisning" className="w-full h-auto max-h-72 object-contain bg-muted" />
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2">
        {STYLE_PRESETS.map((p) => {
          const active = stylePreset === p.id || (!stylePreset && p.id === "none");
          return (
            <button
              key={p.id}
              onClick={() => apply(p.id, p.prompt)}
              disabled={busy !== null}
              className={`relative p-3 rounded-md border text-sm font-medium transition-colors ${
                active ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              } disabled:opacity-50`}
            >
              {busy === p.id ? (
                <Loader2 className="size-4 animate-spin mx-auto" />
              ) : (
                <span className="flex items-center justify-center gap-1.5">
                  {p.id !== "none" && <Sparkles className="size-3.5" />}
                  {p.label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={back}>Tillbaka</Button>
        <Button className="flex-1" onClick={next} disabled={busy !== null}>Nästa</Button>
      </div>
    </div>
  );
}
