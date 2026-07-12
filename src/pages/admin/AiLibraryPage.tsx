// Wallery admin — AI recipes library (Step 3a + 3b).
//
// The merchant-facing home for AI recipes: the shop's own saved recipes, the
// starter recipes to clone, and the model catalog. Editing/testing happens in
// RecipeEditorDialog; persistence goes through the tenant-scoped
// `admin-ai-recipes` edge function (the browser can't touch the table).
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import RecipeEditorDialog from "@/components/admin/RecipeEditorDialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { deleteRecipe, listRecipes, type SavedRecipe } from "@/lib/ai-recipes-api";
import { BUILTIN_RECIPES, MODEL_CATALOG, recipeChain, type AiRecipe, type ModelId } from "@/lib/ai-recipe";

const MODEL_LABEL: Record<ModelId, string> = {
  "face-swap": "modelFaceSwap",
  "ai-edit": "modelAiEdit",
  "art-style": "modelArtStyle",
  cutout: "modelCutout",
};

/** The whole chain, not just the head — otherwise a style+cutout recipe reads as
 *  a plain "Art style" and the badge quietly lies. */
function ChainBadge({ recipe }: { recipe: AiRecipe }) {
  const { t } = useTranslation();
  return (
    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide px-2 py-1 rounded-full bg-accent text-accent-foreground whitespace-nowrap">
      {recipeChain(recipe).map((m) => t(`admin.aiLibrary.${MODEL_LABEL[m]}`)).join(" → ")}
    </span>
  );
}

export default function AiLibraryPage() {
  const { t } = useTranslation();
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AiRecipe | undefined>();
  const [pendingDelete, setPendingDelete] = useState<SavedRecipe | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setRecipes(await listRecipes());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("admin.aiLibrary.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openNew() {
    setEditing(undefined);
    setEditorOpen(true);
  }

  function openEdit(r: AiRecipe) {
    setEditing(r);
    setEditorOpen(true);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteRecipe(pendingDelete.id);
      toast.success(t("admin.aiLibrary.recipeDeleted"));
      setPendingDelete(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("admin.aiLibrary.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <Link
          to="/admin/configs"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> {t("admin.aiLibrary.backToTemplate")}
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" /> {t("admin.aiLibrary.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              {t("admin.aiLibrary.intro")}
            </p>
          </div>
          <Button onClick={openNew} className="shrink-0">
            <Plus className="h-4 w-4" /> {t("admin.aiLibrary.newRecipe")}
          </Button>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("admin.aiLibrary.yourRecipes")}
        </h2>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("admin.aiLibrary.loading")}
          </div>
        ) : loadError ? (
          <Card className="p-4 text-sm text-destructive border-destructive/30 bg-destructive/5">
            {loadError}
          </Card>
        ) : recipes.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t("admin.aiLibrary.emptyState")}
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {recipes.map((r) => (
              <Card key={r.id} className="p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="font-medium leading-tight">{r.name}</h3>
                  {r.description && (
                    <p className="text-sm text-muted-foreground mt-1">{r.description}</p>
                  )}
                  {/* A prompt that is nothing but slots (e.g. "{style}") says less
                      than the description already did. */}
                  {r.prompt && r.prompt.replace(/\{\w+\}/g, "").trim().length > 0 && (
                    <p className="text-xs text-muted-foreground/80 mt-1.5 line-clamp-2">
                      {r.prompt}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <ChainBadge recipe={r} />
                  <Button variant="ghost" size="icon" onClick={() => openEdit(r)} aria-label={t("admin.aiLibrary.edit")}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPendingDelete(r)}
                    aria-label={t("admin.aiLibrary.delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("admin.aiLibrary.starterRecipes")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {BUILTIN_RECIPES.map((r) => (
            <Card key={r.id} className="p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium leading-tight">{r.name}</h3>
                  {r.description && (
                    <p className="text-sm text-muted-foreground mt-1">{r.description}</p>
                  )}
                </div>
                <ChainBadge recipe={r} />
              </div>
              <Button variant="secondary" size="sm" className="self-start" onClick={() => openEdit(r)}>
                {t("admin.aiLibrary.useThis")}
              </Button>
            </Card>
          ))}
        </div>
      </section>

      {/* Reference, not a third thing to act on. The editor already shows a
          model's blurb when you select it, so this stays collapsed. */}
      <Collapsible>
        <CollapsibleTrigger className="text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
          {t("admin.aiLibrary.whichModels")}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <Card className="divide-y">
            {Object.values(MODEL_CATALOG).map((m) => (
              <div key={m.id} className="p-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium leading-tight">{m.label}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{m.blurb}</p>
                </div>
                <div className="shrink-0 text-[11px] text-muted-foreground text-right whitespace-nowrap">
                  <div>{m.usesPrompt ? t("admin.aiLibrary.promptDriven") : t("admin.aiLibrary.noPrompt")}</div>
                  <div className="opacity-70">{t("admin.aiLibrary.costTier", { tier: m.costTier })}</div>
                </div>
              </div>
            ))}
          </Card>
        </CollapsibleContent>
      </Collapsible>

      <RecipeEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={editing}
        onSaved={refresh}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.aiLibrary.deleteTitle", { name: pendingDelete?.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.aiLibrary.deleteWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("admin.aiLibrary.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("admin.aiLibrary.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
