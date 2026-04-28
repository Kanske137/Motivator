## Problem
Den nuvarande prompten för "ta bort bakgrund" säger att fade ska ske mot kanterna, men i praktiken får icke-akvarell-stilar ofta skarpa avgränsningar på en eller flera sidor (typiskt botten/axlar eller en sida av huvudet) medan andra sidor fadar mjukt. Modellen tolkar instruktionen asymmetriskt.

## Lösning
Förstärk `runRemoveBackground`-prompten i `supabase/functions/replicate-face-swap/index.ts` så att fade-kravet uttryckligen gäller alla fyra kanter symmetriskt — för både akvarell- och övriga stilar.

### Konkreta promptändringar

**Steg 4 (CRITICAL EDGE TREATMENT)** — båda varianterna:
- Räkna upp alla fyra sidor explicit: TOP (huvud/hår), BOTTOM (haka/axlar/torso/ben), LEFT (kind/öra/axel/arm), RIGHT (kind/öra/axel/arm).
- Lägg till mening: "The fade must be visibly symmetrical: top, bottom, left and right edges of the subject must each dissolve with the same softness — do not leave one side (e.g. the bottom or one shoulder) sharp while another fades."
- Betona "on EVERY side" där det tidigare bara stod "outward".

**Steg 5 (SOFT FADE-OUT TO FRAME)** — båda varianterna:
- Ändra "mandatory" → "mandatory on ALL FOUR sides equally (top, bottom, left AND right — no side may be skipped, no side may remain sharp)".
- Lägg till komposition: "The subject itself must be composed and sized so its top, bottom, left and right extremes all sit comfortably inside this safe area, leaving visible whitespace on EACH of the four sides — never crop or extend the subject to any edge."
- För icke-akvarell: lägg till "do not leave (for example) the bottom of the torso or one shoulder cleanly cut while the top of the head softly fades".

## Filer
- `supabase/functions/replicate-face-swap/index.ts` — endast `edgeInstruction` och `fadeInstruction` strängarna inom `runRemoveBackground`.

Inga ändringar i UI, schema eller frontend.