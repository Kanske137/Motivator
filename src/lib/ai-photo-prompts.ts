// Default face-swap prompts per subject kind. Used by the admin inspector
// when admin changes the subject dropdown — we auto-fill the prompt textarea
// so they have a sensible starting point, but they can edit freely.
//
// IMPORTANT: The prompt is sent to a multi-image Kontext model where:
//   input_image_1 = admin's reference scene (costume/pose/background to keep)
//   input_image_2 = the customer's uploaded photo (face to lift FROM)
// Always reference the inputs by name so the model swaps the correct
// direction.
//
// removeBackground: no reference image. The prompt here is admin's optional
// styling guidance for the dot/splatter effect (e.g. preferred color tones).
// The bulk of the instruction is built server-side in the edge function so
// the background-removal + dot-ring effect is enforced consistently.
import type { AiPhotoSubjectKind } from "./template-schema";

export const DEFAULT_AI_PHOTO_PROMPTS: Record<AiPhotoSubjectKind, string> = {
  human:
    "Take the person's face and head from image #2 and place it onto the person in image #1. Keep image #1's hair style, outfit, accessories, lighting, pose, background, art style and composition exactly. Preserve the customer's facial identity from image #2: facial features, eye color, skin tone, age and natural expression. Blend skin tones and lighting so the swapped face looks like it belongs in image #1.",
  pet:
    "Take the pet's face from input_image_2 and place it onto the pet in input_image_1. Keep input_image_1's body, fur, costume, pose and background exactly. The final pet must have the unique markings, fur color/pattern, breed traits and identity from input_image_2 — not from input_image_1.",
  removeBackground:
    "Default: warm earthy watercolor dots (amber, rust, soft brown, hint of pink) around the subject, with soft feathered edges where the subject's outer silhouette dissolves organically into the white background (no hard cut-out). Edit this text to change the dot color tones, density, or style. The subject's appearance is controlled by the AI style preset the customer picks (or left untouched if no style is picked). The background is always removed and replaced with a clean white backdrop.",
};

export function defaultPromptFor(kind: AiPhotoSubjectKind): string {
  return DEFAULT_AI_PHOTO_PROMPTS[kind];
}

// ---------- Multi-face swap default prompt ----------
//
// Used by the OPTIONAL multi-face mode (`aiPhoto.defaults.multiFaceSwap`).
// The placeholder `{{SLOTS}}` is replaced server-side with one line per slot
// in the form:
//   - The person at the {position} position becomes the face in image {N}
//
// The admin can freely edit this prompt in the MultiFaceInspector; only the
// `{{SLOTS}}` token is mechanically expanded by the edge function.
export const DEFAULT_MULTI_FACE_PROMPT = `You are given several images. Image 1 is the reference artwork to preserve exactly: composition, painting/photo style, clothing, accessories, pose, background, lighting and framing. The remaining images are customer face photos.

Re-render image 1 as the same artwork, but replace each depicted person with the matching customer face according to these mappings:
{{SLOTS}}

Preserve each customer's facial identity and likeness faithfully (features, eye color, skin tone, age, natural expression). Keep the depicted people clearly distinct — never blend, mirror or swap them. Keep EVERYTHING ELSE in the artwork unchanged. Render each likeness naturally within the artwork's style. Return ONE single edited image with the same aspect ratio as image 1 — not a collage, not side-by-side, not a comparison.`;

