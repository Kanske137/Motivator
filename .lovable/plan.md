## Sandbox-plan — inga prod-/schema-/DB-ändringar

### 1. Deployment-status (svaras direkt i chatten, inga filer)

| Fråga | Svar |
|---|---|
| Något live i prod? | **NEJ** — allt under `diag6/` är sandbox. `src/lib/template-schema.ts`, `supabase/functions/replicate-face-swap/index.ts`, `src/components/editor/AiPhotoSection.tsx`, `product_configs` är orörda. |
| `FLUX_REMOVEBG_ENABLED=false`? | **N/A → effektivt JA (av)** — env-flaggan finns inte i koden, ingen kodväg läser den, ingen live-kund kan träffa Flux. |
| `product_configs` orört (ingen `swapPrompt`/`fluxStylePrompt` ändrad)? | **JA, orört** — inga SQL-migrationer eller skript har körts. Fältet `fluxStylePrompt` finns inte ens i schemat. |
| Gemini-default oförändrad live? | **JA** — `AiPhotoSection.tsx` + `replicate-face-swap` produktionsväg orörd. |

### 2. Bevisa äkta RGBA programmatiskt

Problemet: `*_on_checker.png` är komposit → mode `RGB`, inte bevis. Jag måste bevisa det på själva cutout-filen som klienten skulle lagra.

Steg:
- Kör på alla 6 `diag6/*_cutout.png` (= rå output från `851-labs/background-remover`, samma fil som skulle landa i `print-files/<designId>.png`):
  ```python
  from PIL import Image
  im = Image.open(p)
  print(p, im.mode, im.getextrema(), 'A_extrema=', im.getchannel('A').getextrema() if im.mode=='RGBA' else 'N/A')
  ```
  + `identify -format '%[channels] alpha=%A\n' p` per fil.
  + `pngcheck -v` per fil.
- Förväntat: `mode=RGBA`, alfa-extrema `(0, 255)`, `alpha=True`, IHDR `color type = 6 (RGBA)`.
- Klistra in RÅ utdata i chatten. Inga checker-/magenta-bilder denna gång — det är just det formatet som är tvetydigt.
- Om någon fil visar `RGB` eller alfa-extrema `(255,255)`: spåra till bg-removal-anropet (`background_type:"rgba"`, `format:"png"`) och åtgärda i `diag6/`. Aldrig flatten mot svart/vit/checker.

### 3. Robusthet på stökiga hus

- Hämta 3-4 stökiga referensfoton (lövverk framför fasad, sned vinkel, dålig belysning, halv skymd av träd). Källa: jag använder fritt licensierade Unsplash/Pexels-bilder eller, om granskaren föredrar, väntar in 3-4 uppladdade kundliknande foton.
- Kör 2 stilar per foto: **akvarell** (mjuk, godkänd referens) + **olja** (känd risk: målar full landskaps-bakgrund).
- Pipeline per foto/stil (samma som tidigare):
  1. Flux-kontext-pro med husposter-prompten (struktur/identitet bevarad, mid-grey studio-bakgrund, inga omgivningar/lövverk).
  2. `851-labs/background-remover` → RGBA-cutout.
  3. RGBA-check enligt punkt 2.
- För **olja** specifikt: om bg-removal lämnar landskaps-rester eller hål → stärk Flux-promptens *background isolation* (uttrycklig "no landscape, no sky, no foliage, flat #7f7f7f studio only") snarare än att försvaga oljestilen. Klistra in före/efter.
- Outputs sparas under `diag6/stress/<foto>/<stil>_flux.png` + `_cutout.png`. Inga checker-kompositer — bara RGBA-utdata + identify/PIL-bevis.

### Acceptans
- Punkt 1 besvarad ja/nej i chatten.
- Punkt 2: alla 6 cutouts visar `mode=RGBA` + alfa-extrema spridda (`0..255`), eller buggen åtgärdad i sandbox.
- Punkt 3: 3-4 stökiga hus × 2 stilar = 6-8 cutouts, alla med rent urklipp (inga lövverk-rester, inga hål) och RGBA-bevis. Oljan klarar bg-removal eller har plainare Flux-bakgrund.

### Filer som rörs
- Endast under `diag6/` (ny `diag6/stress/`).
- **Inte rörda:** `src/**`, `supabase/functions/**`, `supabase/config.toml`, `.env`, `product_configs`, schema, migrations.

### Frågor innan körning
- Stökiga foton: ska jag använda fritt licensierade webbfoton, eller vill du ladda upp 3-4 specifika kundliknande hus?
