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
