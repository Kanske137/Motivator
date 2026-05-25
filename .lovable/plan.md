## Mål
Byt ut dagens "platta färg"-ramar (Ek/Valnöt = brun rektangel) mot realistiska träramar **identiska med Gelatos produktbilder**, plus mitred corners, mjuk skugga, och tydligare posterhängare.

## Var renderingen sker
Två filer som ritar ramen — båda uppdateras synkat:

1. **`src/components/editor/MapPreview.tsx`** — editor-live-preview. Ramen är `border` med solid `frameColor` (rad 206–214). Hängare = `HangerOverlay` (rad 50–102), redan trälist + snöre men utan trämönster.
2. **`src/lib/mockup-composite.ts`** — komposit i scen-mockups. Ramen ritas som `ctx.fillStyle = frameColor` + diagonal gradient (rad 196–212). Hängare som rektanglar (rad 232–289).

Print-snapshot (`template-snapshot.ts`) rörs INTE — Gelato lägger på den verkliga ramen i produktion.

## Textur-källa: matcha Gelato exakt
Steg innan kod-ändringar:
1. **Hämta Gelatos faktiska produktbilder** via `code--fetch_website` på:
   - `https://www.gelato.com/print-on-demand/products/wall-art/framed-posters` (eller den specifika ek/valnöt-produktsidan)
2. Spara referensbilderna i `/tmp/gelato-refs/` för inspektion (zoom på en hörnpixel för ådringsstil).
3. **Generera 4 sömlösa kakelbara texturer som matchar dessa referenser exakt** via `imagegen--edit_image` (premium-modell), med Gelato-bilden som referens-input och prompten: "Seamless tileable wood grain texture matching this Gelato product photo exactly — same wood species, same grain density, same hue, same matte finish, no shadows, no corners, pure repeatable texture, 1024×256":
   - `src/assets/frame-textures/oak.webp` (ljus ek)
   - `src/assets/frame-textures/walnut.webp` (mörk valnöt)
   - `src/assets/frame-textures/white.webp` (vit lack, subtil korn)
   - `src/assets/frame-textures/black.webp` (svart lack, subtil korn)
4. **QA-steg**: Lägg Gelato-foto bredvid genererad textur. Om hue/ådring inte matchar — kör `imagegen--edit_image` igen med tydligare prompt tills de är visuellt identiska. Detta är ett uttryckligt krav från användaren.

Bundlas som lokala Vite-assets (inte Shopify Files) — snabbare, ingen CORS, konsekvent med övriga mockup-scener.

## Mitred corners
Fyra trapets-sidor (topp/botten/vänster/höger) klippta med `clip-path: polygon(...)` så hörnen möts i 45°. Ådringen löper längs varje list (sidor roteras 90°).

```text
   ┌──────────────┐
   │\            /│   Topp: kort sida = inner-bredd
   │ \          / │   Sidor: roterad textur, kort sida = inner-höjd
   │  \________/  │
   │  /        \  │
   │ /          \ │
   │/____________\│
```

**`MapPreview.tsx`:** Ersätt `borderStyle/Color/Width` med wrapper-`div` + fyra absolut-positionerade `<div>`:ar med `background-image: url(texture)` + `clip-path`. Sidornas inre wrapper roteras 90°.

**`mockup-composite.ts`:** Förhandsladda textur (`loadImage`-helpern finns). Rita fyra polygon-paths med `ctx.save() → ctx.beginPath() → polygon → clip() → drawImage(texture)`. Sidor får `ctx.translate + ctx.rotate(Math.PI/2)`. Behåll diagonal-gradient som ljus/skugga-overlay ovanpå texturen. Fallback till solid fill om texturen inte laddat (ingen blocking await).

## Skugga
- DOM: `box-shadow: 0 6px 18px -4px rgba(0,0,0,0.25), 0 14px 30px -10px rgba(0,0,0,0.18)` på ram-wrappern.
- Canvas: `ctx.shadowColor / shadowBlur / shadowOffsetY` innan ram-rektangeln ritas.

## Posterhängare
Samma 4 trä-texturer återanvänds.
- Listerna får `background-image: url(textureForHanger)` istället för solid `color`.
- Behåll dagens topp/botten-ljusgradient ovanpå (3D-känsla).
- Snöre: höj kontrast något (`rgba(40,30,20,0.9)` + 0.5px highlight) så det syns på ljus vägg.
- Lägg till `box-shadow: 0 2px 6px rgba(0,0,0,0.18)` på lister i DOM-versionen.
- Canvas: `ctx.createPattern(textureImg, "repeat")` som fillStyle för slats istället för solid `hangerColor`.

## Filer som rörs / skapas
1. **`src/assets/frame-textures/{oak,walnut,white,black}.webp`** — nya, genererade från Gelato-referenser.
2. **`src/lib/frame-textures.ts`** (ny):
   ```ts
   export function textureForVariant(variant: string): { url: string; fallbackHex: string } | null
   export function textureForHanger(variant: string): { url: string; fallbackHex: string } | null
   export function preloadFrameTexture(url: string): Promise<HTMLImageElement> // cachad
   ```
3. **`src/components/editor/MapPreview.tsx`** — ny intern `FrameBorder`-komponent (4 mitred sidor + skugga). `HangerOverlay` får `textureUrl`-prop.
4. **`src/lib/mockup-composite.ts`** — byt fill-baserad ram + slats mot texturerad mitred ram + pattern-fyllda slats. Behåll alla nuvarande effekter (gradient, mörkning, skugga).

## Vad som INTE ändras
- Print-snapshot/Gelato print-fil.
- 3D-canvas-preview (canvas-produkter har ingen ram).
- Variantnamn, priser, översättningar.
- `FrameOption.tsx` (väljaren).

## Acceptanskriterier
- Ek/Valnöt-trämönstret i editorn matchar Gelatos produktbild **visuellt identiskt** (hue, ådring, finish).
- Mitred corners (45° fog) syns tydligt.
- Hängare visar trämönster + tydligt snöre.
- Mjuk skugga bakom ramen.
- Porträtt + landscape, alla storlekar, mobil + desktop.
- Ingen Gelato-print-regression.
