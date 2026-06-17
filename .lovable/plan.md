# Plan: Generalisera dolda prompt-rader i `runRemoveBackground`

## Mål
Få bakgrundsborttagning (akvarell, skiss, m.fl.) att fungera på **alla motivtyper** — människor, husdjur, fordon **och hus/byggnader** — utan att UI-redigerbara prompter eller skyddsregler (vit bakgrund, en bild ut, aspect ratio, feathered kant) påverkas.

## Vad ändras
Endast `supabase/functions/replicate-face-swap/index.ts`, funktionen `runRemoveBackground`. Inga UI-filer, inga andra edge-funktioner, inget i `multi-face-swap`, ingen Replicate human face-swap, inget i presetlistan/Stilguide-texter.

## Konkreta textbyten

| Var | Före | Efter |
|---|---|---|
| Rad 572 (isolate) | `Isolate the main subject (a person, pet or vehicle) and COMPLETELY REMOVE the original background.` | `Isolate the main subject in the photo and COMPLETELY REMOVE the original background.` |
| Rad 531 (edge, akvarell) | `…Keep the face, eyes and central features crisp.` | `…Keep the subject's key features and important details crisp and in focus.` |
| Rad 532 (edge, övriga stilar) | `…Keep the face, eyes and central features crisp.` | `…Keep the subject's key features and important details crisp and in focus.` |
| Rad 579 (identity) | `Keep the subject's identity, face, eyes, fur/skin and proportions exactly as in the input photo unless an artistic style is specified below.` | `Keep the subject's identity, shape, surfaces, colors and proportions exactly as in the input photo unless an artistic style is specified below.` |

## Vad som INTE rörs
- `backdropInstruction`, `ringInstruction` (akvarell-villkoret), `framingInstruction`, `aspectInstruction`, `preserveColorsLine` — fortsätter exakt som idag.
- Admin-prompten från UI (Layer-Inspector) injiceras precis som förut, fortfarande märkt "HIGH-PRIORITY artist guidance".
- Stilpresetens prompt (Akvarell/Skiss/Linjekonst …) injiceras oförändrad i `styleBlock`.
- `runReplicateFaceSwap` (människa) och `runAnimalSwap` (pet) — orörda.
- `multi-face-swap` edge-funktionen — orörd.
- `ai-photo-prompts.ts` (UI-defaults) — orörd.

## Varför detta löser husposter
Loggarna från senaste körningen visade `400 upstream_error` från `google/gemini-3.1-flash-image-preview` på akvarell + skiss för husfoto. Linjekonst gick igenom. Skillnaden låg i kombinationen *promptlängd + människo-/djurord på ett hus*. Genom att ta bort `person/pet/vehicle`, `face`, `eyes`, `fur/skin` får modellen inga motsägelser och nekar inte längre prompten — för människor/husdjur/fordon förlorar vi inget eftersom de orden ändå alltid pekade på "main subject" i praktiken.

## Verifiering efter ändring
1. Kolla att TypeScript-bygget går (görs automatiskt).
2. Be dig testa skarpt: ladda upp husfoto → välj Akvarell + Skiss → bekräfta att spinnern slutar med en bild och inte fallback.
3. Loggkontroll via `supabase--edge_function_logs replicate-face-swap` — leta efter `[runRemoveBackground] promptLength` (ska vara ~200 tecken kortare) och frånvaro av `400 upstream_error`.
4. Regressionscheck: testa en människa-utan-bakgrund-produkt och en husdjur-utan-bakgrund-produkt med Akvarell för att bekräfta att resultatet ser visuellt likvärdigt ut.

## Om akvarell fortfarande failar på hus efteråt
Då går vi vidare med separat plan B (korta ned akvarellpresetens egen text under ~2 500 tecken och ta bort dubblerade CRITICAL-block). Det här steget gör vi inte nu enligt ditt val.
