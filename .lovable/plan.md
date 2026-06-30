## Plan: engångs-reveal av `GELATO_WEBHOOK_SECRET`

### Vad jag bygger
En temporär edge-function `reveal-gelato-secret` som returnerar `GELATO_WEBHOOK_SECRET` + den färdiga webhook-URL:en, skyddad så att bara du kan anropa den.

### Skydd
Function-en kräver header `x-reveal-token: <RANDOM>` där `<RANDOM>` matchar en ny secret `REVEAL_TOKEN` som jag genererar via `generate_secret` (64 tecken). Två lager:
1. Endast korrekt `x-reveal-token` → returnerar värdet.
2. Allt annat → 401.

Jag exponerar inte `REVEAL_TOKEN` heller i klartext, utan anropar functionen åt dig via `supabase--curl_edge_functions` direkt här i chatten och klistrar in svaret. Då har du URL:en på en rad och ingenting läcker via en publik request.

### Steg jag kör (i build mode)
1. `generate_secret` → `REVEAL_TOKEN` (64 tecken).
2. Skapa `supabase/functions/reveal-gelato-secret/index.ts`:
   - Läser `GELATO_WEBHOOK_SECRET` och `REVEAL_TOKEN` från env.
   - Kollar `x-reveal-token`-header.
   - Returnerar JSON: `{ url: "https://ptzmnusfgdwcqpjpbyco.supabase.co/functions/v1/gelato-webhook?secret=..." }`.
   - JWT-verify av: `verify_jwt = false` i `supabase/config.toml` (annars behövs inloggad användare också, vilket inte hjälper här).
3. Deploya functionen.
4. Anropa den via `supabase--curl_edge_functions` med rätt header.
5. Klistra in den färdiga URL:en till dig i chatten.
6. **Direkt efter att du bekräftat att du kopierat värdet**: ta bort functionen (`delete_edge_functions`) och radera `REVEAL_TOKEN` (`delete_secret`). Då finns ingen kvarvarande exponering.

### Vad du gör
- Vänta tills jag postar URL:en.
- Kopiera den, klistra in i Gelatos `URL`-fält.
- Säg "klar, ta bort" så river jag functionen och secreten.

Godkänn så kör jag steg 1–5 i ett svep.
