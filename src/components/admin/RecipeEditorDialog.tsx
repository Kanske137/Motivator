// Recipe editor (Step 3b) — the "tweaker" depth of the AI library.
//
// Merchant-facing surface, deliberately shallow: name, model, prompt. Model
// params hide under Advanced, driven by the catalog's `params` list so a model
// only ever shows the knobs it actually has. Chained `steps[]` and
// `customerOptions` are not edited here yet — they round-trip untouched.
//
// The Test panel runs the recipe through `admin-ai-recipes` → the same
// `runRecipe` executor the customer path uses, so the preview is truthful.
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { uploadAiReferenceImage } from "@/lib/ai-reference-upload";
import { saveRecipe, testRecipe } from "@/lib/ai-recipes-api";
import {
  MODEL_CATALOG,
  type AiRecipe,
  type ModelId,
  type RecipeParamKey,
  type RecipeParams,
} from "@/lib/ai-recipe";

/** What the dialog edits. `id` absent (or `builtin-…`) means saving clones. */
export type RecipeDraft = Omit<AiRecipe, "id" | "params" | "builtIn"> & {
  id?: string;
  params: RecipeParams;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The recipe to edit, a starter to clone, or undefined for a blank one. */
  initial?: AiRecipe;
  onSaved: () => void;
}

const ASPECT_CHOICES: Array<{ value: string; label: string }> = [
  { value: "match_customer", label: "Match the customer's photo" },
  { value: "match_reference", label: "Match your reference image" },
  { value: "1:1", label: "Square (1:1)" },
  { value: "4:5", label: "Portrait (4:5)" },
  { value: "3:4", label: "Portrait (3:4)" },
  { value: "2:3", label: "Portrait (2:3)" },
  { value: "3:2", label: "Landscape (3:2)" },
  { value: "16:9", label: "Landscape (16:9)" },
];

function blankDraft(): RecipeDraft {
  return { name: "", model: "ai-edit", prompt: "", params: {} };
}

function toDraft(r: AiRecipe): RecipeDraft {
  // A built-in keeps its id so the caller knows the origin; `save` clones it.
  return {
    id: r.id,
    name: r.builtIn ? `${r.name} (copy)` : r.name,
    description: r.description,
    model: r.model,
    prompt: r.prompt ?? "",
    params: { ...(r.params ?? {}) },
    customerOptions: r.customerOptions,
    steps: r.steps,
  };
}

/** `{style}` → "style". Reserved conceptual tokens are still shown; the merchant
 *  decides what to feed them when testing. */
function promptTokens(prompt: string | undefined): string[] {
  if (!prompt) return [];
  return [...new Set([...prompt.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
}

/** A small upload slot showing a thumbnail once filled. */
function ImageSlot({
  url,
  label,
  onPick,
  onClear,
  busy,
}: {
  url?: string;
  label: string;
  onPick: (file: File) => void;
  onClear: () => void;
  busy?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative">
        {url ? (
          <div className="relative group">
            <img
              src={url}
              alt={label}
              className="h-24 w-24 rounded-md object-cover border"
            />
            <button
              type="button"
              onClick={onClear}
              className="absolute -top-2 -right-2 rounded-full bg-background border p-1 shadow-sm hover:bg-accent"
              aria-label={`Remove ${label}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="h-24 w-24 rounded-md border border-dashed flex items-center justify-center text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

export default function RecipeEditorDialog({ open, onOpenChange, initial, onSaved }: Props) {
  const [draft, setDraft] = useState<RecipeDraft>(blankDraft);
  const [saving, setSaving] = useState(false);

  // Test panel
  const [customerUrl, setCustomerUrl] = useState<string>();
  const [referenceUrls, setReferenceUrls] = useState<Record<number, string>>({});
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ url: string; ms: number } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(initial ? toDraft(initial) : blankDraft());
    setCustomerUrl(undefined);
    setReferenceUrls({});
    setOptionValues({});
    setTestResult(null);
    setTestError(null);
  }, [open, initial]);

  const spec = MODEL_CATALOG[draft.model];
  const tokens = useMemo(() => promptTokens(draft.prompt), [draft.prompt]);

  function setModel(model: ModelId) {
    // Drop params the new model doesn't have, so we never send it a stray knob.
    const allowed = new Set(MODEL_CATALOG[model].params);
    const params = Object.fromEntries(
      Object.entries(draft.params).filter(([k]) => allowed.has(k as RecipeParamKey)),
    ) as RecipeParams;
    setDraft({ ...draft, model, params });
    setTestResult(null);
  }

  function setParam<K extends keyof RecipeParams>(key: K, value: RecipeParams[K]) {
    setDraft((d) => ({ ...d, params: { ...d.params, [key]: value } }));
  }

  async function pickImage(file: File, slot: "customer" | number) {
    const key = slot === "customer" ? "customer" : `ref-${slot}`;
    setUploading(key);
    try {
      const url = await uploadAiReferenceImage(file);
      if (slot === "customer") setCustomerUrl(url);
      else setReferenceUrls((r) => ({ ...r, [slot]: url }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const res = await testRecipe({
        recipe: { ...draft, params: draft.params } as Partial<AiRecipe>,
        customerImageUrls: customerUrl ? [customerUrl] : [],
        referenceImageUrls: Object.keys(referenceUrls)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => referenceUrls[Number(k)]),
        optionValues,
      });
      setTestResult({ url: res.outputUrl, ms: res.ms });
    } catch (e) {
      setTestError(e instanceof Error ? e.message : "The test run failed");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!draft.name.trim()) {
      toast.error("Give the recipe a name");
      return;
    }
    setSaving(true);
    try {
      await saveRecipe({ ...draft, name: draft.name.trim() } as Partial<AiRecipe>);
      toast.success("Recipe saved");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the recipe");
    } finally {
      setSaving(false);
    }
  }

  const needsCustomer = spec.customerImages.min > 0;
  const missingCustomer = needsCustomer && !customerUrl;
  const refCount = Object.values(referenceUrls).filter(Boolean).length;
  const missingReference = refCount < spec.referenceImages.min;
  const canTest = !testing && !missingCustomer && !missingReference;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{draft.id && !draft.id.startsWith("builtin-") ? "Edit recipe" : "New recipe"}</DialogTitle>
          <DialogDescription>
            A recipe is what the AI does to a customer&rsquo;s photo. Test it here before you
            use it in a template.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="recipe-name">Name</Label>
            <Input
              id="recipe-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Pet portrait in a royal scene"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="recipe-model">Model</Label>
            <Select value={draft.model} onValueChange={(v) => setModel(v as ModelId)}>
              <SelectTrigger id="recipe-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(MODEL_CATALOG).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{spec.blurb}</p>
          </div>

          {spec.usesPrompt ? (
            <div className="space-y-2">
              <Label htmlFor="recipe-prompt">Prompt</Label>
              <Textarea
                id="recipe-prompt"
                rows={5}
                value={draft.prompt ?? ""}
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                placeholder="Describe the edit. Refer to the reference as image #1 and the customer's photo as image #2."
              />
              <p className="text-xs text-muted-foreground">
                Wrap a word in braces to make it a slot the customer fills, e.g.{" "}
                <code className="text-[11px]">{"{style}"}</code>.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
              {spec.label} doesn&rsquo;t take a prompt — it always does the same thing.
            </p>
          )}

          <Collapsible>
            <CollapsibleTrigger className="text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
              Advanced
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-4">
              {spec.params.includes("aspectRatio") && (
                <div className="space-y-2">
                  <Label>Output shape</Label>
                  <Select
                    value={draft.params.aspectRatio ?? "match_customer"}
                    onValueChange={(v) => setParam("aspectRatio", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASPECT_CHOICES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {spec.params.includes("outputFormat") && (
                <div className="space-y-2">
                  <Label>File format</Label>
                  <Select
                    value={draft.params.outputFormat ?? "png"}
                    onValueChange={(v) => setParam("outputFormat", v as "png" | "jpg")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="png">PNG — keeps transparency</SelectItem>
                      <SelectItem value="jpg">JPG — smaller file</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {spec.params.includes("backdropColor") && (
                <div className="space-y-2">
                  <Label htmlFor="backdrop">Backdrop colour</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="backdrop"
                      type="color"
                      className="h-9 w-14 p-1"
                      value={draft.params.backdropColor ?? "#FFFFFF"}
                      onChange={(e) => setParam("backdropColor", e.target.value.toUpperCase())}
                    />
                    <span className="text-xs text-muted-foreground">
                      {draft.params.backdropColor ?? "#FFFFFF"}
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="recipe-desc">Description</Label>
                <Input
                  id="recipe-desc"
                  value={draft.description ?? ""}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Shown to you in the library — not to customers."
                />
              </div>

              {(draft.steps?.length ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">
                  This recipe chains {draft.steps!.length} extra step
                  {draft.steps!.length === 1 ? "" : "s"} after the main model. Editing chained
                  steps isn&rsquo;t available yet — they are preserved when you save.
                </p>
              )}
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          {/* ── Test panel ─────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Test</h3>
              <p className="text-xs text-muted-foreground">
                Runs the real model, exactly as a customer would.
              </p>
            </div>

            <div className="flex flex-wrap gap-4">
              {needsCustomer && (
                <ImageSlot
                  label="Customer photo"
                  url={customerUrl}
                  busy={uploading === "customer"}
                  onPick={(f) => pickImage(f, "customer")}
                  onClear={() => setCustomerUrl(undefined)}
                />
              )}
              {Array.from({ length: spec.referenceImages.max }, (_, i) => (
                <ImageSlot
                  key={i}
                  label={
                    spec.referenceImages.max > 1
                      ? `Reference ${i + 1}${i < spec.referenceImages.min ? "" : " (optional)"}`
                      : "Reference image"
                  }
                  url={referenceUrls[i]}
                  busy={uploading === `ref-${i}`}
                  onPick={(f) => pickImage(f, i)}
                  onClear={() =>
                    setReferenceUrls((r) => {
                      const next = { ...r };
                      delete next[i];
                      return next;
                    })
                  }
                />
              ))}
            </div>

            {tokens.length > 0 && (
              <div className="space-y-2">
                {tokens.map((t) => (
                  <div key={t} className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Test value for <code className="text-[11px]">{`{${t}}`}</code>
                    </Label>
                    <Input
                      value={optionValues[t] ?? ""}
                      onChange={(e) =>
                        setOptionValues((o) => ({ ...o, [t]: e.target.value }))
                      }
                      placeholder="e.g. soft watercolour painting"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="button" variant="secondary" onClick={handleTest} disabled={!canTest}>
                {testing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Running…
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" /> Run test
                  </>
                )}
              </Button>
              {(missingCustomer || missingReference) && (
                <span className="text-xs text-muted-foreground">
                  {missingCustomer
                    ? "Upload a customer photo to test."
                    : `This model needs ${spec.referenceImages.min} reference image${
                        spec.referenceImages.min === 1 ? "" : "s"
                      }.`}
                </span>
              )}
              {testResult && (
                <span className="text-xs text-muted-foreground">
                  Took {(testResult.ms / 1000).toFixed(1)}s
                </span>
              )}
            </div>

            {testError && (
              <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                {testError}
              </p>
            )}

            {testResult && (
              <img
                src={testResult.url}
                alt="Test result"
                className="max-h-72 rounded-md border object-contain"
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !draft.name.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save recipe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
