import { describe, expect, it } from "vitest";
import { legacyAiPhotoBinding } from "./template-migrate";

describe("legacyAiPhotoBinding — aiPhoto defaults → recipe binding", () => {
  it("maps human/pet subjectKinds to their built-ins", () => {
    expect(legacyAiPhotoBinding({ subjectKind: "human" }).recipeId).toBe("builtin-face-swap");
    expect(legacyAiPhotoBinding({ subjectKind: "pet" }).recipeId).toBe("builtin-pet");
  });

  it("normalizes legacy cat/dog/other subjectKinds to pet", () => {
    for (const sk of ["cat", "dog", "other"]) {
      expect(legacyAiPhotoBinding({ subjectKind: sk }).recipeId).toBe("builtin-pet");
    }
  });

  it("maps removeBackground to the watercolor default, and simpleStyleMode to the chain", () => {
    expect(legacyAiPhotoBinding({ subjectKind: "removeBackground" }).recipeId).toBe("builtin-nano-watercolor");
    // simpleStyleMode has no runtime style at migration, so it maps straight to
    // the art-style→cutout recipe rather than falling back to a Nano path.
    expect(
      legacyAiPhotoBinding({ subjectKind: "removeBackground", simpleStyleMode: true }).recipeId,
    ).toBe("builtin-style-cutout");
  });

  it("defaults an unknown/absent subjectKind to human", () => {
    expect(legacyAiPhotoBinding({}).recipeId).toBe("builtin-face-swap");
  });

  it("carries references with focal + orientation, preferring referenceImages", () => {
    const b = legacyAiPhotoBinding({
      subjectKind: "human",
      referenceImages: [
        { id: "a", url: "https://x/a.png", label: "A", orientation: "portrait", focalX: 5, focalY: -3 },
      ],
    });
    expect(b.references).toEqual([
      { id: "a", url: "https://x/a.png", label: "A", orientation: "portrait", focalX: 5, focalY: -3 },
    ]);
  });

  it("falls back to the single legacy referenceImageUrl", () => {
    const b = legacyAiPhotoBinding({ subjectKind: "human", referenceImageUrl: "https://x/legacy.png" });
    expect(b.references).toHaveLength(1);
    expect(b.references[0].url).toBe("https://x/legacy.png");
  });

  it("carries motif from fluxStylePrompt, omitting blank ones", () => {
    expect(legacyAiPhotoBinding({ subjectKind: "removeBackground", fluxStylePrompt: "a house" }).motif).toBe("a house");
    expect(legacyAiPhotoBinding({ subjectKind: "removeBackground", fluxStylePrompt: "  " }).motif).toBeUndefined();
    expect(legacyAiPhotoBinding({ subjectKind: "removeBackground" }).motif).toBeUndefined();
  });
});
