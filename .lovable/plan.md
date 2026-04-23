

## Steg 4: 3D-Canvas Polish

### Mål
Göra `Canvas3DPreview` mer fotorealistisk så canvas-produkten känns lika säljbar som en riktig produktbild — utan att bryta dagens wrap-precision.

### Förbättringar

**1. Realistisk dukväv-textur**
- Lägg en subtil canvas-väv-overlay (procedurell normal map genererad i Three.js, ingen extern asset) på alla sex materialen.
- Använder `MeshStandardMaterial.normalMap` med låg intensitet (~0.15) så trycket fortfarande dominerar men ytan får mikro-relief vid belysning.
- Roughness höjs lätt på sidorna jämfört med fronten (sidorna sträcks mer → mindre reflektion).

**2. Bättre belysning**
- Byt nuvarande två directional lights mot ett **3-punkts-setup**: key (varm framifrån-höger), fill (sval vänster), rim (bakifrån för kantljus).
- Lägg till `Environment preset="apartment"` från `@react-three/drei` för naturliga reflektioner i normal-mappen (väggljus-känsla).
- Mjukare `ContactShadows` (blur 3.2, opacity 0.45).

**3. Vägg-kontext (valfritt på/av)**
- Bakom duken: en stor neutral "vägg"-plan (ljust beige `#ece7df`) med svag vinjettering via radialgradient i bakgrundsfärgen.
- Duken hängs ~0.05 enheter framför väggen så `ContactShadows` projicerar på väggen istället för i luften → "hänger på vägg"-känsla.

**4. Mobil-interaktion**
- Aktivera touch-rotate (OrbitControls fungerar redan, men `enableDamping={true}` + `dampingFactor={0.08}` ger smidigare swipe).
- Auto-rotate i 4 sekunder vid första render, stoppas vid första touch/drag.
- Behåll dagens begränsningar (±45° azimuth, ±45° polar) så kunden aldrig ser baksidan.

**5. Wrap-verifiering**
- Lägg till en synlig "test-grid"-overlay i dev-läge (`import.meta.env.DEV`) som ritar röda linjer på textur-fraktionerna i ett stickprov, så vi kan visuellt bekräfta att fronten är exakt motivzonen och att hörnen är sömlösa.
- Tas bort innan vi går vidare; bara för QA-pass.

### Filer

| Fil | Ändring |
|---|---|
| `src/components/editor/Canvas3DPreview.tsx` | 3-punkts-ljus, Environment, dukväv-normal map, vägg-plan, damping, auto-rotate, dev-grid |
| (ev.) `src/lib/canvas-weave-texture.ts` | NY: procedurell normal-map-generator (DataTexture, ingen fil-asset) |

Inga nya beroenden — `@react-three/drei` har redan `Environment`, `ContactShadows`, `OrbitControls`.

### Verifiering

1. Öppna canvas-produkt i editorn → 3D-vyn visar duken framför en ljus vägg, mjuk skugga under, varm ljussättning från höger.
2. Vid laddning: duken roterar långsamt ~4 s, stannar vid touch.
3. Swipe på mobil: smidig rotation med damping, kan inte rotera till baksidan.
4. Zooma in i webbläsaren: dukväven syns som mikro-relief på ytan när ljuset träffar i vinkel.
5. Hörn mellan front och sidor: sömlösa, ingen pixel-glipa (samma snapshot-pipeline som tryckfilen).
6. Inget regression i wrap-mappningen — fronten visar motivet, sidorna visar wrap-zonen, baksidan är neutral fabric.

### Arbetsordning

1. Lägg till Environment + 3-punkts-ljus → ta screenshot-jämförelse.
2. Generera procedurell väv-normal-map → applicera på materialen.
3. Lägg in vägg-plan + uppdaterade ContactShadows.
4. Touch-damping + auto-rotate.
5. Dev-grid QA-pass på 30×40, 50×70, 60×90 i både porträtt och landskap; ta bort grid.

