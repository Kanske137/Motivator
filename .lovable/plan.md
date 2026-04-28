## Mål

Behåll nuvarande `cdingram/face-swap` (Replicate) för **människor** — den fungerar bra. För **katt och hund** routea till en annan modell som hanterar djur bättre.

## Modellval för djur

Två rimliga alternativ undersöktes:

1. **`fofr/become-image` (Replicate)** — designad för "låt den här personen bli den här bilden", använder IP-Adapter med två inputbilder. Fungerar tekniskt även för djur men är primärt person-tränad.

2. **Nano Banana 2 / `google/gemini-3.1-flash-image-preview` via Lovable AI Gateway** ✅ rekommenderas
   - Stark identitetsbevaring vid multi-image edits.
   - Naturlig prompt: "Use the dog's face from the second image and place it on the dog in the first image".
   - Behöver ingen extra API-nyckel — `LOVABLE_API_KEY` finns redan.
   - Snabbt och billigt jämfört med dedikerade Replicate-modeller.
   - Officiellt stödd via Lovable AI.

Jag väljer **Nano Banana 2** för katt/hund.

## Implementationsplan

1. **Edge function `replicate-face-swap/index.ts`**
   - Behåll `cdingram/face-swap` när `subjectKind === "human"` (och som fallback).
   - För `subjectKind === "cat" | "dog" | "other"`: anropa Lovable AI Gateway med `google/gemini-3.1-flash-image-preview`.
   - Skicka båda bilderna som `image_url` content parts:
     - Bild 1 = `referenceImageUrl` (scen att behålla)
     - Bild 2 = `faceImageUrl` (ansikte att överföra)
   - Använd en explicit svensk-/engelsk prompt anpassad efter `subjectKind` ("dog"/"cat") och inkludera ev. `swapPrompt` från admin.
   - Parsea bildoutput från Gateway-svaret (base64 i `choices[0].message.images[].image_url.url`), spara till `print-files`-bucket precis som nu.
   - Behåll samma response-shape: `printFileUrl`, `replicateOutputUrl` (här blir det internt eller utelämnas), `usedReferenceImageUrl`, `usedFaceImageUrl`, plus `modelUsed`.
   - Behåll dimension-sanity-check (bredd/höjd-ratio).
   - Hantera 402/429-fel från Lovable AI med vänliga svenska felmeddelanden.

2. **Cache**
   - Bumpa `STORAGE_KEY` i `src/lib/face-swap-cache.ts` från `v3` → `v4` så gamla djur-resultat invalidiers.

3. **Loggning**
   - Logga vilken modellroute som valdes (`route=human-replicate` eller `route=animal-nano-banana`) och token usage för djur-vägen.

4. **Inga UI-ändringar** krävs — `subjectKind` finns redan på layern och kunden ser samma flöde.

## Tekniska detaljer

Nano Banana 2 kallas via Lovable AI Gateway med:

```text
POST https://ai.gateway.lovable.dev/v1/chat/completions
Authorization: Bearer ${LOVABLE_API_KEY}

{
  "model": "google/gemini-3.1-flash-image-preview",
  "messages": [
    { "role": "user", "content": [
      { "type": "text", "text": "<svensk/engelsk prompt med subjectKind>" },
      { "type": "image_url", "image_url": { "url": referenceImageUrl } },
      { "type": "image_url", "image_url": { "url": faceImageUrl } }
    ]}
  ],
  "modalities": ["image","text"]
}
```

Svaret innehåller en bild som base64 data URL — den dekodas, valideras dimensionsmässigt och laddas upp till `print-files` precis som dagens flöde.

## Filer som ändras

- `supabase/functions/replicate-face-swap/index.ts`
- `src/lib/face-swap-cache.ts`

Inga DB-migrations, inga nya secrets, ingen ny UI.

## Förväntad effekt

Bättre swaps för hund och katt eftersom Nano Banana 2 är en modern multi-image edit-modell med stark identitetsförståelse, medan `cdingram/face-swap` (som är tränad på människor) lämnas orörd där den fungerar bra.