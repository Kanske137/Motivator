# ALFA — slutverifiering före live

Ingen prod-/schema-/kod-ändring. Endast diagnostik + statusrapport.

## Bakgrund (vad jag redan vet från koden)

- Live edge-funktionen `supabase/functions/replicate-face-swap/index.ts` (rad 803-820) laddar upp `result.bytes` rakt av till `print-files/<designId>.<ext>` med `contentType` från modellen. **Inget eget komposit-/plattningssteg sker före upload** — vi skickar exakt vad modellen returnerar.
- Live-modellen är fortfarande **Nano-Banana / Gemini** (`callNanoBanana`, rad 596-599 i `runRemoveBackground`). Den returnerar JPEG/PNG **utan alfakanal** — där finns alltså ingen alfa att bevara från början.
- Flux + `851-labs/background-remover` (med `background_type:"rgba"`) finns ENDAST i sandbox-scriptet `diag6/stress/run.sh`. Det är inte inkopplat i edge-funktionen, inte bakom någon flagga, och `FLUX_REMOVEBG_ENABLED` finns inte i kodbasen (`rg` ger 0 träffar).

Punkt 1-3 i din fråga rör alltså **sandbox-buffern** från 851-labs (den enda RGBA-källan vi har idag), inte live-pipen.

## Vad jag kommer göra (build mode)

1. **Rå readout av de faktiskt lagrade cutout-PNG:erna** under `diag6/` och `diag6/stress/` — dvs precis de filer som `curl -sSL "$url" -o "$out"` skrev från 851-labs. Två oberoende verktyg:
   - Python: `Image.open(p); print(p, im.mode, len(im.getbands()), "A" in im.getbands(), im.getextrema())`
   - ImageMagick: `identify -format '%f %[channels] alpha=%A depth=%[depth]\n' p`
   - Plus andel transparenta pixlar (`alpha == 0`) och andel semi-transparenta (`0 < alpha < 255`).
   - Klistras in RÅ i chatten, fil för fil.

2. **Leverera EN cutout som artefakt utan någon omkodning**: kopiera den befintliga `diag6/stress/house2_watercolor_cutout.png` till `/mnt/documents/` med `cp` (binär, ingen ImageMagick, ingen re-encode) och visa som `<presentation-artifact>` så du kan ladda ner originalbytes och själv köra `identify` lokalt.

3. **Om någon fil visar sig vara RGB/saknar alfa**: rapportera det rakt ut. Det finns inget spar-steg att fixa i live-koden (live komprimerar/plattar inte — den passerar bara modellens bytes). Om det är 851-labs-svaret självt som är RGB ligger felet i `run.sh`-anropet (t.ex. `format:"png"` + `background_type:"rgba"` parametrarna), och då uppdaterar jag `diag6/stress/run.sh` — INTE prod-funktionen.

4. **Deployment-status — svar baserat på kodläsning, inte gissning:**
   - Live i prod? **Nej.** Allt Flux+bg-remover-arbete ligger under `diag6/`. Edge-funktionen `replicate-face-swap` är oförändrad och kör fortfarande `callNanoBanana` i `runRemoveBackground`.
   - `FLUX_REMOVEBG_ENABLED` fortfarande false? **Den existerar inte i kodbasen** (`rg FLUX_REMOVEBG_ENABLED` = 0 träffar), så den kan inte vara true. Effektivt false.
   - `product_configs` orört? Behöver bekräftas via `supabase--read_query` mot tabellen (kollar att inga `swapPrompt`/`fluxStylePrompt` ändrats nyligen) — eller jag bekräftar via git-historik att ingen migration/seed rörts.
   - Gemini-default oförändrad? **Ja** — `runRemoveBackground` returnerar `callNanoBanana(...)` (rad 596). Inget i koden väljer Flux-vägen för live-kunder.

## Leverabel

- Inline rå-output från Python+identify för alla cutouts under `diag6/` och `diag6/stress/`.
- En `<presentation-artifact>` med en oförändrad PNG som du kan inspektera själv.
- Punktlista med fyra ja/nej-svar på deployment-frågorna, med kodreferenser.

Inga filer i `src/`, `supabase/functions/`, `supabase/migrations/` eller `supabase/config.toml` ändras. Inga prod-anrop görs.
