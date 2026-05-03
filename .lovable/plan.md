## Mål
Ramen som ritas runt postern i kundeditorns preview ska se ut som de riktiga Gelato-ramarna — inkl. träåder för Ek/Valnöt och korrekt matt vit/svart — istället för dagens platta CSS-färger. Storlek, bredd (1.2 cm), proportioner, layout och allt annat lämnas orört.

## Vad som ändras

### 1. `src/pages/EditorPage.tsx`
Byt `FRAME_COLORS` (Record av HSL-strängar) mot `FRAME_STYLES` som returnerar både en fallback-färg och en textur-URL hämtad från `src/assets/frames/frame-{white|oak|walnut|black}.jpg` (samma filer som redan används för thumbnail-knapparna, så materialet är identiskt med Gelatos prover).

```ts
const FRAME_STYLES: Record<string, { color: string; texture?: string }> = {
  Ingen:  { color: "" },
  Vit:    { color: "hsl(0 0% 98%)",  texture: frameWhite },
  Svart:  { color: "hsl(0 0% 8%)",   texture: frameBlack },
  Ek:     { color: "hsl(30 35% 55%)", texture: frameOak },
  Valnöt: { color: "hsl(20 25% 25%)", texture: frameWalnut },
};
```

Skicka både `frameColor` och nytt prop `frameTexture` vidare till `MapPreview`.

### 2. `src/components/editor/MapPreview.tsx`
Lägg till `frameTexture?: string` i Props. När den finns, applicera den som `border-image` på samma `<div>` som idag har CSS-bordern — inga ändringar av `borderWidth`/`borderPx`-uträkningen, så ram­bredden förblir exakt 1.2 cm i alla storlekar:

```ts
const frameStyle: React.CSSProperties = {
  ...,
  borderStyle: frameColor ? "solid" : undefined,
  borderColor: frameColor,                 // fallback om bilden inte laddat
  borderWidth: frameColor ? `${borderPx}px` : 0,
  ...(frameTexture ? {
    borderImageSource: `url(${frameTexture})`,
    borderImageSlice: 80,        // klipper ut mittpartiet ur texturen
    borderImageRepeat: "round",  // upprepa runt långsidor utan att stretcha
    borderImageWidth: `${borderPx}px`,
  } : {}),
};
```

`border-image-repeat: round` ger ett kontinuerligt mönster runt hela ramen och hörnen får automatiskt rätt orientering — vilket är det som idag saknas och får Ek/Valnöt att se "platt brun" ut.

### 3. Inget annat rörs
- Ramknapparna under "Format" (`FrameOption` / `FRAME_THUMBS`) behålls oförändrade.
- 3D-canvas-previewn (`Canvas3DPreview`) berörs inte (canvas har ingen ram).
- `frameWidthCm`, `borderPx`-beräkningen, layoutens `frontInset`, mockups och Gelato-SKU-mapping rörs inte.
- `aluminum` / `acrylic` (som inte har ram) påverkas inte — `frameTexture` skickas bara när `product_type === "posters"`.

## Resultat
Vit ram → matt vit yta. Svart ram → matt mörk yta. Ek/Valnöt → faktisk träådring som matchar Gelatos produktbilder, eftersom vi återanvänder exakt samma bildfiler som redan visas på ramväljaren. Bredd och proportioner identiska med idag.