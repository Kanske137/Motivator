// Default face-swap prompts per subject kind. Used by the admin inspector
// when admin changes the subject dropdown — we auto-fill the prompt textarea
// so they have a sensible starting point, but they can edit freely.
//
// IMPORTANT: The prompt is sent to a multi-image Kontext model where:
//   input_image_1 = admin's reference scene (costume/pose/background to keep)
//   input_image_2 = the customer's uploaded photo (face to lift FROM)
// Always reference the inputs by name so the model swaps the correct
// direction. Without this it tends to put admin's face onto the customer's
// scene — the opposite of what we want.
import type { AiPhotoSubjectKind } from "./template-schema";

export const DEFAULT_AI_PHOTO_PROMPTS: Record<AiPhotoSubjectKind, string> = {
  human:
    "Take the person's face from input_image_2 and place it onto the person in input_image_1. Keep input_image_1's hair, outfit, accessories, lighting, pose and background exactly. The final person must have the face from input_image_2, not from input_image_1.",
  cat:
    "Take the cat's face from input_image_2 and place it onto the cat in input_image_1. Keep input_image_1's body, fur, costume, pose and background exactly. The final cat must have the face from input_image_2, not from input_image_1.",
  dog:
    "Take the dog's face from input_image_2 and place it onto the dog in input_image_1. Keep input_image_1's body, fur, costume, pose and background exactly. The final dog must have the face from input_image_2, not from input_image_1.",
  other:
    "Take the subject's face from input_image_2 and place it onto the subject in input_image_1. Keep input_image_1's body, outfit, lighting, pose and background exactly. The final subject must have the face from input_image_2, not from input_image_1.",
};

export function defaultPromptFor(kind: AiPhotoSubjectKind): string {
  return DEFAULT_AI_PHOTO_PROMPTS[kind];
}
