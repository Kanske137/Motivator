
## 1. Deployment-status (verifierat mot repo nu)

| Punkt | Status |
|---|---|
| `fluxStylePrompt` mergeat till prod-schema | **NEJ** — fältet finns inte alls i `src/lib/template-schema.ts` eller någon annan källfil. Endast i sandbox-scripts under `diag/` och `diag6/`. |
| Flux-routing deployad i `replicate-face-swap` | **NEJ** — `supabase/functions/replicate-face-swap/index.ts` har bara en `?engine=flux&stub=1`-diag-gren (rad 632), ingen riktig Flux→bg-removal-pipeline. |
| `FLUX_REMOVEBG_ENABLED=false` | **N/A** — env-flaggan existerar inte i koden ännu. Ingen live-kund kan träffa Flux-vägen. |
| `product_configs` ändrat (husposterns swap/flux-prompt) | **NEJ** — inga SQL-migrationer eller skript har körts mot DB. Granskaren skriver SQL:en. |
| Default-vägen (Gemini) oförändrad för live | **JA** — `AiPhotoSection.tsx` och `replicate-face-swap` orörda i produktions-flödet. |
| 6-stilars-körningen sandbox-only | **JA** — kördes som lokala node/curl-scripts mot Replicate direkt, lagrade endast i `diag6/`. Inga prod-filer rörda. |

Sammanfattning: **inget är live, inget i prod-schema, inget i DB**. Allt arbete hittills är sandbox.

## 2. Äkta RGBA — verifierat nu

Jag körde PIL direkt på `diag6/*_cutout.png` (samma filer som visas i panelen):

```
vintage_cutout.png    RGBA  transp=614688 / opaque=418487 / total=1042176
oil_cutout.png        RGBA  transp=627351 / opaque=404355
watercolor_cutout.png RGBA  transp=675359 / opaque=356242
sketch_cutout.png     RGBA  transp=665643 / opaque=361359
popart_cutout.png     RGBA  transp=633974 / opaque=398765
lineart_cutout.png    RGBA  transp=857104 / opaque=48279
```

Alla 6 har `mode == 'RGBA'` och majoritet transparenta pixlar. De är inte opaka RGB på svart.

Trolig orsak till "ser svart ut": filvisaren i panelen renderar PNG-alfa mot svart bakgrund istället för ett rutmönster. Verifieringsplan nedan eliminerar den tvetydigheten.

### Planerade RGBA-bevis (sandbox)
- Kör `pngcheck -v` + `python -c "Image.open(f).info, mode, getchannel('A').getextrema()"` per fil och klistra in utdata i chatt.
- Generera en `*_on_checker.png` (kompositerat mot rutmönster) och en `*_on_magenta.png` per cutout — om alfa är äkta syns rutorna/magentan kring motivet. Spara i `diag6/proof/`.
- Om någon fil faktiskt visar sig vara opak: spåra till `format:"png"` i bg-removal-anropet och åtgärda — aldrig flatten mot svart/vit.

## 3. Förstärk olja + vintage (sandbox-rerun)

Justeringar i sandbox-skriptet (`diag6/run.ts`), endast för dessa två presets — övriga 4 rörs ej:

**Olja** — höj måleriskt uttryck:
- Lägg till i bridge: *"Apply the painting style aggressively. The result must read as an oil painting, not a photograph: visible thick impasto brush strokes, palette-knife texture, painterly edges, no photographic micro-detail."*
- Höj Flux `guidance` 3.5 → 5.0, `prompt_strength` 0.85 → 0.92 för denna körning.

**Vintage** — tydligare retro/print-look:
- Bridge: *"The result must look like an aged printed illustration or vintage travel poster — flat screen-print shapes, limited muted retro palette (ochre, faded teal, cream), visible halftone/paper grain, no photographic lighting or modern color."*
- Höj `guidance` → 5.0, `prompt_strength` → 0.92.

Kör endast olja + vintage, generera Flux-mellanbild + RGBA-cutout + checker/magenta-proof. Klistra in resultaten.

## 4. Acceptans innan något annat

- Deployment-status ovan bekräftad (allt NEJ utom Gemini-default = JA).
- 6 cutouts har dokumenterat RGBA-bevis (checker/magenta-kompositer + pngcheck-utdata).
- Olja och vintage rerun visar tydligt måleri/retro, inte foto.
- Fortfarande **noll** ändringar i prod-schema, edge-funktion eller `product_configs`.

## Tekniska detaljer

- Endast filer under `diag6/` (+ ny `diag6/proof/`) och `diag6/run.ts` rörs.
- `supabase/functions/replicate-face-swap/index.ts`, `src/lib/template-schema.ts`, `src/components/editor/AiPhotoSection.tsx`, `.env` och `supabase/config.toml` rörs **inte**.
- Inga DB-migrationer, inga `product_configs`-uppdateringar.
