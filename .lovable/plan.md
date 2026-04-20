

## Plan: Identisk poster + riktig canvas-3D

### Problem 1: Mockup matchar inte editor
`generate-print-file` anropas i `MockupGallery` med endast `{styleId, center, zoom, size, orientation, text, textFont}`. Editorn (`MapPreview`) använder dessutom: `mapShape`, `posterBgColor`, `showLabels`, `textVisible`. Print-filen ignorerar dessa → mockup visar fel innehåll (fel bakgrund, fel form, text som inte ska synas, etc).

### Problem 2: Canvas saknar riktigt 3D
Nuvarande `canvasWrap` ritar bara en mörk strip på höger sida + skuggad skew. Det finns ingen verklig wrap-känsla: ingen topp/botten-kant, ingen sidoyta som faktiskt visar bildens kantpixlar wrappade runt ramens djup, ingen riktig perspektiv-transform.

### Lösning

**1. Synka print-fil med editorns fullständiga state**
- Uppdatera anropet i `MockupGallery.tsx` så ALLA editor-fält skickas: `mapShape`, `posterBgColor`, `showLabels`, `textVisible`, plus existerande
- Uppdatera `supabase/functions/generate-print-file/index.ts` så den faktiskt använder dessa: applicera bakgrundsfärg på hela canvasen, klippa kartan enligt `mapShape` (rect/square/circle), skicka `showLabels` till Mapbox static-URL, hoppa över text om `textVisible=false`
- Resultat: mockup-postern är pixel-identisk med editorns preview

**2. Bygg om canvas-wrap till riktig 3D**
Ersätt nuvarande "skugg-strip" med korrekt wrap-rendering i `mockup-composite.ts`:

- **Frontyta**: postern ritas rakt (ingen skew) i `area`
- **Höger sidokant**: ett trapets med perspektiv som visar de yttersta ~3% av bildens högerkant, sträckt över djupet (`canvasDepthCm`). Detta är vad Gelato faktiskt gör — bilden wrappas fysiskt runt ramen [Gelato docs: bleed = 8mm extra bild per sida för wrap]
- **Topp-kant**: tunn trapets ovanför som visar översta ~3% av bildens överkant, wrappad. Behövs för scener i lätt vinkel
- **Skuggning**: subtil gradient på sidokanten (mörkare mot baksidan) — inte en svart overlay
- **Vinkel**: använd scenens `canvasWrap.angleDeg` för att beräkna sidokantens synliga bredd via `sin(angle) * depthPx` och topp-höjd via `cos`
- **Ingen skew på frontytan** — det förvrängde innehållet utan att lägga till djup
- **Canvas-scener uppdateras** med större `angleDeg` (12-25°) på diagonal-vyn så wrap blir tydligt synligt

Tekniskt:
```
frontRect: ritas plant
sideQuad:  4-punkts trapets (clip + drawImage med source-rect = 
           bildens högra 3%, dest = trapets-bbox, sedan transform)
topQuad:   samma princip för översta 3%
```

Eftersom canvas 2D inte har äkta 4-punkts perspektiv används approximation: clip-path som trapets + `setTransform` med skew som matchar trapetsens vinklar. Tillräckligt övertygande för mockups.

**3. Bleed-medvetenhet**
Print-filen genererar redan tryck-storleken. För canvas: säkerställ att de yttersta ~2-3% används som wrap-källa (motsvarar Gelatos 8mm bleed på t.ex. 30cm bredd ≈ 2.7%). Inget extra bleed behöver renderas — vi samplar från den befintliga bilden.

### Filer som ändras
- `supabase/functions/generate-print-file/index.ts` — stöd för `mapShape`, `posterBgColor`, `showLabels`, `textVisible`
- `src/components/editor/MockupGallery.tsx` — skicka alla editor-fält till print-funktionen
- `src/lib/mockup-composite.ts` — riktig wrap-rendering (front + sida + topp), ta bort skew på front
- `src/lib/mockup-scenes.ts` — justera `angleDeg` för canvas-scener så 3D syns tydligt

### Förväntat resultat
- Mockup = exakt det editorn visar (form, bakgrund, text, etiketter, allt)
- Canvas ser ut som en faktisk 3D-duk med synlig sida där bildens kant wrappas runt djupet — inte en platt poster med skugg-strip
- Skillnad mellan 2cm och 4cm djup syns tydligt på sidokanten

