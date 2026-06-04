## Mål
Ersätt Replicate `cdingram/face-swap` med Nano Banana 2 (`google/gemini-3.1-flash-image-preview`) för `subjectKind === "human"`. Admin-promptens fritext (`layer.defaults.swapPrompt`) blir den primära instruktionen som beskriver exakt vad som ska bytas ut — på samma sätt som för `pet`. Pet + removeBackground rörs inte.

## Ändringar

### 1. `supabase/functions/replicate-face-swap/index.ts`

Lägg till `runHumanSwap` (parallell till `runPetSwap`) som anropar Nano Banana 2 via befintliga `callNanoBanana`. Prompten är medvetet **minimal scaffold + admin-prompt i centrum**:

```
You are editing image #1. Image #2 is a reference photo provided by the customer.

Follow the artist's instruction below precisely — it describes exactly what
to take from image #2 and how to place it into image #1. Everything in
image #1 that the instruction does not explicitly change must stay
identical (composition, framing, lighting, art style, background, props,
clothing, pose, camera angle, aspect ratio).

Artist instruction:
<layer.defaults.swapPrompt>

Return ONE single edited image (NOT a collage, NOT side-by-side, NOT a
before/after comparison). Output must have the same aspect ratio as image #1.
```

Bilderna skickas i samma ordning som idag (`[referenceImageUrl, faceImageUrl]`) så befintliga prompter som refererar `input_image_1` / `input_image_2` fortsätter funka.

Routing i `Deno.serve`:
```ts
subjectKind === "human" ? runHumanSwap(...)   // ← nytt
                        : runPetSwap(...)
                        : runRemoveBackground(...)
```
`route`-loggvärde: `human-nano-banana`. `modelUsed` blir `ANIMAL_MODEL` (Nano Banana 2) även för human.

`runReplicateFaceSwap` + Replicate-konstanterna får ligga kvar oanvända som snabb rollback (säg till om du vill ha dem borttagna).

### 2. `src/lib/ai-photo-prompts.ts`
Uppdatera `DEFAULT_AI_PHOTO_PROMPTS.human` så default-texten i admin-inspectorn matchar den nya modellen och betonar att admin själv beskriver vad som ska bytas:

> "Take the person's face and head from image #2 and place it onto the person in image #1. Keep image #1's hair style, outfit, accessories, lighting, pose, background and art style exactly. Preserve the customer's facial identity from image #2: facial features, eye color, skin tone, age, expression."

Befintliga mallar berörs inte — de har redan en sparad `swapPrompt` i DB.

### 3. `src/components/editor/AiPhotoSection.tsx`
Justera `expectedSeconds` för human från 8 → 18 (matchar pet, eftersom Nano Banana 2 är långsammare än cdingram). Inget annat klient-API ändras.

## Påverkan
- Inga ändringar i klient-API, response-shape, cache-nycklar, storage-upload eller frontend-flöde i övrigt.
- Pet + removeBackground oförändrade.
- `REPLICATE_API_TOKEN`-secret rörs inte (används fortfarande av `replicate-style`).
- Retry/backoff (4s + 8s) gäller nu även human — en förbättring.

## Verifiering
1. Deploya `replicate-face-swap`.
2. `curl_edge_functions` med human-payload (referensbild + ansiktsbild + admin-prompt) → bekräfta `route=human-nano-banana`, lyckad upload till `print-files`.
3. Test i editor på en befintlig human-mall: skapa AI-bild → ansiktet i kundens bild ska sitta på personen från referensbilden, övrigt oförändrat.