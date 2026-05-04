## Bakgrund

Idag ritas ramar och hängare som *enfärgade rektanglar* med en enkel ljus→mörk gradient. För svart och vit ser det rimligt ut, men för **Ek** (`#c8a371`) och **Valnöt** (`#5a3a26`) blir resultatet platt och plastigt — inget ådring, inga porer, ingen riktning. Tidigare försök att tile:a thumbnail-bilden (`frame-oak.jpg` / `frame-walnut.jpg`) gav tydligt synliga sömmar och felaktig skala.

Lösningen är en **procedurell trä-shader ritad direkt på canvas** (för snapshot/mockup) och som CSS-bakgrund (för live-editorn). Ingen extern bild, inga sömmar, korrekt skala oavsett posterstorlek, och ådringen följer listens längdriktning som riktigt trä gör.

Berör endast preview/cart/mockup. Tryckfilen är redan gated (`hires`-flagga + `frameColor: undefined`) och rörs inte.

## Vad som ändras

### 1. Ny modul: `src/lib/wood-texture.ts` (ny fil)

En liten ren-utility som genererar trä-utseende. Två API:er — ett för canvas (snapshot + mockup) och ett för CSS (live editor):

- `paintWoodGrain(ctx, x, y, w, h, variant, opts)` — målar en trä-rektangel med:
  - **Bas-färg** som varierar lätt över ytan (warm/cool drift via low-frequency sin-kombo).
  - **Ådringslinjer** som följer listens långa axel: ~12–20 mörkare böljande kurvor per list, varierad amplitud och frekvens, ritade med multiply-liknande alfa.
  - **Kvistar (knots)** — 0–2 elliptiska mörka fläckar med koncentriska ringar runt, slumpmässig placering. Använder en deterministisk seed (variant + dimensioner) så samma list ser likadan ut mellan renderingar.
  - **Por-textur** — fina korta dashes parallellt med ådringen för att simulera trä-porer.
  - **Slut-gradient** topp→botten för 3D-känsla (behåller nuvarande highlight + skugga).
- `woodCssBackground(variant)` — returnerar en CSS `background-image` med staplade `linear-gradient`/`radial-gradient` som approximerar samma utseende. Används i editorn där vi inte ritar canvas. Använder samma palett-system så CSS och canvas matchar.
- Färgpaletter (per variant):
  - **Ek**: bas `#c8a371`, ådring `#8a6a3e`, ljusband `#e0c89a`, knot `#5e4422`.
  - **Valnöt**: bas `#5a3a26`, ådring `#2c1a10`, ljusband `#7a5230`, knot `#1a0c06`.
  - Svart/Vit: behåller dagens flata fyllning + befintlig ljushöjd-gradient (inget ådring).
- Alla draw-funktioner accepterar `direction: "horizontal" | "vertical"` så ådringen alltid följer listens långa sida (horisontellt på topp/botten-list, vertikalt på vänster/höger-ramsida).

### 2. `src/components/editor/MapPreview.tsx` — `HangerOverlay`

- Importera `woodCssBackground`.
- Byt `slatStyle.background = color` mot `background: woodCssBackground(variantFromColor(color))` när färgen är ek eller valnöt; behåll dagens flat color + gradient för svart/vit.
- Lägg till `backgroundSize` som speglar listens fysiska längd (~30 cm motiv-bredd som referens) så ådringen har trovärdig skala oavsett zoom.

### 3. `src/components/editor/MapPreview.tsx` — frame border

Den nuvarande ramen ritas som `border` på frame-div:en (en CSS-border har ingen ådring). För ek/valnöt byter vi till en wrapper-strategi:
- Frame-div:en behåller sin border som *placeholder* (rätt utrymme), men vi lägger en absolut positionerad SVG-/div-overlay i 4 listor (topp/botten/vänster/höger) som har `woodCssBackground(variant)` med rätt riktning per list.
- Hörn-jointer (45°) approximeras med `clipPath: polygon(...)` per list så listerna möts snyggt.
- För svart/vit behålls dagens enkla CSS-border.

### 4. `src/lib/template-snapshot.ts`

- `frame`-blocket (rad 674–686): för ek/valnöt ersätt `ctx.fillRect` på de fyra sidorna med `paintWoodGrain(ctx, ..., variant, { direction })`. Behåll inner stroke (skuggdetalj). För svart/vit — oförändrat.
- `hanger`-blocket (rad 773–797): byt `fctx.fillRect(...)` mot `paintWoodGrain(fctx, ..., variant, { direction: "horizontal" })` följt av nuvarande highlight-gradient + (för vit) inner stroke. Skuggan (shadowBlur) flyttas att ritas som en separat under-fyllning innan trä målas, så texturen inte suddas ut.

### 5. `src/lib/mockup-composite.ts`

- `frame`-blocket (rad 196–214): samma utbyte — för ek/valnöt anropa `paintWoodGrain` på de fyra ram-sidorna med rätt riktning. Behåll grad-overlay för 3D-känsla men sänk dess alpha så ådringen syns.
- `hanger`-blocket (rad 232–260): byt `ctx.fillRect(x0, yTop, x1-x0, slatH)` mot `paintWoodGrain` med horisontell riktning.

### 6. Variant-detection helper

Lägg liten helper i `wood-texture.ts`:
```ts
export function woodVariantFromHex(hex: string): "oak" | "walnut" | null {
  const h = hex.toLowerCase();
  if (h === "#c8a371") return "oak";       // Ek + Hängare Ek
  if (h === "#5a3a26") return "walnut";    // Valnöt + Hängare Valnöt
  // Ramfärgerna för Ek/Valnöt (om annan hex) hanteras via samma map-uppslag
  return null;
}
```
Konsumenter (snapshot, mockup, MapPreview) kollar `woodVariantFromHex(color)` → om null → behåll dagens flata fyllning, annars använd trä.

Hex för ram-Ek/Valnöt verifieras i `FormatSection` / `product-config` när vi implementerar och läggs in i mappen.

### 7. Print-fil

Ingen påverkan. `renderHiresTemplateSnapshotSafe` rensar redan `frameColor` och `hangerColor`. Verifierat på rad 850–851.

## Test efter implementation

1. **Editor — Hängare Ek**: Listerna ska visa tydlig horisontell ådring, varma färgvariationer, eventuellt 1–2 kvistar. Inga sömmar.
2. **Editor — Hängare Valnöt**: Mörka mahogny-toner med tydligare svarta ådringslinjer.
3. **Editor — Ram Ek / Valnöt**: Alla fyra ramsidor visar ådring i sin långaxel-riktning, hörn möts utan synlig kakel.
4. **Cart-thumbnail**: Snapshot återger samma trä-utseende vid 256–512 px bredd — ådringen får inte degenerera till brus.
5. **Mockup-galleri**: Trä syns även när postern är liten i scenen (ådring skalas korrekt mot `referenceWidthCm`).
6. **Svart/Vit**: Helt oförändrad rendering.
7. **Print-fil**: Generera tryck-PDF → varken ram eller hängare ska finnas (oförändrat).

## Risker

- **Performance**: Procedurell trä ritas med ~20–30 path-strokes per list. Snapshot körs en gång per cart-add, mockup en gång per scen — försumbart. Editor använder CSS (ingen JS-ritning).
- **Determinism**: Seedad slump per variant+storlek så samma poster ser identisk ut mellan re-renders (ingen "darrning" när användaren ändrar något orelaterat).
- **CSS vs canvas-matchning**: CSS-versionen blir ungefärlig — målet är att den *känns* som samma material, inte pixelidentisk.
