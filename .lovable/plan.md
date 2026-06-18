# Två separata buggar bekräftade i loggarna

## 1. "Vi kunde inte skapa bilden just nu" trots att Replicate lyckades

### Rotsak
Replicate-kontot är under **$5 i kredit** → rate-limitas till **6 req/min, burst 1**. Edge-funktionen kör två Replicate-anrop per generering (Flux Kontext → background-remover). Flux går igenom; bg-remover startas omedelbart efteråt och får 429 (`Request was throttled`). I `runRemoveBackground` (rad ~805 i `replicate-face-swap/index.ts`) kastar vi då direkt `fallbackResponse("Vi kunde inte skapa bilden just nu...")` utan retry. Klienten visar fel-toast trots att Flux-bilden finns kvar på Replicate.

Loggbevis:
```
[flux-removebg] flux done designId=swap-...
[face-swap] fallback: BG-remover start failed: 429 {"retry_after":1}
```

### Fix — retry med backoff på 429 från bg-remover
I `supabase/functions/replicate-face-swap/index.ts`, `runRemoveBackground`, byt det första bg-remover `POST /predictions`-anropet mot en liten loop:
- Vid `bgStart.status === 429`: läs `retry_after` (sek), vänta `max(retry_after, 1.5) * 1000` ms, försök igen.
- Upp till **3 försök** totalt. Logga varje retry: `[bg-remover] 429 retry n/3 after Xs`.
- Bara om alla 3 misslyckas → returnera `fallbackResponse` (samma text som idag).
- Andra 4xx/5xx går fortfarande direkt till fallback (ingen retry).

Ingen ändring på Flux-steget (det fungerar). Ingen ändring av cache, prompts eller klient-UI.

### Långsiktigt
Det här är symptom-fix. Grundproblemet är att Replicate-kontot behöver fyllas på till **>$5** så att normala rate-limits (typ 600 req/min) gäller igen. Tills dess kommer vi få spurts av 429:or under hög belastning även med retry.

## 2. "Linjekonst" ger konstiga resultat på bilposter

### Rotsak
Den globala mellan-instruktionen i `fluxBase` för line-art-stilar är formulerad för människor/barn:

```
The result must read as a clean line-art illustration, NOT a photograph: 
crisp ink outlines, flat or minimal fill, no photographic micro-detail.
```

För `subjectKind === "removeBackground"` på fordon behövs konkreta hänvisningar till **bil-linjer** (karosskonturer, fönsterramar, fälgar/ekrar, strålkastare). Annars halvtolkar Flux och blandar foto-mikrodetalj med skiss → "konstigt" resultat.

### Fix — vehicle-aware line-art tail
I samma fil, i blocket som genererar `lineArtTail`/sätter `isLineArt`-tailen:
- Om subjektet är ett fordon (heuristik: `motifLine` innehåller "vehicle" / "car" / `subjectKind === "removeBackground"` och promt-block säger fordon) → append:
  ```
  Use clean even-weight ink lines that follow the car's body panels, window frames, 
  wheel rims, spokes, headlights and grille. No shading hatching, no photographic 
  micro-detail, no reflections.
  ```
- Övriga subjekt: oförändrad nuvarande line-art tail.

Inget i klient eller mall behöver röras.

## Filer som ändras
- `supabase/functions/replicate-face-swap/index.ts` — retry-loop kring bg-remover start (problem 1) + vehicle-aware line-art tail (problem 2). ~25 rader totalt.

## Verifiering
1. Trigga 4 generereringar inom 30 s med vilken stil som helst → tidigare fick man 1-2 toast-fel; nu ska alla gå igenom (med några sekunders fördröjning för 429-retry). Logg ska visa `[bg-remover] 429 retry 1/3 after 1s` när det händer.
2. Bilposter + Linjekonst på en vänstervänd och en högervänd bil → tydliga ink-linjer som följer kaross/fälg, inga konstiga skuggor.
3. Regress: födelseposter (baby) + Linjekonst, husposter + Linjekonst — ska se identiska ut med tidigare.

## Vad som INTE ändras
- Cache / klient-UI / fluxBase orientation-direktiv.
- Övriga stilar (Pop-art, Akvarell, Skiss, Olja, Vintage).
- Lovable AI-pipelinen (rör inte 429-hanteringen där — den retryas redan).
