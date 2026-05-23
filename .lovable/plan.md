# Orienteringsmedvetna AI-referensbilder

## Problem
På `aiPhoto`-lager (människa/hund-katt) har vi nu lagt upp separata referensbilder för porträtt och landskap. Kundfronten visar dock alltid första bilden i listan (= porträtt) även när kunden växlar till landskap. Vi behöver:

1. Att rätt referensbild visas automatiskt när orientering byts.
2. Att face-swappade resultat per orientering finns kvar — så ett byte fram och tillbaka återanvänder tidigare swap.

## Lösning

### 1. Schema — tagga referensbilder med orientering
`src/lib/template-schema.ts` → `aiPhotoDefaultsSchema.referenceImages[i]`:
- Lägg till `orientation: z.enum(["portrait","landscape","any"]).default("any")`.
- "any" = visas i båda (bakåtkompatibelt för befintliga mallar).

### 2. Admin — välj orientering per referens
`src/components/admin/LayerInspector.tsx` → `AiPhotoDefaultsSection`:
- Lägg till en liten Select (Porträtt / Landskap / Båda) per referenskort, bredvid etikettfältet.
- Skriver tillbaka via `updateDefaults({ referenceImages: ... })`.
- Ingen ändring i upload-flödet.

### 3. Kund — auto-välj orienteringsmatchande referens
`src/components/editor/AiPhotoSection.tsx`:
- Läs `orientation` från `useEditorStore`.
- Beräkna `orientedRefs = referenceImages.filter(r => r.orientation === orientation || r.orientation === "any" || !r.orientation)`.
- Subject-pickern (3-grid) visar endast `orientedRefs`. `showSubjectPicker = orientedRefs.length >= 2`.
- Healing-effekten (sätter default ref) ska köras både när listan ändras **och när `orientation` ändras**: om nuvarande valda ref inte finns i `orientedRefs`, byt till `orientedRefs[0]`.
- `refUrl` resolvas alltid från `orientedRefs` (fallback `referenceImages[0]?.url` endast om listan är tom — då motsvarar dagens beteende).

### 4. Caching — inget extra jobb
Face-swap-cachen är redan keyad på `(layerId, faceHash, refUrl)` (se `editorStore.addFaceSwapToCache` + `face-swap-cache.ts`). Eftersom porträtt- och landskapsbilderna har olika `refUrl`:
- Switch till landskap utan tidigare swap → visar landskapets oswappade referens (befintlig logik i useEffect som rensar `aiPhotoResult` om ingen cache finns).
- Switch tillbaka till porträtt → cachen för porträtt-refUrl träffar → tidigare swappad porträttbild visas direkt.
- Per mall: cachen lagras i localStorage globalt men är keyad på `layerId` (UUID unikt per mall-lager), så ingen kollision mellan mallar.

### 5. Migrering
Befintliga referensbilder saknar `orientation` → defaultar till `"any"` via Zod, så de fortsätter visas i båda orienteringarna utan admin-ingrepp. Adminen kan i efterhand sätta "Porträtt" på en och "Landskap" på den andra för aktuella mallar.

## Tester / verifiering
- Ladda mall med 1 porträtt-ref + 1 landskap-ref, ladda upp ansikte, kör swap i porträtt, byt till landskap → oswappad landskapsreferens visas, knapp "Skapa".
- Kör swap i landskap, byt till porträtt → tidigare porträtt-swap dyker upp utan ny anrop.
- Mall med endast `"any"`-referenser → oförändrat beteende.

## Påverkas inte
- Edge function `replicate-face-swap`, snapshot/print-pipeline, removeBackground-flödet, stilväljaren, hashing.
