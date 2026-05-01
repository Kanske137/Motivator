# Närbilds-thumbnails för poster och canvas

## Kort svar: Ja, det är fullt görbart — och det kan bli riktigt snyggt.

Båda effekterna kan renderas helt på klienten i `<canvas>` med samma `snapshotUrl` vi redan har (multi-layer hi-res print). Inget extra API behövs. Stilen i dina referensbilder (Gelato/Printful product shots) går att efterlikna med standard 2D-canvas + perspektivtransform + mjuk slagskugga.

Realismen blir hög för posters (enkel 2D-tilt). För canvas blir det "very good but stylized" — vi simulerar djupet trovärdigt men det är inte en fysisk render. För det användningsfallet (liten närbilds-thumbnail) räcker det väl.

---

## Vad som byggs

En ny scen-typ `productShot` som kör direkt på `snapshotUrl` istället för att kompositera in i ett rumsfoto. Två varianter:

### 1. Poster — "paper corner"
- Vit/ljusgrå bakgrund (matchar din referensbild).
- Postern roterad ~6–8° och tiltad i perspektiv så nedre-högra hörnet sticker ut mot betraktaren.
- Mjuk slagskugga under papperet + lätt papperstextur-overlay (subtil) för känsla.
- Bilden beskärs så bara ~40–50% av postern syns (närbild på hörnet).

### 2. Canvas — "wrap corner"
- Vit bakgrund.
- Visar fram-ytan + höger sidopanel + (lätt) undersida, sett från snett ovan/höger så djupet syns tydligt.
- Sidopanelens innehåll = wrap-zonen från `snapshotUrl` (vi har redan extended print med `wrapCm` + `bleedCm` i snapshotten — höger ~wrap-cm av bilden mappas till sidan).
- Djupet i pixlar skalas från `canvasDepthCm` (2 eller 4 cm), så 4cm-canvas syns tydligt tjockare än 2cm.
- Mjuk slagskugga + subtil duk-textur-overlay på fronten.
- Hörnvecket (mitre fold) ritas som tunn mörk linje, likt din canvas-referens.

Båda visas som första slot i thumbnail-raden ("Närbild"), och fungerar i lightbox precis som befintliga scener.

---

## Tekniska detaljer

**Ny fil:** `src/lib/product-shot.ts`
- `renderPosterCornerShot({ printUrl, orientation, sizeCm }) → dataUrl`
- `renderCanvasCornerShot({ printUrl, orientation, sizeCm, depthCm, wrapCm, bleedCm }) → dataUrl`

Båda returnerar JPEG dataURL precis som `compositeMockup`, så `MockupGallery` kan behandla dem som vanliga slots.

**Poster-rendern** (steg):
1. Rita vit/off-white bakgrund (1024×1024).
2. Beräkna fyra hörnpunkter för en tiltad rektangel (perspektiv-trapets) där nedre-högra hörnet är närmare och större.
3. Använd canvas `setTransform` + segmenterad rasterisering (rita i ~30 horisontella band med interpolerade x-positioner) för att approximera perspektivet — samma teknik som befintlig `mockup-composite.ts` använder för canvas-wrap.
4. Slagskugga via offset + blur innan trycket ritas.
5. Subtil papperstextur (procedural noise) ovanpå med `multiply`/låg opacitet.

**Canvas-rendern** (steg):
1. Vit bakgrund.
2. Beräkna front-trapets + höger-sido-trapets utifrån `depthCm / sizeCm` (sidans synliga bredd i pixlar).
3. Front: rita "front-zonen" av snapshotten (snapshotten innehåller redan wrap+bleed runt hela kanten — vi måste skära ut den centrala front-rektangeln). Front-zonens fraction = `frontCm / (frontCm + 2*(wrapCm+bleedCm))`.
4. Höger sida: rita höger-strippan av snapshotten (bredd = `(wrapCm+bleedCm)/total`) in i höger-sido-trapetset, med skew + lätt mörkning (gradient).
5. Hörnveck-linje + slagskugga + duk-textur-overlay.

**MockupGallery**: lägg till två "syntetiska" scener (`product-shot-poster` och `product-shot-canvas`) som hanteras separat från `getScenesFor`. För canvas-fallet: ersätt nuvarande beteende där canvas hoppar över scen-galleriet helt — istället visas Canvas3DPreview överst (oförändrad) PLUS en thumbnail-rad med `product-shot-canvas` (och eventuellt fler vinklar senare). Alternativt lägger vi product-shot:en bredvid 3D-previewen.

**Beroenden av befintlig kod som bekräftar att det fungerar:**
- `snapshotUrl` finns redan för båda produkttyper (`MockupGallery.tsx` rad 62–88).
- För canvas innehåller `renderTemplateSnapshot` redan extended print (`wrapCm + bleedCm`), så vi vet exakt var "front-zonen" ligger i bilden.
- Perspektiv-trapets-rendering finns redan beprövad i `mockup-composite.ts` (canvas top + side wrap-strippor) — vi återanvänder samma teknik.

---

## Varför det blir bra

- Närbilden visar **faktiskt tryckmaterial** (papper/duk-känsla) snarare än ett miljöfoto, vilket exakt är vad referensbilderna kommunicerar.
- Canvas-djupet uppdateras automatiskt med variant (2cm vs 4cm) eftersom `canvasDepthCm` redan finns i state.
- Sidoinnehållet stämmer med faktiska wrap-pixlarna — kunden ser vad som faktiskt hamnar på sidan.
- Inget nätverk, ingen extra latens — körs i samma debounce som övriga thumbnails.

## Risker / begränsningar

- Canvas-rendern är 2D-perspektiv, inte riktig 3D. Den ser bra ut i thumbnail-storlek och i lightbox, men en granskande blick ser att det inte är en fotograferad render. För kunden som redan har `Canvas3DPreview` som huvudvy är detta acceptabelt.
- Texturerna (papper/duk) blir procedurala. Om du senare vill ha foto-realistisk textur kan vi byta till en PNG-overlay.

## Filer som ändras / skapas

- **Ny:** `src/lib/product-shot.ts` — rendrarna.
- **Ändras:** `src/components/editor/MockupGallery.tsx` — lägg in product-shot som första slot för poster, och visa under Canvas3DPreview för canvas.
- **Ev. ändras:** `src/lib/mockup-scenes.ts` — exportera två syntetiska scen-id för konsistens.
