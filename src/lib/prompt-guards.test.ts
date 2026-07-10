import { describe, expect, it } from "vitest";
import {
  buildArtStylePrompt,
  KONTEXT_CUTOUT_ISOLATION,
  KONTEXT_SUBJECT_GUARD,
} from "../../supabase/functions/_shared/prompt-guards";

const STYLE = "make this in watercolor styling";

describe("buildArtStylePrompt", () => {
  it("sends the merchant prompt raw when no cutout follows", () => {
    // Parity with the legacy callKontextSimpleStyle route, which ships today.
    expect(buildArtStylePrompt(STYLE, { isolateForCutout: false })).toBe(STYLE);
  });

  it("adds the orientation guard and grey isolation when a cutout follows", () => {
    const p = buildArtStylePrompt(STYLE, { isolateForCutout: true });
    expect(p).toContain(KONTEXT_SUBJECT_GUARD);
    expect(p).toContain(KONTEXT_CUTOUT_ISOLATION);
    expect(p).toContain("#7f7f7f");
  });

  it("puts the merchant's style words LAST so they are not drowned out", () => {
    // Kontext follows the first concrete instruction it sees.
    const p = buildArtStylePrompt(STYLE, { isolateForCutout: true });
    expect(p.indexOf(STYLE)).toBeGreaterThan(p.indexOf(KONTEXT_CUTOUT_ISOLATION));
    expect(p.trimEnd().endsWith(STYLE)).toBe(true);
  });

  it("still isolates when the recipe carries no prompt", () => {
    const p = buildArtStylePrompt(undefined, { isolateForCutout: true });
    expect(p).toContain(KONTEXT_CUTOUT_ISOLATION);
    expect(p).not.toContain("SURFACE TREATMENT only");
  });

  it("never emits the grey backdrop on the un-chained path", () => {
    // It would reach the customer: nothing strips it.
    expect(buildArtStylePrompt(STYLE, { isolateForCutout: false })).not.toContain("#7f7f7f");
  });
});
