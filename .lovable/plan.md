# Plan: Flux bg-removal in live (gate OFF), generic & config-driven

Ja, jag förstår. Allt nedan implementeras utan att röra `product_configs`, utan att flippa default-modellen för någon mall, och bakom `FLUX_REMOVEBG_ENABLED`. Diag6-pipelinen är källan vi speglar.

## 1. Schema-fält (additivt, ingen DB-migration)
`src/lib/template-schema.ts` — i `aiPhotoLayerDefaultsSchema`:
- `fluxStylePrompt: z.string().optional()` — fri text per lager, motiv/isoleringsinstruktion (t.ex. "subject = single residential house, isolate on flat #7f7f7f, no landscape/sky/foliage…"). Får INTE innehålla stilord.
- (Använder befintlig `backdropColor` för punkt 5.)

Ingen kodändring krävs i `product_configs` — fältet plockas upp via befintlig jsonb när admin/SQL skriver det.

## 2. Klient skickar fluxStylePrompt
`src/components/editor/AiPhotoSection.tsx` (vid `face-swap`-invoke, ~rad 297-304):
- Skicka `fluxStylePrompt: layer.defaults.fluxStylePrompt ?? null` i bodyn. Inget annat ändras. Stilvalet (`removeBackgroundStylePrompt`) går vidare oförändrat.

## 3. Edge function: gate + Flux-pipeline
`supabase/functions/replicate-face-swap/index.ts`:

- Plocka ut `fluxStylePrompt: string | null` från body bredvid befintliga `removeBackground*`-fält.
- Skicka in `fluxStylePrompt` till `runRemoveBackground(...)`.
- I `runRemoveBackground` (rad ~596), före `callNanoBanana`:
  ```ts
  const fluxEnabled = Deno.env.get("FLUX_REMOVEBG_ENABLED") === "true";
  const useFlux =
    params.subjectKind === "removeBackground" &&
    typeof params.fluxStylePrompt === "string" &&
    params.fluxStylePrompt.trim().length > 0 &&
    fluxEnabled;
  if (useFlux) return callFluxRemoveBg({...});
  return callNanoBanana({ promptText, imageUrls: [params.faceImageUrl] });
  ```
  Gaten triggas på fält + subjectKind. Aldrig template-id/slug.

- Ny intern helper `callFluxRemoveBg` (samma fil, ingen ny edge function) som speglar `diag6/stress/run.sh`:
  1. POST `models/black-forest-labs/flux-kontext-pro/predictions` med `{ input_image: faceImageUrl, prompt: assembled, output_format:"png", safety_tolerance:2, prompt_upsampling:false, aspect_ratio:"match_input_image" }`. Polla.
  2. POST `/predictions` mot `851-labs/background-remover` (`version: a029dff3…`) med `{ image: <flux url>, format:"png", background_type:"rgba" }`. Polla.
  3. Returnera `{ ok:true, bytes, contentType:"image/png", outputUrl }` — exakt samma shape som `callNanoBanana`, så uppladdningssteget (rad 803-820) är oförändrat. RGBA bevaras hela vägen. Ingen Canvas, ingen JPEG-flatten.

- Prompt-assembly (stil-neutral, ordningen fast):
  ```
  [fast bas — Edit the input photo / isolate subject / return single image / aspect-instruktion]
  [params.fluxStylePrompt]            // motiv/isolering, från config
  [params.stylePrompt]                // kundens stil-val, oförändrat
  ```
  Den befintliga prompt-byggaren (rad 562-582) återanvänds; vi infogar `fluxStylePrompt`-blocket mellan `adminPromptLine` och `styleBlock`. Den fasta basen ändras inte. Outcome-loggning behålls; logga även `useFlux`.

- Fel/timeout i Flux- eller bg-remover-steget → `fallbackResponse(...)` (samma mönster som idag). Ingen tyst fallback till Gemini när gaten är på och fluxStylePrompt är satt — vi vill se felet i face-swap-diag.

## 4. ENV-gate
- Ny secret `FLUX_REMOVEBG_ENABLED`. Sätts via secrets-tool, värde `false`. Saknad eller `!== "true"` ⇒ Gemini, exakt som idag.

## 5. Bakgrundsfyllnad i snapshot/preview (shippar samtidigt)
`src/lib/template-snapshot.ts`, aiPhoto-grenen (rad ~789-836): före `drawImage` av AI-resultatet:
- Om `layer.defaults.subjectKind === "removeBackground"` och `layer.defaults.backdropColor` finns:
  - Spara ctx-state, applicera samma `clipForShape(...)` som används för draw, `ctx.fillStyle = backdropColor; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);` (inom clip), restore — och rita sedan RGBA-urklippet ovanpå.
- Endast när `aiResultUrl` finns (annars är det fortfarande referensbilden som visas och vi vill inte fylla över den).

`src/components/editor/MapPreview.tsx`, aiPhoto-grenen (rad ~657-700): spegla samma fyllnad i live-previewen så editorn visar exakt det som trycks. Implementeras med ett underliggande `<rect>` (eller bakgrundslager) i samma clip-form, bara när `subjectKind==="removeBackground"`, `backdropColor` är satt och `aiResultUrl` finns.

Ingen ändring för human/pet-fallet eller när backdropColor saknas.

## 6. Saker som EXPLICIT inte ändras
- `product_configs` (ni sätter `defaults.fluxStylePrompt` + `defaults.backdropColor` via SQL).
- Gemini-default för alla andra subjectKinds och alla mallar utan `fluxStylePrompt`.
- Uppladdningssteget på rad 803-820 (samma `result.bytes`/contentType rakt in i storage).
- `face-swap-diag` / outcome-loggning.
- `removeBackgroundStylePrompt`-flödet i klienten.
- `supabase/config.toml`, andra edge functions, alla scheman.

## 7. Spot-check efter deploy (gate fortfarande AV)
1. Lägg fluxStylePrompt + backdropColor på en test-mall via SQL (ni).
2. Sätt `FLUX_REMOVEBG_ENABLED=true` temporärt i sandbox-projektet (eller via `?engine=`-override om ni vill — säg till om ni vill att jag adderar en sådan; just nu är gaten ren env).
3. Kör en live-render. Verifiera: `identify -format '%[channels] alpha=%A\n'` på `print-files/<designId>.png` = `srgba alpha=Blend`, alfa-extrema 0..255, husets kropp heltäckande mot backdropColor i snapshot. Klistra in readout + bild.
4. Flippa tillbaka `FLUX_REMOVEBG_ENABLED=false`. Re-rendera samma mall → Gemini-vägen, identiskt med idag.

## Tekniska detaljer (sammanfattning av filer)
- `src/lib/template-schema.ts` — lägg till `fluxStylePrompt` (optional string) i aiPhoto defaults.
- `src/components/editor/AiPhotoSection.tsx` — vidarebefordra fältet i invoke-bodyn.
- `supabase/functions/replicate-face-swap/index.ts` — body-parse, params-typ, gate, `callFluxRemoveBg`, prompt-assembly, logg.
- `src/lib/template-snapshot.ts` — backdrop-fill före aiPhoto-draw när subjectKind=removeBackground.
- `src/components/editor/MapPreview.tsx` — samma backdrop-fill i preview.
- Secret: `FLUX_REMOVEBG_ENABLED=false`.

Inga DB-migrationer, inga ändringar i `product_configs`, ingen ändrad default-modell för befintliga mallar.
