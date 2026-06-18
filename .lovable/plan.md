## Diagnos

Loggarna bekräftar:
- `useFlux: true` på alla körningar
- `styleLabel` varierar korrekt (Pop-art / Olja / Skiss / Vintage / Linjekonst / Akvarell)
- `hasFluxStylePrompt: true`
- `promptLength` ~4300 tecken

Stilen skickas alltså — den ignoreras av Flux Kontext Pro.

## Varför stilen inte slår igenom

Flux-grenen återanvänder samma 4300-teckens prompt som byggdes för Nano Banana. Den prompten innehåller flera instruktioner som direkt motverkar stylebytet och som Flux tar bokstavligt:

1. `PRESERVE SUBJECT COLORS — keep the subject's original colors, hue, saturation, paint/material tone and lighting exactly as in the input photo` — säger åt Flux att INTE ändra färgton, vilket är hela poängen med Pop-art/Olja/Skiss/Vintage.
2. `Keep the subject's identity, shape, surfaces, colors and proportions exactly as in the input photo` — samma sak igen.
3. `FILL THE FRAME … 90-95%` + `feather edges` + lång backdrop-färgsbeskrivning — bullret tränger ut styleBlock som ligger längst ner.
4. Backdrop låst till `#FFFFFF`. I diag6 var det `#7f7f7f` mid-grey, vilket bg-remover-modellen är tränad/validerad mot. Vit backdrop gör det också svårare för bg-remover att skilja ljusa hus från bakgrund.
5. Den validerade diag6-prompten var ~600 tecken, byggd som `BASE (isolate på #7f7f7f) + fluxStylePrompt + style preset` — kort, fokuserad, stilord sist.

Nano Banana fungerar med mega-prompten eftersom Gemini väger sektioner. Flux gör det inte — den följer det första bestämda kravet den hittar.

## Åtgärd (endast Flux-grenen, inget annat påverkas)

### Ändring i `supabase/functions/replicate-face-swap/index.ts`

Bygg en **separat kompakt prompt** för Flux-grenen, identisk till strukturen i `diag6/stress/run.sh`. Skicka den till `callFluxRemoveBg` istället för den Nano Banana-prompten.

Struktur (~500-700 tecken):

```
The subject is a single residential house. Preserve its architecture, roofline,
window/door placement, proportions and composition so it stays recognizable.
Completely isolate the building on a perfectly flat mid-grey (#7f7f7f) studio
backdrop. ABSOLUTELY NO landscape, sky, trees, foliage, grass, ground, shadow,
people, vehicles, text or watermark. Area outside the building silhouette must
be a single solid flat #7f7f7f.

[fluxStylePrompt från template — motiv/isolering, oförändrat]

[Om stil ej är akvarell: bridge-mening "The result must read as a <style>, NOT
a photograph: <painterly hints>"]

Render the subject in the following art style. Apply it fully to the subject
while keeping its structure and identity recognizable:
[stylePrompt — kundens valda stil, sist så det vinner]
```

Vit slutbakgrund åstadkoms ändå — bg-remover-steget tar bort den grå studio-bakgrunden och returnerar RGBA. Komposition mot kundens valda `backdropColor` sker redan i snapshot/preview-lagret.

### Vad som EXPLICIT INTE ändras

- Nano Banana-grenen (`useFlux: false`) — samma mega-prompt som idag.
- `product_configs` / mallar — `fluxStylePrompt` används som det är.
- `aiPhotoSection.tsx` — fortsätter skicka `stylePrompt`, `fluxStylePrompt`, `backdropColor` som idag.
- `callFluxRemoveBg`-pipelinen (Flux → 851-labs) — pollning, parametrar, RGBA-upload oförändrade.
- Schemat — inga nya fält.
- `FLUX_REMOVEBG_ENABLED`-gate — oförändrad.
- Aspect ratio styrs fortsatt via `aspect_ratio: "match_input_image"` på Flux-anropet.

### Logg-städning (samma fil)

Sätt `route = "remove-bg-flux"` när `useFlux === true` så loggen `[face-swap] done route=...` speglar verkligheten. Idag säger den alltid `remove-bg-nano-banana` även när Flux körs.

## Verifiering efter ändring

Be dig köra en rendering per stil (Pop-art, Olja, Skiss, Vintage, Linjekonst, Akvarell). Förväntat i loggar:

- `[runRemoveBackground] config … useFlux: true`
- Ny separat Flux-prompt loggad, ~500-700 tecken (inte 4300)
- `[flux-removebg] start`, `[flux-removebg] flux done`, `[flux-removebg] bg-remover done`
- `[face-swap] done route=remove-bg-flux`

Visuellt: tydlig skillnad mellan stilarna, transparent bakgrund i `print-files/<designId>.png`.