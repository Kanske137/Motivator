# Diagnos: Husets bg-removal "äter" delar av motivet

Mål: lokalisera felet (Flux-steg A vs bg-removal steg B) genom att spara och visa mellanbilden, samt testa en hårdare isoleringsprompt med kontrasterande bakgrund.

Allt körs som lokalt Node/Python-script i sandbox med Replicate-konnektorn — INGEN prod-kod, INGEN edge-funktion, INGEN flagga, INGEN UI-ändring.

## Inputs
- Originalfoto: `Husposter.png` (samma som i Fas 0).
- Modeller (samma som planerade pipelinen):
  - Flux Kontext: `black-forest-labs/flux-kontext-pro` (`safety_tolerance: 5`).
  - BG-removal: `851-labs/background-remover` (version `a029dff…b80bc`) — samma som gav rena resultat i Fas 0.

## Steg

### 1. Två Flux-varianter, samma bas-bild
Kör Flux Kontext två gånger med `input_image = Husposter.png` och spara båda raw-utdata.

**A1 — nuvarande/svaga prompten** (motsvarar dagens swapPrompt + plain-bg-tillägg):
```
<dagens akvarell-swapPrompt> + "Place the subject on a plain uniform off-white background, no scenery."
```

**A2 — hårdare isolerings-prompt med MID-GREY:**
```
Keep the house exactly as it is (same architecture, colors, windows, roof).
Remove everything around it: all plants, bushes, foliage, trees, sky, ground,
fences, lamps and any surrounding objects. Reconstruct any part of the house
that is hidden behind vegetation so the complete facade is visible. Place the
house alone on a flat, uniform, plain mid-grey (#7A7A7A) background with no
texture, no gradient and no scenery. Return one image, no text.
```
(akvarell-stylen läggs till EFTER "Keep the house exactly as it is …" så stilen finns kvar)

Spara: `diag/house_fluxA1_offwhite.png`, `diag/house_fluxA2_midgrey.png`.

### 2. BG-removal på båda
Kör `851-labs/background-remover` på A1 och A2.
Spara: `diag/house_B1_from_A1.png`, `diag/house_B2_from_A2.png` (transparenta PNG).

### 3. Komposit över backdropColor (samma kod som template-snapshot)
Komposera B1 och B2 över `#FFFFFF` och `#6B8E5A` i 1440×1920 (samma layer-rect xPct 4/yPct 11/wPct 92/hPct 60).
Spara 4 print-filer: `house_{B1,B2}_{white,green}_print.png`.

### 4. Routing-sanity
Logga och bekräfta att `B*` får `A*` som input (inte originalfotot). Spara ett litet JSON-manifest `diag/manifest.json` med {input, fluxOutputUrl, removerInputUrl, removerOutputUrl} per körning.

### 5. Leverans
Klistra in i chatten, sida vid sida:
- A1 (Flux off-white) → B1 transparent → B1 över vit + grön.
- A2 (Flux mid-grey + hårdare prompt) → B2 transparent → B2 över vit + grön.

Plus en kort skriven slutsats:
- Om A1 redan visar lövverk/omgivning kvar → felet är Flux-steget; A2 ska visa renare isolering och B2 ska sluta äta hus-detaljer.
- Om A1 är ren men B1 ändå äter vita fönsterfoder → bakgrundsfärgen var fienden; B2 (mid-grey i Flux) ska lösa det.
- Om båda B-bilder är trasiga → remover-modellen behöver bytas/testas (utanför denna diagnos).

## Vad INTE görs
- Ingen edit i `replicate-face-swap`, `AiPhotoSection`, schema, `.env`, eller config.toml.
- Ingen ny env-flagga, ingen DB-write.
- Bara läs-only sandbox-körning + bildleverans i chatten.

## Acceptans
Fyra print-bilder + två raw Flux-bilder + två transparenta cutouts inklistrade, plus skriftlig diagnos som pekar ut Flux-steget vs remover-steget. Inga prod-filer ändrade.
