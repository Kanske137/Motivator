// Recipe editor (Step 3b/3d) — the "tweaker" depth of the AI library.
//
// Merchant-facing surface, deliberately shallow: name, model, prompt. Model
// params hide under Advanced, driven by the catalog's `params` list so a model
// only ever shows the knobs it actually has.
//
// Two things earn their place on the main surface. The background-removal
// FINISH, because "style it, then cut it out" is a flow merchants ask for and
// they cannot express it otherwise. And CUSTOMER CHOICES, because a prompt
// token without them silently ships `{style}` to the model.
//
// The finish hangs off the styling model, never off `cutout` — the chain only
// works style-first (a cutout first hands Kontext a transparent PNG and it
// paints a background back in).
//
// The Test panel runs the recipe through `admin-ai-recipes` → the same
// `runRecipe` executor the customer path uses, so the preview is truthful.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Play, Plus, Upload, X } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { uploadAiReferenceImage } from "@/lib/ai-reference-upload";
import { saveRecipe, testRecipe } from "@/lib/ai-recipes-api";
import {
  canFinishWithCutout,
  hasCutoutFinish,
  MODEL_CATALOG,
  promptTokens,
  pruneCustomerOptions,
  setCutoutFinish,
  STYLE_PALETTE_CHOICES,
  validateRecipeOptions,
  type AiRecipe,
  type CustomerOption,
  type ModelId,
  type RecipeParamKey,
  type RecipeParams,
} from "@/lib/ai-recipe";

type TFn = (key: string, options?: Record<string, unknown>) => string;

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

const ASPECT_CHOICES: Array<{ value: string; labelKey: string }> = [
  { value: "match_layer", labelKey: "aspectMatchLayer" },
  { value: "match_customer", labelKey: "aspectMatchCustomer" },
  { value: "match_reference", labelKey: "aspectMatchReference" },
  { value: "1:1", labelKey: "aspectSquare" },
  { value: "4:5", labelKey: "aspectPortrait45" },
  { value: "3:4", labelKey: "aspectPortrait34" },
  { value: "2:3", labelKey: "aspectPortrait23" },
  { value: "3:2", labelKey: "aspectLandscape32" },
  { value: "16:9", labelKey: "aspectLandscape169" },
];

function blankDraft(): RecipeDraft {
  return { name: "", model: "ai-edit", prompt: "", params: {} };
}

function toDraft(r: AiRecipe, t: TFn): RecipeDraft {
  // A built-in keeps its id so the caller knows the origin; `save` clones it.
  return {
    id: r.id,
    name: r.builtIn ? t("admin.recipeEditor.copySuffix", { name: r.name }) : r.name,
    description: r.description,
    model: r.model,
    prompt: r.prompt ?? "",
    params: { ...(r.params ?? {}) },
    customerOptions: r.customerOptions,
    steps: r.steps,
  };
}

/** Editor for one prompt token's customer-facing choices. The token is what the
 *  prompt says; the choices are what the customer will see in the storefront. */
function CustomerOptionEditor({
  token,
  option,
  onChange,
}: {
  token: string;
  option: CustomerOption | undefined;
  onChange: (next: CustomerOption) => void;
}) {
  const { t } = useTranslation();
  const current: CustomerOption = option ?? {
    id: token,
    label: t("admin.recipeEditor.chooseToken", { token }),
    injectAs: token,
    choices: [],
  };

  const setChoice = (i: number, patch: Partial<CustomerOption["choices"][number]>) =>
    onChange({
      ...current,
      choices: current.choices.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    });

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <code className="text-[11px] px-1.5 py-0.5 rounded bg-muted">{`{${token}}`}</code>
        {token === "style" && current.choices.length === 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...current, choices: [...STYLE_PALETTE_CHOICES] })}
          >
            {t("admin.recipeEditor.fillFromStyles")}
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t("admin.recipeEditor.whatCustomerAsked")}</Label>
        <Input
          value={current.label}
          onChange={(e) => onChange({ ...current, label: e.target.value })}
          placeholder={t("admin.recipeEditor.chooseStyle")}
        />
      </div>

      {current.choices.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            {t("admin.recipeEditor.choicesHint")}
          </Label>
          {current.choices.map((c, i) => (
            <div key={i} className="flex items-start gap-2">
              <Input
                className="w-32 shrink-0"
                value={c.label}
                onChange={(e) => setChoice(i, { label: e.target.value })}
                placeholder={t("admin.recipeEditor.choiceLabelPlaceholder")}
              />
              <Input
                value={c.value}
                onChange={(e) => setChoice(i, { value: e.target.value })}
                placeholder={t("admin.recipeEditor.choiceValuePlaceholder")}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label={t("admin.recipeEditor.removeChoice", {
                  label: c.label || t("admin.recipeEditor.choiceFallback"),
                })}
                onClick={() =>
                  onChange({ ...current, choices: current.choices.filter((_, j) => j !== i) })
                }
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() =>
          onChange({
            ...current,
            choices: [
              ...current.choices,
              { id: `choice-${current.choices.length + 1}`, label: "", value: "" },
            ],
          })
        }
      >
        <Plus className="h-4 w-4" /> {t("admin.recipeEditor.addChoice")}
      </Button>
    </div>
  );
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
  const { t } = useTranslation();
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
              aria-label={t("admin.recipeEditor.removeImage", { label })}
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
  const { t } = useTranslation();
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
    setDraft(initial ? toDraft(initial, t) : blankDraft());
    setCustomerUrl(undefined);
    setReferenceUrls({});
    setOptionValues({});
    setTestResult(null);
    setTestError(null);
  }, [open, initial, t]);

  const spec = MODEL_CATALOG[draft.model];
  // A prompt-less model ignores the prompt, so its tokens are not real slots.
  // The draft keeps them, so switching back restores the merchant's work.
  const tokens = useMemo(
    () => (spec.usesPrompt ? promptTokens(draft.prompt) : []),
    [spec.usesPrompt, draft.prompt],
  );

  function setModel(model: ModelId) {
    // Drop params the new model doesn't have, so we never send it a stray knob.
    const allowed = new Set(MODEL_CATALOG[model].params);
    const params = Object.fromEntries(
      Object.entries(draft.params).filter(([k]) => allowed.has(k as RecipeParamKey)),
    ) as RecipeParams;
    // Re-apply the finish against the NEW model: switching to `cutout` must not
    // leave a cutout step behind, or the recipe would cut out twice.
    const keepFinish = hasCutoutFinish(draft) && canFinishWithCutout(model);
    setDraft(setCutoutFinish({ ...draft, model, params }, keepFinish));
    setTestResult(null);
  }

  function setFinish(enabled: boolean) {
    setDraft((d) => setCutoutFinish(d, enabled));
    setTestResult(null);
  }

  function setOption(next: CustomerOption) {
    setDraft((d) => {
      const rest = (d.customerOptions ?? []).filter((o) => o.injectAs !== next.injectAs);
      return { ...d, customerOptions: [...rest, next] };
    });
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
      toast.error(e instanceof Error ? e.message : t("admin.recipeEditor.uploadFailed"));
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
      setTestError(e instanceof Error ? e.message : t("admin.recipeEditor.testRunFailed"));
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!draft.name.trim()) {
      toast.error(t("admin.recipeEditor.nameRequired"));
      return;
    }
    if (optionError) {
      toast.error(optionError);
      return;
    }
    setSaving(true);
    try {
      // Don't persist a prompt the chosen model would never read.
      const base = spec.usesPrompt
        ? draft
        : { ...draft, prompt: undefined, customerOptions: undefined };
      const clean = pruneCustomerOptions({ ...base, name: draft.name.trim() });
      await saveRecipe(clean as Partial<AiRecipe>);
      toast.success(t("admin.recipeEditor.recipeSaved"));
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("admin.recipeEditor.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const needsCustomer = spec.customerImages.min > 0;
  const missingCustomer = needsCustomer && !customerUrl;
  const refCount = Object.values(referenceUrls).filter(Boolean).length;
  const missingReference = refCount < spec.referenceImages.min;
  const canTest = !testing && !missingCustomer && !missingReference;

  const finishOn = hasCutoutFinish(draft);
  const optionError = useMemo(
    () => (spec.usesPrompt ? validateRecipeOptions(draft) : null),
    [spec.usesPrompt, draft],
  );
  const optionFor = (token: string) =>
    (draft.customerOptions ?? []).find((o) => o.injectAs === token);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{draft.id && !draft.id.startsWith("builtin-") ? t("admin.recipeEditor.editRecipe") : t("admin.recipeEditor.newRecipe")}</DialogTitle>
          <DialogDescription>
            {t("admin.recipeEditor.dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="recipe-name">{t("admin.recipeEditor.name")}</Label>
            <Input
              id="recipe-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={t("admin.recipeEditor.namePlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="recipe-model">{t("admin.recipeEditor.model")}</Label>
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
              <Label htmlFor="recipe-prompt">{t("admin.recipeEditor.prompt")}</Label>
              <Textarea
                id="recipe-prompt"
                rows={5}
                value={draft.prompt ?? ""}
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                placeholder={t("admin.recipeEditor.promptPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">
                {t("admin.recipeEditor.wrapInBraces")}{" "}
                <code className="text-[11px]">{"{style}"}</code>.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
              {t("admin.recipeEditor.modelNoPrompt", { label: spec.label })}
            </p>
          )}

          {spec.usesPrompt && tokens.length > 0 && (
            <div className="space-y-2">
              <div>
                <Label>{t("admin.recipeEditor.customerChoices")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("admin.recipeEditor.customerChoicesHint")}
                </p>
              </div>
              {tokens.map((tok) => (
                <CustomerOptionEditor
                  key={tok}
                  token={tok}
                  option={optionFor(tok)}
                  onChange={setOption}
                />
              ))}
            </div>
          )}

          {canFinishWithCutout(draft.model) ? (
            <label className="flex items-start gap-3 rounded-md border px-3 py-3 cursor-pointer">
              <Checkbox
                checked={finishOn}
                onCheckedChange={(v) => setFinish(v === true)}
                className="mt-0.5"
              />
              <span className="space-y-1">
                <span className="block text-sm font-medium">{t("admin.recipeEditor.removeBackground")}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("admin.recipeEditor.runsLabel")}{" "}<strong>{spec.label}</strong>{" "}{t("admin.recipeEditor.thenCutsOut")}
                </span>
              </span>
            </label>
          ) : (
            <p className="text-xs text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
              {t("admin.recipeEditor.styleSubjectPrefix")}{" "}<strong>{t("admin.recipeEditor.artStyle")}</strong>{" "}{t("admin.recipeEditor.styleSubjectSuffix")}
            </p>
          )}

          <Collapsible>
            <CollapsibleTrigger className="text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
              {t("admin.recipeEditor.advanced")}
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-4">
              {spec.params.includes("aspectRatio") && (
                <div className="space-y-2">
                  <Label>{t("admin.recipeEditor.outputShape")}</Label>
                  <Select
                    value={draft.params.aspectRatio ?? "match_layer"}
                    onValueChange={(v) => setParam("aspectRatio", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASPECT_CHOICES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {t(`admin.recipeEditor.${c.labelKey}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {spec.params.includes("outputFormat") && (
                <div className="space-y-2">
                  <Label>{t("admin.recipeEditor.fileFormat")}</Label>
                  <Select
                    value={draft.params.outputFormat ?? "png"}
                    onValueChange={(v) => setParam("outputFormat", v as "png" | "jpg")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="png">{t("admin.recipeEditor.formatPng")}</SelectItem>
                      <SelectItem value="jpg">{t("admin.recipeEditor.formatJpg")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {spec.params.includes("backdropColor") && (
                <div className="space-y-2">
                  <Label htmlFor="backdrop">{t("admin.recipeEditor.backdropColour")}</Label>
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
                <Label htmlFor="recipe-desc">{t("admin.recipeEditor.description")}</Label>
                <Input
                  id="recipe-desc"
                  value={draft.description ?? ""}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder={t("admin.recipeEditor.descriptionPlaceholder")}
                />
              </div>

              {(draft.steps?.filter((s) => s.model !== "cutout").length ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("admin.recipeEditor.extraStepsNote")}
                </p>
              )}
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          {/* ── Test panel ─────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">{t("admin.recipeEditor.test")}</h3>
              <p className="text-xs text-muted-foreground">
                {t("admin.recipeEditor.testHint")}
              </p>
            </div>

            <div className="flex flex-wrap gap-4">
              {needsCustomer && (
                <ImageSlot
                  label={t("admin.recipeEditor.customerPhoto")}
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
                      ? i < spec.referenceImages.min
                        ? t("admin.recipeEditor.referenceN", { n: i + 1 })
                        : t("admin.recipeEditor.referenceNOptional", { n: i + 1 })
                      : t("admin.recipeEditor.referenceImage")
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
                {tokens.map((tok) => {
                  const choices = optionFor(tok)?.choices ?? [];
                  return (
                    <div key={tok} className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("admin.recipeEditor.testValueFor")}{" "}<code className="text-[11px]">{`{${tok}}`}</code>
                      </Label>
                      {/* Once the token has choices, test what the customer can
                          actually pick — free text would test a path nobody runs. */}
                      {choices.length > 0 ? (
                        <Select
                          value={optionValues[tok] || undefined}
                          onValueChange={(v) => setOptionValues((o) => ({ ...o, [tok]: v }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t("admin.recipeEditor.pickChoiceToTest")} />
                          </SelectTrigger>
                          <SelectContent>
                            {choices
                              .filter((c) => c.value.trim().length > 0)
                              .map((c, i) => (
                                <SelectItem key={i} value={c.value}>
                                  {c.label || c.value}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={optionValues[tok] ?? ""}
                          onChange={(e) =>
                            setOptionValues((o) => ({ ...o, [tok]: e.target.value }))
                          }
                          placeholder={t("admin.recipeEditor.testValuePlaceholder")}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="button" variant="secondary" onClick={handleTest} disabled={!canTest}>
                {testing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> {t("admin.recipeEditor.running")}
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" /> {t("admin.recipeEditor.runTest")}
                  </>
                )}
              </Button>
              {(missingCustomer || missingReference) && (
                <span className="text-xs text-muted-foreground">
                  {missingCustomer
                    ? t("admin.recipeEditor.uploadCustomerPhoto")
                    : t("admin.recipeEditor.modelNeedsReferences", { count: spec.referenceImages.min })}
                </span>
              )}
              {testResult && (
                <span className="text-xs text-muted-foreground">
                  {t("admin.recipeEditor.took", { seconds: (testResult.ms / 1000).toFixed(1) })}
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
                alt={t("admin.recipeEditor.testResult")}
                className="max-h-72 rounded-md border object-contain"
              />
            )}
          </div>
        </div>

        <DialogFooter className="items-center">
          {optionError && (
            <span className="mr-auto text-xs text-destructive">{optionError}</span>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("admin.recipeEditor.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving || !draft.name.trim() || !!optionError}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("admin.recipeEditor.saveRecipe")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
