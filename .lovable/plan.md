
# Fixa AI-cache: stabil nyckel + bevarad historik

## Bekräftade problem (verifierat i koden)

1. **"Återgå till foto utan stil" rensar historiken.** `undoAi()` anropar `setPhotoSource(photoFile, ...)` som i sin tur sätter `originalPhotoUrl: null`. Historik-listan filtreras på den URL:en → tom lista.
2. **Samma stil → nytt Replicate-anrop.** När `originalPhotoUrl` nullats laddar `ensureUploadedPhotoUrl` upp bilden igen och får en *ny* URL (nytt UUID i sökvägen). Cache-nyckeln `${URL}|${presetId}` matchar inte gamla entries → miss → nytt anrop.
3. **Sidladdning ”tappar” historiken.** Cachen *persisteras* faktiskt redan till localStorage, men eftersom kunden vid ny session laddar upp filen på nytt → ny URL → samma cache-miss.

**Rotorsak:** vi nycklar på en flyktig uppladdnings-URL istället för bildens innehåll.

## Lösning

### 1. Byt cache-nyckel till en stabil innehållshash
- Beräkna `photoHash = SHA-256(file bytes)` med `crypto.subtle.digest` när en fil laddas upp eller väljs som källa.
- Spara hashen i `editorStore` som `photoHash: string | null`.
- Cache-nyckeln blir `${photoHash}|${presetId}` istället för `${url}|${presetId}`.
- Hashen är deterministisk → samma bild ger alltid samma nyckel, oavsett om uppladdnings-URL byts eller om sidan laddats om.

### 2. Bevara `originalPhotoUrl` när det är "samma" bild
- I `setPhotoSource`: om den nya filens hash matchar nuvarande `photoHash`, behåll `originalPhotoUrl` istället för att nulla. Det undviker onödig återuppladdning.
- I `undoAi`: anropa **inte** `setPhotoSource` (som nullar URL). Istället ny store-action `clearAiResultOnly()` som bara sätter `aiPrintFileUrl: null` + `designSource: 'photo'` utan att röra `photoFile`/`originalPhotoUrl`/`photoHash`.

### 3. Använd hash genom hela flödet
- `getCachedAiResult(photoHash, presetId)` — check innan Replicate-anrop.
- `addAiResultToCache(photoHash, presetId, label, url)` — efter lyckad körning.
- `listAiResultsForPhoto(photoHash)` — driver historik-listan i UI:t. Den fortsätter visas även efter "Återgå".
- AiCacheEntry får ett extra fält `photoHash` (behåll `photoKey` som alias för bakåtkompabilitet eller migrera direkt — vi väljer migrera direkt och bumpa storage-versionen till `lovable.ai-cache.v2`).

### 4. Höj cap till 20 (du föreslog) eller behåll 30
- Du föreslog max 20. Nuvarande cap är 30. **Förslag: behåll 30.** Lite headroom kostar inget och skyddar mot edge-cases där en kund testar många stilar på flera bilder. LRU-eviction på timestamp finns redan.
- Vill du strikt ha 20, säg till så ändrar vi `MAX_ENTRIES = 20`.

### 5. Hantera dead URL:er (bonus, billig)
- Om en cachad print-files-URL returnerar 404 (bucket städad) → ta bort entryn och kör om Replicate. Implementeras i `AiStyleSection` med en `fetch(url, { method: 'HEAD' })` innan vi sätter `aiPrintFileUrl`.

## Filer som påverkas

- `src/lib/ai-cache-storage.ts` — bumpa storage-key till `v2`, byt fältet `photoKey` → `photoHash`. Ny hjälpare `hashFile(file: File): Promise<string>`.
- `src/stores/editorStore.ts` — lägg till `photoHash` state, `setPhotoHash`, `clearAiResultOnly`. Uppdatera `setPhotoSource` att inte nulla URL när hash matchar. Cache-API:et tar `photoHash` istället för `photoKey`.
- `src/components/editor/AiStyleSection.tsx` — beräkna hash vid behov, använd hash som cache-nyckel, byt `undoAi` till `clearAiResultOnly`, valfritt HEAD-check innan instant cache-hit.

## Vad förändras INTE
- `replicate-style` edge-funktionen.
- Print-pipelinen, cart-payloaden, Shopify-integrationen.
- Befintlig UI-layout — bara historik-sektionen blir mer pålitlig.

## Migration av befintlig cache
Vi bumpar storage-nyckeln (`v1` → `v2`) → gamla entries ignoreras tyst (de var ändå brutna pga URL-nyckling). Inga manuella städningar behövs.
