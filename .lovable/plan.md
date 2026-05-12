## Problem
AI-bilden i mallen *Födelsetavla* misslyckas alltid med "Bilden kunde inte skapas, försök igen". Logsen från `replicate-face-swap` visar:

```
[face-swap] AI gateway error 400 {"type":"bad_request","message":"Invalid request body","details":""}
[face-swap] fallback: ... (after 3 attempts)
```

Jag testade Lovable AI-gatewayen direkt med både den minimala dokumenterade payloaden och flera olika modeller (`gemini-3.1-flash-image-preview`, `gemini-2.5-flash-image`, `gemini-3-flash-preview`, `gpt-5-nano`, `gemini-2.5-flash`):

- Alla returnerar `400 {"type":"bad_request","message":"Invalid request body","details":""}`.
- Med en ogiltig nyckel får man istället `401 "Invalid API key format"`, så vår nyckel passerar auth — men något i workspace-/nyckelstatus får gatewayen att avvisa varje body med en tom feldetalj.
- Detta är **inte** ett 402 (krediter slut) eller 429 (rate-limit), och det är **inte** ett valideringsfel i vår payload (samma fel oavsett vilken modell eller payload).

Slutsats: nuvarande `LOVABLE_API_KEY` är i ett brutet/inaktivt tillstånd hos gatewayen. Felet ligger inte i mallen "Födelsetavla" eller i edge-funktionens kod.

## Plan

1. **Rotera `LOVABLE_API_KEY`** med `ai_gateway--rotate_lovable_api_key`. Detta byter ut secreten som både edge-funktionen `replicate-face-swap` och övriga AI-anrop använder.
2. **Verifiera direkt mot gatewayen** med ett curl-test (`google/gemini-2.5-flash`, "hi") — förvänta `200` med ett `choices[0].message`.
3. **Återprov i editorn** för mallen *Födelsetavla* med samma kund-bild som i loggen för att bekräfta att `[face-swap] start ... succeeded` syns och att den genererade bilden visas i editorn.
4. **Om gatewayen fortfarande returnerar 400 efter rotering** (osannolikt) — felet ligger då på Lovable-sidan; jag öppnar en supportnotis och föreslår att kontakta `support@lovable.dev`. Vi rör inte koden i `replicate-face-swap`.

## Vad jag INTE ändrar
- Ingen kod i `supabase/functions/replicate-face-swap/index.ts` (payloaden är korrekt enligt aktuell dokumentation).
- Ingen ändring i `AiPhotoSection.tsx` eller mallens AI-stilar — beteendet återställs av nyckelroteringen.
