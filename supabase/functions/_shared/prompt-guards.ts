// Model-quirk guards for flux-kontext-pro.
//
// These are NOT merchant taste — they are workarounds for how the model behaves,
// and they are outcome-neutral: the customer never sees their effect, only their
// absence. That is why they live in the adapter instead of the merchant's prompt.
//
// Wording is lifted VERBATIM from the validated `fluxBase` in
// `replicate-face-swap/index.ts` (route 3b, the flux→bg-remover pipeline proven
// against the fixtures in `diag6/`). Do not paraphrase it — the phrasing is what
// was tested.
//
// Pure module: no imports, no Deno globals, so vitest can exercise it directly.

/** Kontext likes to mirror and re-angle subjects. It must not. */
export const KONTEXT_SUBJECT_GUARD =
  "The subject is the main object in the input photo. Preserve its structure, " +
  "proportions and overall composition so it stays recognizable as the same subject. " +
  "Keep the subject at the EXACT same orientation, facing direction, angle and " +
  "position as in the input photo. NEVER mirror, flip, rotate or re-angle it. " +
  "Do not output a mirror image. If the subject faces left in the input it must " +
  "face left in the output; if it faces right it must face right.";

/** Only when a cutout follows. The mid-grey is validated against
 *  `851-labs/background-remover`, which then strips it and returns RGBA — so this
 *  backdrop never reaches the customer. Without it Kontext invents a landscape
 *  behind the subject (see `diag6/stress/house1.jpg`). */
export const KONTEXT_CUTOUT_ISOLATION =
  "Completely isolate the subject on a perfectly flat mid-grey (#7f7f7f) studio backdrop. " +
  "ABSOLUTELY NO landscape, NO sky, NO trees, NO foliage, NO bushes, NO grass, NO ground, " +
  "NO shadow, NO surroundings, NO people, NO vehicles, NO text, NO watermark. " +
  "The area outside the subject silhouette must be a single solid flat #7f7f7f, nothing else.";

/** Kontext follows the first concrete instruction it sees, so the merchant's style
 *  words must come LAST or the guards above drown them out. */
const STYLE_TAIL_HEADER =
  "Render the subject in the following art style. Apply it fully to the subject while " +
  "keeping its structure and identity recognizable. The style is a SURFACE TREATMENT " +
  "only — it must not change the subject's orientation, facing direction, position or scale:";

// KNOWN LIMITATION — do not "fix" this with more prompt text without measuring.
// A style whose medium implies a painted SURFACE (oil: impasto, canvas texture)
// makes Kontext paint the #7f7f7f backdrop too, so it is no longer flat and the
// bg-remover leaves it in. The legacy pipeline had the identical failure — see
// `diag6/stress/house1_oil_cutout.png`, named `_cutout` with its background
// still present. Porting the Nano route's "do NOT extend the style into the
// background" clause here was tried on 2026-07-10 and did NOT help: Kontext
// paints the canvas regardless. Watercolor chains cleanly; oil does not.

/** Compose what flux-kontext-pro actually receives.
 *
 *  Without a cutout following, the merchant's prompt is sent RAW. That is exact
 *  parity with the legacy `callKontextSimpleStyle` route, which ships today and
 *  is known to work — guards there would be an unrequested behaviour change. */
export function buildArtStylePrompt(
  prompt: string | undefined,
  opts: { isolateForCutout: boolean },
): string {
  const merchant = prompt?.trim() ?? "";
  if (!opts.isolateForCutout) return merchant;
  return [
    `${KONTEXT_SUBJECT_GUARD} ${KONTEXT_CUTOUT_ISOLATION}`,
    merchant ? `${STYLE_TAIL_HEADER}\n${merchant}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
