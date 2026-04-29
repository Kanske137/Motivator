## Min analys

Jag har spårat hur kanterna mappas hela vägen: editor → tryckfil (`renderTemplateSnapshot`) → 3D (`Canvas3DPreview` → `CanvasMesh.materials`).

Tryckfilen är korrekt — den läggs ut top-left som
`[bleed | wrap | FRONT | wrap | bleed]` på båda axlarna och samma fil används av både cart-thumbnail, print-pipeline och 3D.

Problemet sitter i **3D-mappningen**. Kommentarerna i `CanvasMesh` om Three.js BoxGeometrys default-UV stämmer inte med faktisk Three.js-källkod, vilket gör att flera flippar går åt fel håll.

### Vad Three.js `BoxGeometry` faktiskt ger (verifierat i `node_modules/three/src/geometries/BoxGeometry.js`)

| Face | U=0 ligger vid | V=0 ligger vid |
|------|----------------|----------------|
| `+Z` front | -X (vänster) | -Y (botten) |
| `+X` höger | **+Z (front)** | -Y (botten) |
| `-X` vänster | **-Z (back)** | -Y (botten) |
| `+Y` topp | -X (vänster) | **+Z (front)** |
| `-Y` botten | -X (vänster) | **-Z (back)** |

Koden i `Canvas3DPreview.tsx` antar motsatsen för +X/-X/+Y/-Y, vilket gör att:

- **Topp** flippas i Y när den inte ska → övre wrap-strippen renderas upp-och-ner mot front-kanten. Det är därför du ser den som "definitivt avvikande".
- **Botten** flippas i Y när den inte ska → spegelvänd, men ofta svår att upptäcka eftersom motiv på bottenkanten är mindre framträdande.
- **Höger/vänster** har också fel flippkonvention i X. Att sidorna "ser nästan rätt ut" beror på att kartor och liknande motiv är ungefärligt symmetriska kring lodlinjen, så en horisontell spegelvändning av ett ~2 cm tunt band syns knappt.

Sömmen mot fronten är vad som gör buggen synligast: när närmaste-pixel-mot-fronten flippas hamnar den motsatta sidan av strippen mot front-kanten, vilket bryter den seamlessa fortsättningen.

## Fix

Endast en fil: `src/components/editor/Canvas3DPreview.tsx`, materials-blocket i `CanvasMesh`.

Korrigera UV-flipparna baserat på faktisk Three.js-konvention:

| Face | flipX | flipY |
|------|-------|-------|
| `+Z` front | nej | nej (oförändrad) |
| `+X` höger | **ja** (var: nej) | nej |
| `-X` vänster | **nej** (var: ja) | nej |
| `+Y` topp | nej | **nej** (var: ja) |
| `-Y` botten | nej | **nej** (var: ja) |
| `-Z` back | n/a (solid neutral) | n/a |

Uppdatera även kommentarerna ovanför varje `make(...)`-anrop så att de speglar faktisk BoxGeometry-mappning, så att framtida ändringar inte introducerar samma misstag.

## Verifiering

Efter ändringen kontrollerar jag i preview att:
1. Översta wrap-strippen fortsätter motivet seamless över front-kanten (testa med en karta som har distinkta gator nära överkanten).
2. Bottenstrippen likadant.
3. Höger/vänster-strippar fortsätter seamless (testa med text eller en marker nära kanten).
4. Inga sidor är upp-och-ner eller spegelvända längre.

Inga andra filer behöver röras — tryckfilen, cart-thumbnailen och admin-previewen är redan korrekta.
