import { useEffect, useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

interface Mockup {
  url: string;
  label: string;
}

/**
 * Mockup gallery — renders Gelato product mockups (room scenes, side views for canvas).
 * For now, we render a static set of placeholder previews based on map preview.
 * The Gelato Mockup API integration is wired but lazy.
 */
export function MockupGallery() {
  const { config, size, variant, orientation } = useEditorStore();
  const [mockups, setMockups] = useState<Mockup[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!config || !size || !variant) return;
    let cancelled = false;
    setLoading(true);
    // Placeholder: in production, call gelato-mockup edge function with the
    // current preview rendered as an image. For now we display environment labels.
    const envs = config.product_type === "canvas"
      ? ["Vardagsrum", "Sovrum", "Sidovy", "Närbild kant", "Hängande", "Detalj"]
      : ["Vardagsrum", "Sovrum", "Kontor", "Hallway", "Närbild", "På vägg"];
    const placeholders: Mockup[] = envs.map((label) => ({ label, url: "" }));
    if (!cancelled) {
      setMockups(placeholders);
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [config, size, variant, orientation]);

  if (!config) return null;

  return (
    <div className="border-t bg-muted/30">
      <div className="px-4 py-3">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
          Förhandsgranska i miljö
        </h3>
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x">
          {loading ? (
            <div className="flex items-center justify-center w-full py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            mockups.map((m, i) => (
              <div
                key={i}
                className="flex-shrink-0 w-32 h-32 md:w-40 md:h-40 rounded-lg overflow-hidden bg-card border snap-start relative group cursor-pointer hover:shadow-lg transition"
              >
                {m.url ? (
                  <img src={m.url} alt={m.label} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50 text-muted-foreground text-xs">
                    {m.label}
                  </div>
                )}
                <div className="absolute bottom-0 inset-x-0 bg-background/85 backdrop-blur-sm text-xs py-1 text-center font-medium">
                  {m.label}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
