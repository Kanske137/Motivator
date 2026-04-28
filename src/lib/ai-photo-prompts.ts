// Default face-swap prompts per subject kind. Used by the admin inspector
// when admin changes the subject dropdown — we auto-fill the prompt textarea
// so they have a sensible starting point, but they can edit freely.
import type { AiPhotoSubjectKind } from "./template-schema";

export const DEFAULT_AI_PHOTO_PROMPTS: Record<AiPhotoSubjectKind, string> = {
  human:
    "Replace only the face/head onto the reference subject. Preserve the reference outfit, hair contour, lighting, pose and background. Do not change clothing, accessories or scene.",
  cat:
    "Replace only the cat's face with the uploaded cat's face. Preserve breed coat colors only on the face area; keep the body, fur on the body, costume, pose and background unchanged.",
  dog:
    "Replace only the dog's face with the uploaded dog's face. Preserve breed coat colors only on the face area; keep the body, fur on the body, costume, pose and background unchanged.",
  other:
    "Replace only the subject's face with the uploaded face. Preserve everything else in the reference (body, outfit, lighting, pose and background).",
};

export function defaultPromptFor(kind: AiPhotoSubjectKind): string {
  return DEFAULT_AI_PHOTO_PROMPTS[kind];
}
