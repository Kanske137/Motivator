## Mål
När mallen bara har **en aktiverad** AI-stil ska kundfrontens stilväljare ("Välj stil (valfritt)" / "Välj stil") inte renderas. Den enda stilen ska ändå tillämpas automatiskt så funktionaliteten behålls.

Gäller båda komponenterna:
- `src/components/editor/AiPhotoSection.tsx` (AI-referenslager m. bakgrundsborttagning)
- `src/components/editor/AiStyleSection.tsx` (vanliga fotolager m. stilval via Replicate)

## Ändringar

### 1. `AiPhotoSection.tsx`
- Rad 437: byt villkor från `visibleStyles.length > 0` till `visibleStyles.length > 1`.
- Auto-val finns redan (rad 144–149) som sätter `selectedStyleId` till första stilen → enda stilen blir aktiv automatiskt. Ingen annan logik behöver röras; `runSwap` använder `selectedStyleId` precis som idag.

### 2. `AiStyleSection.tsx`
- Rad 167: ändra `if (visiblePresets.length === 0) return null;` till `if (visiblePresets.length === 0) return null;` **plus** ett nytt fall: om `visiblePresets.length === 1` → dölj hela UI:t (rubrik, grid, historik, "Återgå"-knapp) men lägg till en `useEffect` som automatiskt anropar `applyStyle(visiblePresets[0])` när:
  - `photoFile` finns
  - `aiPrintFileUrl` är tomt (ingen stil redan applicerad)
  - inget pågående jobb (`busyId === null`)
  - stilen inte redan finns i cachen för aktuell `photoHash` (då används cache direkt via befintlig logik i `applyStyle`)
- För att undvika oändlig loop: kör bara om effekten har en `ref`-flagga per `(photoHash, presetId)` som markerar "redan försökt".
- `AiProgress` behöver fortfarande visas under körning så kunden ser att något händer — alternativt döljs den helt eftersom UI:t i övrigt är borta. Förslag: behåll `AiProgress` synlig vid auto-körning så kunden ser laddning.

## Vad som INTE ändras
- Admin-sidan, mall-schema, edge functions, cache-logik, översättningar (inga nya UI-strängar behövs eftersom UI döljs), priser, kartor, textlager, övrig editor.
- Beteende vid 0 stilar (oförändrat: ingen sektion).
- Beteende vid 2+ stilar (oförändrat: väljaren visas som idag).

## Verifiering
- Mall med 1 aktiverad stil: ladda upp bild → ingen "Välj stil"-rubrik syns, stilen appliceras automatiskt (AiPhotoSection: efter "Skapa"-klick som idag; AiStyleSection: direkt efter upload).
- Mall med 2+ stilar: oförändrad väljare.
- Mall med 0 stilar: ingen sektion, ingen auto-körning.
