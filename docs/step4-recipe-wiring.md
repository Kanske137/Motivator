# Step 4 — Wire layers to recipes, unify the photo layer, retire the old paths

Status doc for the AI-recipe cutover. Read this at the start of a session that
touches the AI flow. Sweeps 1–3 (guards, style bridges, the Nano prompt as
starter recipes) are **done and verified**; this covers what remains.

## The goal in one sentence

A media layer points at a recipe (or none), carries its own references and a
motif line, and the customer editor sends **the recipe** — not twelve behaviour
flags — so the three legacy AI paths and the `photo`/`aiPhoto` split can be
deleted.

## Why this shape

- **Recipe = the transformation** (shared across templates, lives in the shop
  library). **Binding = the content** (this layer, these references, this
  motif — per template). This is the split the schema already names in
  `ai-recipe.ts`: `AiRecipe` (the how) vs `MediaLayerAi` (the what).
- **One media layer, not two.** A `photo` layer is a shaped upload slot; an
  `aiPhoto` layer is the same slot plus a transformation. "Transformation" is
  exactly what a recipe is, so the two collapse into one layer whose recipe is
  either set or empty. No recipe = plain photo. This also dissolves the
  simple/advanced tier: the "simple style swap" is just a recipe with no cutout,
  so `photoLayerStyle` and `AiStyleSection` stop existing.
- **The motif line is load-bearing and per-template.** Measured on
  `diag6/stress/house1.jpg`: without "The subject is a single residential
  house…", nano keeps the whole meadow. It is NOT a customer choice; it
  describes what this template's customer uploads. It lives on the binding.

## What each moving part is for

| Part | Today | After |
|---|---|---|
| Layer type | `photo` and `aiPhoto` are separate discriminants | one media layer; `recipeId` set-or-empty is the switch |
| `mediaLayerAi` | defined in schema, unused | the binding: `recipeId`, `references`, `motif`, option defaults |
| Motif | `fluxStylePrompt` on layer defaults — no admin UI, gated by `FLUX_REMOVEBG_ENABLED`, misleadingly named | `motif` on the binding, a real admin field, injected as `{motif}` |
| Customer editor call | 12 flags (`subjectKind`, `simpleStyleMode`, `styleInstruction`, `backdropColor`, `fillFrame`, …) | recipe + references + motif + customer option values |
| Style presets | `aiStylePresets` on the template AND recipe `customerOptions` | recipe `customerOptions` only |
| Edge function | `replicate-face-swap` (1261 lines), 3 internal paths | thin `runRecipe` caller |

## Two failure modes to hold in mind the whole way

1. **The cache key.** `face-swap-cache` keys on `subjectKind` among other
   things. When that field dies the key must be rebuilt from recipe id + motif +
   option values + image, or a customer gets a stale image for a new recipe —
   the kind of bug that only surfaces as a wrong print.
2. **Empty motif regresses.** The one aiPhoto layer in the DB (`aitest`) has
   `fluxStylePrompt = null`. The day layers point at recipes, every non-obvious
   subject needs its motif filled or it renders worse than today.

## Reserved prompt tokens

`{style}` etc. are customer choices → need `customerOptions` (save is blocked
without them, per sweep 2's `validateRecipeOptions`). `{motif}` is NOT a choice —
it comes from the binding. `validateRecipeOptions` must treat `{motif}` as
reserved and never demand choices for it. The executor injects it like an option
value.

## The four steps — each verifiable before the next

### 1. Schema + executor groundwork (additive, nothing breaks) — DONE
- **1a (done, commit ad6bbaf):** `motif` on `mediaLayerAiSchema`; executor injects
  `{motif}` (reserved token — `validateRecipeOptions`/`customerTokens` skip it).
  Verified live on house1: motif set → subject isolated; empty → collapses clean.
- **1b (done):** `photoLayerSchema.defaults.ai` = optional `mediaLayerAiSchema`.
  **This IS the merge, done additively:** a photo layer carrying a recipe binding
  is the unified media layer; absent binding = plain photo. No new discriminant.

  **SEQUENCING CORRECTION.** The original plan renamed the `photo`/`aiPhoto`
  discriminant here and mapped it in `migrateLayer`. That is NOT additive — the
  discriminant is read in ~8 files, so renaming it before those consumers are
  rewritten just makes a big broken diff. So the actual merge is: photo layers
  gain an optional `.ai` binding now; the redundant `aiPhoto` type + its legacy
  `migrateLayer` mapping are removed in step 3/4, alongside the consumer rewrite
  that has to touch those files anyway.

### 2. Admin: recipe picker + motif field on the media layer
- One inspector for the unified layer. Recipe picker on top; **"No recipe
  (plain photo)"** is the first option — this is the user's requested default.
- Motif field, prefilled when the chosen starter implies its subject
  (`builtin-pet` → "a pet"), editable.
- Old aiPhoto knobs (`subjectKind`, `backdropColor`, `fillFrame`, …) leave the
  inspector — they are now prompt text in the recipe.
- **Verify:** drive the admin on `vite --port 5199`, build a template that points
  a layer at a recipe. Customer flow still untouched.

### 3. Customer editor: send the recipe, not the flags (the risky step)
- `PhotoUploadSection` + `AiPhotoSection` become one component that branches on
  *recipe present?*, not on layer type.
- Customer style picker reads the recipe's `customerOptions`, not
  `aiStylePresets`.
- Rebuild the cache key (failure mode #1).
- Fold `replicate-style` in here — it shares `aiStylePresets`, so leaving styles
  in two places mid-cutover would be worse.
- **Verify:** run a real template end-to-end, compare against the diag6 goldens,
  confirm the cache doesn't reuse a wrong image.

### 4. Delete the dead paths (only once nothing calls them)
- `runRemoveBackground`, `callFluxRemoveBg`, `callKontextSimpleStyle`,
  `pollReplicate`, the `subjectKind` routing, `simpleStyleMode`,
  `FLUX_REMOVEBG_ENABLED`, `photoLayerStyle`, `AiStyleSection`, `aiStylePresets`
  as separate storage, `replicate-style` as a separate path.
- **Verify:** grep proves no caller remains; full suite + a real generation.

Steps 3 and 4 stay separate on purpose: deleting while rewiring leaves nothing
to diff against when something looks wrong.

## Explicitly out of scope
- **`multi-face-swap`** — isolated, works, its own 248-line fn and its own UI.
  Unify it after the rest lands and is verified. Unifying two layer types is
  right; three in one sweep is not.
- **Upscaling / print resolution** — a Phase 3 requirement, not this step. See
  memory `motiv-print-file-resolution`.
- **Oil-on-cutout** — settled: painterly styles use `builtin-nano-backdrop`
  (ai-edit paints its own backdrop), not the art-style→cutout chain.
