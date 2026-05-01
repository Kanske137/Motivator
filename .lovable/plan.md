## Problem

När en kund kör face-swap (human) får hen tillbaka en bild från Replicate som har **samma dimensioner som referensbilden**. Trots det visas den i editorn med tomma/vita kanter och samma sak hamnar på print-filen.

Orsaken: vi tvingar idag `fit = "contain"` så fort det finns ett AI-resultat, oavsett vilken modell som genererade det.

```ts
// src/components/editor/MapPreview.tsx (rad 402)
const effectiveFit = aiResultUrl ? "contain" : l.defaults.fit;

// src/lib/template-snapshot.ts (rad 629)
const fit = aiResultUrl ? "contain" : layer.defaults.fit;
```

`contain` är rätt val för `removeBackground` (Nano Banana 2 håller inte alltid målad aspect, och dess vita bakgrund smälter in). Men för `human` (Replicate face-swap) och `pet` (Nano Banana 2 med uttrycklig "same aspect ratio as image #1"-instruktion) ska bilden alltid fylla layret precis som referensbilden gjorde — alltså samma `fit` som `layer.defaults.fit` (typiskt `cover`).

## Lösning

Begränsa "tvinga contain"-regeln till **endast** `subjectKind === "removeBackground"`. För `human` och `pet` används layerns `defaults.fit` (samma som referensbilden använder före face-swap), så resultatet fyller layret utan tomma kanter.

### Ändringar

**`src/components/editor/MapPreview.tsx`** (kring rad 393-402)
- Läs `subjectKind` från `l.defaults.subjectKind`.
- Sätt `effectiveFit = (aiResultUrl && subjectKind === "removeBackground") ? "contain" : l.defaults.fit`.

**`src/lib/template-snapshot.ts`** (kring rad 617-631)
- Läs `subjectKind` från `layer.defaults.subjectKind`.
- Sätt `fit = (aiResultUrl && subjectKind === "removeBackground") ? "contain" : layer.defaults.fit`.

Detta är symmetriskt mellan editor-preview och hires-print, så vad kunden ser är vad hen får.

### Varför det räcker

- **Human face-swap (Replicate `cdingram/face-swap`)**: returnerar bilden med exakt samma pixelmått som `input_image` (referensbilden). Eftersom referensbilden redan passar layret enligt `defaults.fit` kommer face-swap-resultatet också göra det.
- **Pet (Nano Banana 2)**: prompten kräver explicit "same aspect ratio as image #1" och dimensions-sanity-checken i edge-funktionen avvisar collage. I praktiken matchar resultatet referensens form, så `defaults.fit` (cover) fyller layret korrekt.
- **removeBackground**: behåller dagens beteende (`contain` + vit padding) — bilden ska aldrig beskäras eftersom motivet redan är inramat med vit halo.

Inga ändringar i edge-funktionen, prompten eller print-pipelinen behövs.

### Filer som ändras

- `src/components/editor/MapPreview.tsx`
- `src/lib/template-snapshot.ts`
