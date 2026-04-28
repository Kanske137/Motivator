## Mål

1. **Förenkla "Motiv"-listan** för aiPhoto-lager:
   - **Människa** — Replicate `cdingram/face-swap` (oförändrat).
   - **Hund / Katt** — gemensam rad, Nano Banana 2 (oförändrat).
   - **Ta bort bakgrund** — NY. Ingen referensbild. Tar bort bakgrunden runt motivet och adderar en lekfull akvarell-/prick-effekt runt motivet (i stil med uppladdade exemplet).
   - `"other"` tas bort.

2. **Stilval för "Ta bort bakgrund"**: Kunden ska kunna välja en stil från templatets befintliga `productOptions.aiStyles` (samma lista admin redan kurerar via `enabled`-flaggan i AI-stilar-sektionen). Bakgrunden måste ALLTID vara borttagen, oavsett stil.

3. Befintliga lager med `subjectKind` `"cat" | "dog" | "other"` mappas vid inläsning till nya `"pet"`.

## Schema (`src/lib/template-schema.ts`)

```ts
export const aiPhotoSubjectKindSchema = z.enum([
  "human",
  "pet",
  "removeBackground",
]);
```

`referenceImageUrl` förblir optional. Validering sker i edge function (krävs för human/pet, krävs INTE för removeBackground).

## Migrering (`src/lib/template-migrate.ts`)

On-read-mappning: `"cat" | "dog" | "other"` → `"pet"`. Ingen DB-migrering.

## Admin (`LayerInspector.tsx`)

- "Motiv"-dropdown: Människa / Hund-Katt / Ta bort bakgrund.
- När `removeBackground` valts:
  - Referensbild-rutan döljs (eller ersätts med info "Behövs ej — bakgrunden tas bort från kundens egen bild").
  - Prompt-fältets default beskriver färg-/stilpreferens för prick-effekten ("Default: varma jordtoner. Skriv här om du vill ha t.ex. blå/rosa toner eller fler/färre prickar").
  - Admin uppmärksammas på att kunden kommer att se de aktiverade AI-stilarna (`productOptions.aiStyles` med `enabled`) ovanpå borttagen bakgrund.

## Customer-UI (`AiPhotoSection.tsx`)

- `SUBJECT_HINT` uppdateras (human / pet / removeBackground).
- För `removeBackground`:
  - Hoppa över `if (!refUrl)`-checken.
  - Cache-nyckel använder `"no-ref"` istället för `refUrl`, plus den valda style-presetens id (se nedan).
  - **Ny stilrad** ovanför "Skapa nu"-knappen, synlig endast när `subjectKind === "removeBackground"` och templatet har minst en aktiverad `aiStyle`:
    - Visar samma thumbnails som `AiStyleSection` (filtrerat på `enabled !== false`).
    - Ett extra "Ingen stil"-val (default) som bara tar bort bakgrund och lägger på prick-effekten utan stilförändring av motivet.
    - Vald preset lagras lokalt i komponentens state, t.ex. `selectedStyleId`.
    - Skickas vidare till edge functionen i `body` som `removeBackgroundStyleId` + `removeBackgroundStylePrompt` (preseten's `prompt`).
  - Cache-nyckel = `${hash}::removeBg::${selectedStyleId ?? "none"}` så olika stilar cachas separat.

## Edge function (`supabase/functions/replicate-face-swap/index.ts`)

Ny route:

```ts
const route =
  subjectKind === "human"            ? "human-replicate"
: subjectKind === "pet"              ? "pet-nano-banana"
: subjectKind === "removeBackground" ? "remove-bg-nano-banana"
:                                      "human-replicate";
```

- **`human-replicate`**: oförändrad.
- **`pet-nano-banana`**: använder dagens `runAnimalSwap`, prompten generaliseras till "the pet".
- **`remove-bg-nano-banana`** (NY) — `runRemoveBackground`:
  - Anropar Nano Banana 2 (`google/gemini-3.1-flash-image-preview`) via Lovable AI Gateway.
  - Skickar ENDAST `faceImageUrl` (kundens bild).
  - Bygger prompt i två lager:

    **A. Ovillkorlig bakgrunds-/prick-instruktion (alltid):**
    ```
    Edit the input photo: isolate the main subject (person or pet) and
    completely remove the original background. Place the subject on a clean
    white backdrop. Add a soft, artistic ring of small colorful watercolor
    dots and gentle paint splatters AROUND the subject (never covering the
    face/body). Keep the subject's identity, face, eyes, fur/skin and
    proportions exactly as in the input. Return ONE single edited image,
    same aspect ratio as the input. No collage, no side-by-side.
    ```

    **B. Stillager (om `removeBackgroundStylePrompt` finns):**
    ```
    Apply the following artistic style to the SUBJECT itself (not to the
    background — the background must remain a clean white backdrop with
    the colorful dot/splatter ring described above):
    <preset.prompt>
    ```

    **C. Admin's egen `swapPrompt`** läggs sist som "Additional artist guidance" (t.ex. färgton för prickarna).

  - Validerar dimensioner (samma som idag) och laddar upp till `print-files`.

- Validering vid request-start:
  - `human` / `pet` → `referenceImageUrl` krävs (400 annars).
  - `removeBackground` → bara `faceImageUrl` krävs.

- Loggar ny route + ev. `removeBackgroundStyleId`.

## Default-prompts (`src/lib/ai-photo-prompts.ts`)

Nya entries:
- `human` — oförändrad.
- `pet` — generisk djurversion (täcker hund + katt).
- `removeBackground` — kort hint åt admin: "Default: varma jordtoner runt motivet. Skriv här för att ändra t.ex. färgton eller mängd prickar. Stilen för själva motivet styrs av AI-stilar-sektionen."

## Cache (`src/lib/face-swap-cache.ts`)

Bumpa `STORAGE_KEY` `v4` → `v5`. Cache-key för removeBackground inkluderar style-id (se ovan).

## Filer som ändras

- `src/lib/template-schema.ts`
- `src/lib/template-migrate.ts`
- `src/lib/ai-photo-prompts.ts`
- `src/components/admin/LayerInspector.tsx`
- `src/components/editor/AiPhotoSection.tsx` (lägg till stilväljare för removeBackground)
- `src/lib/face-swap-cache.ts` (v5)
- `supabase/functions/replicate-face-swap/index.ts` (ny route + `runRemoveBackground`)

Inga DB-migrationer, inga nya secrets, inga ändringar i `AiStyleSection.tsx` (vi återanvänder bara presets-listan från templatet).

## Förväntad effekt

- Renare admin-val (3 logiska val).
- Nytt "Ta bort bakgrund"-läge som matchar din uppladdade hundbild — med prick-/akvarell-effekt.
- Kunden kan kombinera bakgrundsborttag med vilken aktiverad AI-stil som helst, men bakgrunden förblir alltid borttagen tack vare att stilinstruktionen explicit avgränsas till motivet i prompten.
