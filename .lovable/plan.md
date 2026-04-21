

## Plan: Fixa stora storlekar, canvas top/bottom-wrap, förenkla 3D-vy

### Problem 1 — Cirkel "outstretched" för stora storlekar (≥70×100, 60×80)
I `editor-snapshot.ts` cappas bredd och höjd separat med `Math.min(1600, ...)`. För 70×100 cm blir resultatet `1600×1600` istället för proportionerligt → poster-canvasen blir kvadratisk i pixlar trots `posterAspect = 0.7`. När `MockupGallery` visar bilden i editorns aspect-ratio-ram sträcks pixlarna och cirkeln ser outstretched ut.

**Fix:** Skala uniformt så att största sidan = 1600 och bevara aspect:
```ts
const MAX_PX = 1600;
const longest = Math.max(wCm, hCm) * PX_PER_CM;
const scale = longest > MAX_PX ? MAX_PX / longest : 1;
const w = Math.round(wCm * PX_PER_CM * scale);
const h = Math.round(hCm * PX_PER_CM * scale);
```

### Problem 2 — Canvas top/bottom wrappas inte runt kanten
På 3D-förhandsvisningen syns sidorna (left/right) wrappade korrekt med en 3% bleed från printens vänster/höger-kant. Top och bottom-faces däremot visar **inte alls** ett wrap-innehåll som fortsätter från frontens över-/underkant — de ser ut som platta strippar utan kontinuitet med fronten.

**Grundorsak:** I `Canvas3DPreview.tsx` `make()`-funktionen byggs top/bottom-strippar med rätt källpixlar (`iw × ih*bleed`), MEN `BoxGeometry`'s default-UV på top (+Y) och bottom (-Y) faces går i en annan orientering än vad strippens långa sida förväntar sig. Konsekvensen är att Three.js stretchar/komprimerar strippen längs box-djupet (Z-axeln) på fel ledd, så att en **stor del av strippen** (t.ex. centrum av printens överkant) hamnar utanför den synliga ytan eller tappar sin koppling till frontens överkant där betraktaren möter wrap-sömmen.

**Fix:** Gör så att top/bottom-textures verkligen "fortsätter" från fronten:
1. **Korrekt UV-orientering på top/bottom-materials.** Istället för att rotera bitmappen via canvas, sätt `texture.center = (0.5, 0.5)`, `texture.rotation` och `texture.repeat` på materialets `map` så att strippens långa sida (printens fullbredd) ligger längs box X-axeln och strippens korta sida (bleed-höjden) ligger längs box Z-axeln (djupet).
2. **Vänd V-axeln på bottom** så att kanten närmast fronten är pixelraden närmast frontens nederkant: `bottomMap.repeat.set(1, -1); bottomMap.offset.set(0, 1)`. För top: säkerställ att kanten närmast fronten är pixelraden närmast frontens överkant (testa `repeat.set(1, 1)` först, annars flippa).
3. **Använd `THREE.ClampToEdgeWrapping`** på alla edge-textures för att undvika att Three.js samplar mörka pixlar utanför bleed-strippen.
4. **Verifiera bleed-bredd:** öka `bleed` från `0.03` till `~depthCm/widthCm` så strippens fysiska längd matchar boxdjupet (t.ex. 4cm djup på 30cm bred → bleed ≈ 0.13). Annars syns strippens innehåll bara i ~3% av djupet och resten blir tomt/förvrängt — det är troligen det användaren upplever som "wrappas inte".

### Problem 3 — Canvas 3D-vy: en stor box istället för 4 thumbnails
- Ta bort `PRESETS`-arrayen och thumbnail-galleriet i `Canvas3DPreview.tsx`.
- Rendera EN stor `<Canvas>` direkt i sektionen, höjd `min(60vh, 520px)`, full bredd, rubrik **"3D-förhandsvisning"**.
- Kameraposition: `[0, 0, 3.6]`, `fov: 35` — utzoomat så hela canvasen precis får plats.
- `OrbitControls`:
  - `enablePan={false}`
  - `enableZoom={false}` (låst zoom)
  - `minPolarAngle={Math.PI/2 - Math.PI/4}` / `maxPolarAngle={Math.PI/2 + Math.PI/4}` (±45° pitch)
  - `minAzimuthAngle={-Math.PI/4}` / `maxAzimuthAngle={Math.PI/4}` (±45° yaw)
- Ta bort lightbox + navigeringspilarna helt.

### Filer som ändras
- `src/lib/editor-snapshot.ts` — uniform skalning för stora format.
- `src/components/editor/Canvas3DPreview.tsx` — korrekt UV-orientering + bleed-bredd för top/bottom-wrap; ersätt galleri med en enda stor 3D-vy med ±45° rotation och låst zoom.

### Förväntat resultat
- 70×100 poster och 60×80 / 70×100 canvas visar korrekt cirkel utan stretch.
- Canvas top och bottom visar ett synligt wrap-innehåll som fortsätter från frontens över- och underkant runt kanten — inte längre platta tomma strippar.
- Canvas 3D-sektionen visar EN box "3D-förhandsvisning", utzoomad så hela duken syns, fri rotation ±45° i alla riktningar, ingen zoom.

