// Wallery admin — AI recipes library (Step 3a).
//
// The merchant-facing home for AI recipes: starter recipes to clone + the model
// catalog. The full editor (edit prompt, pick model, Test) + the shop's own saved
// recipes land in 3b/3c. For now this lists the built-in starters + models so the
// tab is real and navigable.
import { Link } from "react-router-dom";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { BUILTIN_RECIPES, MODEL_CATALOG, type ModelId } from "@/lib/ai-recipe";

const MODEL_LABEL: Record<ModelId, string> = {
  "face-swap": "Face swap",
  "ai-edit": "AI edit",
  "art-style": "Art style",
  cutout: "Cutout",
};

export default function AiLibraryPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <Link
          to="/admin/configs"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Templates
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" /> AI recipes
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-xl">
          A recipe defines what the AI does to a customer&rsquo;s photo — a face swap, a
          pet portrait, a style. Write it once and reuse it across templates. Start from a
          template below, or build your own.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Starter recipes
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {BUILTIN_RECIPES.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium leading-tight">{r.name}</h3>
                  {r.description && (
                    <p className="text-sm text-muted-foreground mt-1">{r.description}</p>
                  )}
                </div>
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide px-2 py-1 rounded-full bg-accent text-accent-foreground whitespace-nowrap">
                  {MODEL_LABEL[r.model]}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Models
        </h2>
        <div className="space-y-2">
          {Object.values(MODEL_CATALOG).map((m) => (
            <Card key={m.id} className="p-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-medium leading-tight">{m.label}</h3>
                <p className="text-sm text-muted-foreground mt-1">{m.blurb}</p>
              </div>
              <div className="shrink-0 text-[11px] text-muted-foreground text-right whitespace-nowrap">
                <div>{m.usesPrompt ? "Prompt-driven" : "No prompt"}</div>
                <div className="opacity-70">{m.costTier} cost</div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Next: the recipe editor (edit the prompt, pick a model, and a Test button) and your
        own saved recipes.
      </p>
    </div>
  );
}
