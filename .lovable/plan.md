> **Inga produktionsändringar.** Endast en tillfällig diagnostik-edge-funktion + körningar. Allt raderas eller lämnas oanvänt efteråt. Inget i `replicate-face-swap`, ingen schema-ändring, inga frontend-edits.

## Vad jag kommer göra

### Steg 0 — Skapa en tillfällig diagnostik-funktion `face-swap-diag`
Ny edge-funktion, helt separat från `replicate-face-swap`. Tar:
```json
{ "promptText": "...", "imageUrl": "...", "repeat": 10, "label": "test-A" }
```
Den loopar `repeat` gånger, anropar Lovable AI Gateway (`google/gemini-3.1-flash-image-preview`) med EXAKT samma body som produktion, och loggar per försök:
- HTTP-status
- **Hela råa errBody** (otrunkerat — produktionskoden truncar till 200 tecken, det är därför vi inte ser Googles riktiga fel)
- `finishReason`, `promptFeedback.blockReason`, `safetyRatings` från `data.choices[0]` om de finns
- input-bildens `width`, `height`, `bytes` (hämtas via `fetch(imageUrl)` + `readImageSize`)
- latens (ms)

Returnerar en sammanställning `{ ok: N, fail: N, perAttempt: [...] }`.

### Steg 1 — Punkt 1: Provider-detalj
Kör `face-swap-diag` 1 gång med en känd failande prompt + bild. Rapportera **hela råa svaret** från gatewayen. Det visar om Google säger `SAFETY`, `RECITATION`, `INVALID_ARGUMENT` eller `5xx`. Om gatewayen fortsatt bara säger `"Provider returned error"` utan detalj → dokumentera det som ett gateway-tak och be Lovable AI Gateway exponera upstream-body (separat ärende).

### Steg 2 — Punkt 2: Basfrekvens, identisk input × 10
Två körningar à 10:
- **2a:** Skiss-prompt (icke-akvarell, full produktionsscaffold) + bild `face-d9910430-…jpg`
- **2b:** Akvarell-prompt (full produktionsscaffold) + samma bild

Rapportera `200/400`-fördelning och alla errBody-strängar.

### Steg 3 — Punkt 3: Isolera bild vs text
Två körningar à 10:
- **3a:** Minimal prompt (`"Remove the background and place the subject on a pure white #FFFFFF backdrop. Return one image."`) + samma failande bild
- **3b:** Full failande Skiss-prompt + neutral objektbild utan ansikte (en stol-bild jag laddar upp till `ai-references`-bucketen tillfälligt)

Rapportera `200/400`-fördelning per körning.

### Steg 4 — Punkt 4: Reda ut motsägelserna
- **4a (retry-beteendet):** Kör `supabase--edge_function_logs` för `replicate-face-swap` och filtrera på `attempt`. Visa råa lograder så vi ser om 400 faktiskt retryas i deployen, eller om "after 3 attempts" kom från en äldre build. Komplettera med `supabase--analytics_query` på `function_edge_logs` för att se `deployment_id` + `version` på de failande anropen → jämför mot nuvarande deploy.
- **4b (test-case-mismatch):** Kör `supabase--analytics_query` mot `function_edge_logs` för de senaste 50 anropen till `replicate-face-swap`, joina mot edge-loggens egen `[face-swap] start`-rad och plocka ut `adminPrompt`-prefixet (120 tkn loggas redan) per `designId`. Då ser vi ordagrant: var det husposter-mallen med hus-bilden, eller var det födelsetavla-mallen med bebis-bilden? Inga gissningar.

### Steg 5 — Punkt 5: Bilddimensioner
Redan inbyggt i `face-swap-diag` (steg 0). För historiska 400-anrop i produktion: lägg INTE till loggning i `replicate-face-swap` nu (det vore en produktionsändring). Istället plockar jag `faceImageUrl` ur befintliga loggar och kör `HEAD`/`readImageSize` separat på dem, så vi får px+bytes utan att röra produktionsfunktionen.

### Steg 6 — Rapport
Klistrar in **rå output** (ingen tolkning, inga sammanfattningar) som:
```
=== Punkt 1: Provider detail ===
HTTP 400
errBody (raw, untruncated): { ... }
finishReason: ...
safetyRatings: ...
inputImage: 2048x1536, 4187234 bytes

=== Punkt 2a: Skiss × 10 (same input) ===
attempt 1: 200, 14823ms
attempt 2: 400, errBody=...
...
Summary: 6 ok / 4 fail

=== Punkt 2b: Akvarell × 10 ===
...
```
osv för alla punkter.

### Steg 7 — Städning
Tar bort `supabase/functions/face-swap-diag/` när rapporten är godkänd. Den eventuella stol-bilden i `ai-references` kan stå kvar (publikt bucket, ingen risk) eller raderas på begäran.

## Vad jag INTE gör
- Inga edits i `supabase/functions/replicate-face-swap/index.ts`
- Inga schema-/migrationsändringar
- Inga frontend-edits
- Inga ändringar i `swapPrompt`-värden i `product_configs`
- Inga retry-logik-ändringar
- Inga prompt-saneringar (det väntar tills granskaren sett rådatan)

## Kostnad / risk
- ~41 Gemini-anrop totalt (1 + 10 + 10 + 10 + 10). Varje anrop ≈ samma kostnad som en kund-körning idag.
- Inga sidoeffekter i kundens flöde — separat funktion, separat designId-prefix `diag-…`.

## Frågor innan jag startar (i build mode)
1. **Bekräfta failande bild:** ska jag använda `face-d9910430-e534-49c9-8e99-230d8db0be30.jpg` (den vi sett 400 på), eller har du en annan bild du vill testa?
2. **Neutral kontrollbild (3b):** ska jag generera en enkel stol-bild via image-gen, eller har du en specifik objektbild du vill att jag använder?
3. **Direktanrop till Google utanför gatewayen (punkt 1, alternativ B):** detta kräver en separat Google AI Studio / Vertex API-nyckel som vi inte har idag. OK att jag begränsar punkt 1 till "hämta otrunkerat errBody från gatewayen" istället för att gå runt den? Om du vill ha riktig direktåtkomst behöver vi `GEMINI_API_KEY` via `add_secret`.

Säg ja så kör jag, eller justera scopet.
