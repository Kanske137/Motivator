## Problem

Två separata problem efter den senaste contain-fixen:

### Problem 1 — Motivet blir för litet i lagret

`object-contain` skalar bilden så att hela bilden får plats i lagret. Men prompten (`fadeInstruction`) säger redan åt Nano Banana att lämna 15-20% pure-white "safe area" runt motivet inuti den genererade bilden. När bilden sen renderas med `contain` får vi:

- Modellens egna 15-20% vita padding runt motivet
- Ev. extra padding pga aspect-mismatch mellan output och lager

→ Motivet hamnar på ~50-60% av lagrets yta, känns litet och "fördränkt" i vitt, även om kunden drar storleken till max tillåtna.

### Problem 2 — Lagret kan inte flyttas / fyller hela editorn

När AI-lagret är stort (eller satt till nära 100% i mallen) hamnar move-handle (`-top-3 -left-3`) utanför den synliga ramen (negativ offset från lagrets övre vänstra hörn → utanför poster-frame). Användaren ser då ingen handtagsknapp och kan inte dra lagret. Den vita PNG:n från modellen täcker visuellt hela editorn så det går inte heller att hitta något annat att klicka på.

## Lösning

### Fix 1 — Ta bort den interna paddingen i AI-bilden

I `supabase/functions/replicate-face-swap/index.ts`, `runRemoveBackground`:

- **`fadeInstruction`** (båda varianterna): ta bort kravet på "outermost ~15-20% must be pure white" / "subject must sit inside this safe area". Behåll kravet på MJUK FEATHER på alla fyra kanter (soft fade, no sharp cut-out), men låt motivet faktiskt fylla bildytan så långt det går — bara den allra yttersta 1-3 pixelraden ska vara ren vit för en sömlös övergång till sidans bakgrund.
- **`aspectInstruction`**: behåll kravet att motivet ska få plats utan att skäras, men säg uttryckligen att modellen ska skala upp motivet så stort den kan inom output-frame medan den behåller liten feather-marginal — INTE lämna stora vita ytor om motivet inte har den exakta aspect-ration.
- **`edgeInstruction`**: behåll mjuk symmetrisk fade på alla fyra sidor (det är fortfarande viktigt) men gör det tydligt att fade ska vara en *kant-effekt på motivet*, inte en stor vit ram.

Resultatet: bilden från Nano Banana är ~95% motiv + 5% mjuk feather, och `contain` i lagret ger ett motiv som faktiskt fyller lagret istället för att flyta i mitten.

### Fix 2 — Move-handle som alltid är synlig och nåbar

I `src/components/editor/MapPreview.tsx` (raderna 282-292, `moveHandle`):

- Ändra position från `-top-3 -left-3` (utanför lagret) till `top-2 left-2` (inuti lagret, övre vänstra hörnet, alltid synligt oavsett lagrets storlek).
- Behåll storlek/styling så det syns tydligt mot AI-bilden — lägg till lite extra opacity/skugga om det behövs för kontrast mot vitt motiv.
- Detta gäller alla movable layers (map, photo, aiPhoto, text, image), så fördelen sträcker sig längre än bara AI-fixen.

Alternativ-flex: överväg att även justera resize-handles om de också hamnar utanför, men move-handle är prio.

## Filer som ändras

- `supabase/functions/replicate-face-swap/index.ts` — slimma `fadeInstruction` + `aspectInstruction` så motivet fyller bildytan
- `src/components/editor/MapPreview.tsx` — flytta move-handle till `top-2 left-2` (inuti lagret)

Inga schema- eller andra UI-ändringar.
