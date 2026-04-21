

## Plan: Korrekt canvas-wrap på 3D-förhandsvisningen enligt Gelatos specifikation

### Vad du efterfrågar
3D-förhandsvisningen ska visa **exakt** hur den fysiska canvasen ser ut när kunden får hem den:
- Vid 2 cm djup → 2 cm av printens kant wrappas runt på sidorna (+ bleed).
- Vid 4 cm djup → 4 cm av printens kant wrappas runt (+ bleed).
- Front = själva motivet utan wrap-zonen, så det som syns på fronten matchar editorns layout.

Idag (`Canvas3DPreview.tsx`) samplas en proportionell strip från **hela** print-bilden för sidor/topp/botten. Print-filen från `generate-print-file` innehåller redan både motiv-zon + wrap-marginal + bleed enligt Gelatos spec, men 3D-vyn behandlar hela bilden som "front" och tar 3 % bleed av den — vilket gör att sidorna inte motsvarar verkliga wrap-zonen och fronten visar för mycket av motivet (inkl. det som egentligen försvinner runt kanten).

### Gelatos canvas-specifikation (referens)
- **Visible front** = beställd storlek (t.ex. 30×40 cm).
- **Wrap** = canvasdjupet på varje sida (2 eller 4 cm).
- **Bleed** = 3 mm extra på varje sida utanför wrap (enligt Gelato för canvas).
- **Total print-fil** = `(W + 2·djup + 2·0.3) × (H + 2·djup + 2·0.3)` cm.

Exempel 30×40 / 4 cm djup → print-fil 38.6 × 48.6 cm. Front = inre 30×40 box. Wrap-strippar = 4 cm runt om. Bleed = 0.3 cm yttersta kant.

### Diagnos i nuvarande kod
I `Canvas3DPreview.tsx`:
1. Texturen läggs som `front`-material med default-UV (0..1) över hela print-bilden → motivet ser komprimerat ut + visar wrap-zonen på fronten.
2. Edge-strippar tas via `bleedX = depthCm/widthCm` (t.ex. 0.13 för 4 cm/30 cm) — men det är **inte** det som faktiskt ligger i wrap-zonen i print-filen; bilden samplas från ytter-edgen utan att ta hänsyn till bleed.
3. Top/bottom-faces har UV-flippar som maskerar problemet men ger inte en korrekt fortsättning från fronten.

### Fix

**A. Editor-snapshot/print-file måste exponera zon-metadata**
Säkerställ att texturen som skickas till 3D-vyn är **hela print-filen** (front + wrap + bleed). Skicka in `widthCm`, `heightCm`, `depthCm` plus `bleedCm = 0.3` som props till `Canvas3DPreview`.

Beräkna i komponenten:
```
totalW = widthCm + 2*depthCm + 2*bleedCm
totalH = heightCm + 2*depthCm + 2*bleedCm
fracFrontX = widthCm / totalW
fracFrontY = heightCm / totalH
fracWrapX  = depthCm / totalW
fracWrapY  = depthCm / totalH
fracBleedX = bleedCm / totalW
fracBleedY = bleedCm / totalH
```

**B. Front-material: använd UV-offset så endast motiv-zonen visas**
Klona texturen, sätt:
```
frontMap.offset.set(fracBleedX + fracWrapX, fracBleedY + fracWrapY)
frontMap.repeat.set(fracFrontX, fracFrontY)
```
→ fronten visar exakt det kunden ser på editorn, ingen wrap, ingen bleed.

**C. Sido-material (left/right): sampla wrap-zonen längs Z-axeln**
För **right** (+X face, dimension Z = djup):
```
rightMap.offset.set(fracBleedX + fracWrapX + fracFrontX, fracBleedY + fracWrapY)
rightMap.repeat.set(fracWrapX, fracFrontY)
// rotera så lång sida (Y i texturen) ligger längs box-Y
```
Spegelvänt för **left** (offset.x = fracBleedX, samma repeat).

**D. Topp/botten-material: sampla wrap-zonen tvärs över**
För **top** (+Y face, dimension Z = djup, X = bredd):
```
topMap.offset.set(fracBleedX + fracWrapX, fracBleedY + fracWrapY + fracFrontY)
topMap.repeat.set(fracFrontX, fracWrapY)
```
För **bottom** (-Y face): offset.y = fracBleedY, samma repeat.

UV-rotation/flip per face så att kanten närmast fronten i texturen verkligen ligger mot frontens kant på boxen (testa visuellt — vid behov `repeat = (1,-1)` eller `rotation = Math.PI/2`).

**E. Korrekta dimensioner på BoxGeometry**
Idag normaliseras till max-axel = 2. Behåll det, men säkerställ att `d` (djup) räknas från **verkligt** `depthCm`, inte hårdkodat.

**F. Hörn-kontinuitet**
Med korrekta UV-offsets ovan blir hörnen automatiskt sömlösa, eftersom strippen som ligger på t.ex. höger sida är **samma pixlar** som fortsätter från frontens högerkant i print-filen. Inga extra knep behövs.

**G. Bleed-hänsyn**
Bleed-zonen (yttersta 0.3 cm) hamnar på baksidan av canvasen i verkligheten — hanteras korrekt genom att `offset` startar `+fracBleedX/Y` in i texturen, så bleed-pixlarna faller utanför både front- och sido-samplingen (de "försvinner runt baksidan" precis som i verkligheten).

### Filer som ändras
- `src/components/editor/Canvas3DPreview.tsx` — ny UV-offset-logik per face baserad på `widthCm`, `heightCm`, `depthCm`, `bleedCm`. Ta bort canvas-cropping i `make()`-funktionen (samtliga faces använder samma textur med olika offset/repeat istället för separata kopior).
- `src/lib/editor-snapshot.ts` — verifiera att snapshot som skickas till 3D-vyn innehåller hela print-arean (front + wrap + bleed), inte bara front-motivet. Om snapshot idag bara renderar front-motivet → utöka till att rendera full print-area med wrap-zoner (samma som `generate-print-file` producerar) för 100 % visuell paritet.
- `src/pages/EditorPage.tsx` (eller där `Canvas3DPreview` anropas) — skicka `bleedCm={0.3}` som ny prop. `depthCm` skickas redan.

### Förväntat resultat
- Front på 3D-vyn = exakt det kunden ser i editorn (ingen wrap-zon synlig på fronten).
- Sidor (vänster/höger/topp/botten) = en sömlös fortsättning av motivets ytterkant, exakt så bred som canvasdjupet (2 eller 4 cm), helt enligt Gelatos canvas-spec.
- Hörn matchar utan glapp eftersom alla faces samplar samma kontinuerliga print-fil.
- 100 % representation av hur den fysiska canvasen ser ut vid leverans.

