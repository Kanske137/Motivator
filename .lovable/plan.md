# Minne av tidigare AI-resultat per uppladdad bild

## Mål
När kunden har laddat upp en bild i ett AI-lager ska varje stil/preset-knapp i Förvandling-fliken visa miniatyren av det **cachade resultatet** (om det finns) istället för standard-thumbnailen. Klick = lagret uppdateras direkt utan ny generering. Cache är localStorage, knuten till fil-hashen, så samma uppladdning får tillbaka sin historik även efter sidladdning.

## Nuläge
- `AiStyleSection` (vanligt foto-lager med AI-stil) **gör redan exakt detta**: hashar filen, cachar per `(photoHash, presetId)`, visar ✓-badge på körda presets och en "Dina provade stilar"-rad. Inget behöver göras där.
- `AiPhotoSection` (face-swap human/pet + background-removal med style-presets): cachar i `face-swap-cache.v5` per `(layerId, faceHash, refSlot)` där `refSlot` redan kodar style-id för removeBackground. Men UI:t visar bara standard-thumbnail på preset-knapparna och har ingen historik-rad.
- `MultiFaceUploadSection` / `multi-face-cache`: cachar per slot-kombination men har ingen UI-historik.

## Vad som byggs

### 1. `AiPhotoSection` — preset-knappar visar cachat resultat
I sektionen "Välj stil" (removeBackground, `visibleStyles.length > 1`):
- För varje preset `p`, slå upp `getCachedFaceSwap(layer.id, source.hash, refSlotFor("removeBackground", null, p.id))`.
- Om träff → rendera `<img src={cachedUrl}>` istället för `p.thumbnailUrl`, lägg på `ring-2 ring-primary` när det är den aktiva (matchar `result`), och visa ✓-badge i hörnet.
- Klick på en preset med cache: kör `applyStyle`-flödet oförändrat — `runSwap` har redan cache-träff-grenen som sätter resultatet direkt utan att anropa edge-funktionen.
- Etiketten (`p.label`) ligger kvar längst ner som idag.

### 2. `AiPhotoSection` — subjekt-väljaren (human/pet, flera referenser)
Samma idé: om det finns en cachad swap för `(layer.id, faceHash, refUrl)` så används den som thumbnail på subjekt-knappen istället för admin-referensen, med ✓-badge. Befintlig effekt som auto-byter `result` när man väljer subjekt fungerar redan.

### 3. `MultiFaceUploadSection` — historik-rad (lättviktig)
Multi-face har inga "presets" att hänga thumbnails på (cachen är per slot-kombination, inte per stil). Vi lägger till en horisontell "Tidigare versioner"-rad under genereringsknappen som listar alla `MultiFaceCacheEntry` vars `layerId` matchar — klick återanvänder URL:en direkt (samma `setResult`-flöde). Tom-state visas inte.

### 4. Inga schema- eller backend-ändringar
All cache är redan på plats i localStorage (`face-swap-cache.v5`, `multi-face-cache.v1`, `aiResultCache` i editorStore). Inget edge-funktionsanrop, ingen ny tabell, ingen ny endpoint.

## Filer som ändras
- `src/components/editor/AiPhotoSection.tsx` — visa cachad URL i preset-thumbnailen + subjekt-thumbnailen, lägg till ✓-badge. ~30 rader.
- `src/components/editor/MultiFaceUploadSection.tsx` — läs cache-tabellen, rendera historik-rad. ~25 rader.
- `src/stores/editorStore.ts` — exponera en liten `listFaceSwapsForLayer(layerId, faceHash)`-helper om det förenklar (annars läs `faceSwapCache` direkt i komponenten, samma mönster som `aiStyleSection` redan gör med `aiResultCache`).
- `src/i18n/locales/sv.json` (+ alla språkfiler) — nya nycklar: `aiPhoto.previousVersions`, `aiPhoto.reused`. Översätts till `en/de/no/da/fi/fr/es/it/nl/pl`.

## Inte i scope
- Ingen ändring av `replicate-face-swap`, `replicate-style`, `multi-face-swap` edge-funktioner.
- Ingen ändring av cache-nycklar eller TTL.
- Ingen "rensa allt"-knapp (tar ✗ per entry följer befintligt mönster om vi vill, men inte krav nu).

## Verifiering
1. Bilposter: ladda upp en bild, kör Pop-art → ladda om sidan → ladda upp samma bil → preset-knappen "Pop-art" visar nu bilen i pop-art-stil med ✓.
2. Födelseposter (face-swap pet med två referenser): kör swap på Hund A → byt till Hund B → byt tillbaka — thumbnailen för Hund A visar det swappade resultatet, inte admin-referensen.
3. Husposter (multi-face): generera → ladda om → historik-raden visar tidigare resultat och klick återställer.
4. Regress: vanligt foto-lager med AI-stil (AiStyleSection) ska se identiskt ut med idag.
