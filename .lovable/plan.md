

## Plan: Byt till Theme App Extension (Shopify 2026-flödet)

### Varför vi byter
Nya Shopify Dev Dashboard exponerar inte längre `shpat_`-tokens. Den moderna vägen är **Theme App Extensions** — appen levererar ett **App Block** som butiksägaren aktiverar i Theme Editor med ett klick. Inget `write_themes`-scope, inga manuella theme-edits, fungerar för all framtid.

### Två vägar — välj en

**Väg A: Theme App Extension via Shopify CLI** (officiellt 2026-flöde)
- Kräver att vi sätter upp Shopify CLI lokalt på din dator
- Ger en App Block som du aktiverar i Theme Editor
- Mer setup nu, noll underhåll sen
- Fungerar med din nya Dev Dashboard-app utan token

**Väg B: Manuell theme-edit (en gång, 5 min)** ← rekommenderas
- Du klistrar in ett snippet + skapar en template direkt i Theme Editor
- Tilldelar templaten till båda produkterna i Shopify Admin
- Vi registrerar order-webhook via Lovable-integrationens befintliga scopes
- Ingen Custom App, ingen CLI, ingen token-jakt

### Rekommendation: Väg B

Du har redan gjort 80% av arbetet (produkter finns, editor fungerar, edge functions deployade). Vi behöver bara koppla ihop sista biten. Manuell theme-edit tar 5 minuter och är klart.

---

### Steg för Väg B

**1. Jag förbereder (efter godkännande):**
- Genererar exakt Liquid-snippet-kod du ska klistra in
- Genererar exakt template-JSON du ska klistra in
- Skriver tydlig copy-paste-instruktion med skärmdumps-referenser
- Uppdaterar `shopify-order-webhook` så den hanterar Shopify webhook-format korrekt
- Tar bort den nu obsoleta `shopify-inject-editor`-funktionen (eller markerar deprecated)

**2. Du gör i Shopify Admin (5 min):**
- Online Store → Themes → ⋯ → **Edit code** på aktivt tema
- **Snippets** → Add new snippet → `personlig-karta-editor` → klistra in koden jag ger
- **Templates** → Add new template → JSON → product → suffix `personlig-karta` → klistra in JSON
- Products → öppna `personlig-karta-poster` → höger sidofält **Theme template** → välj `personlig-karta`
- Upprepa för `personlig-karta-canvas`
- Settings → Notifications → Webhooks → **Create webhook** → Event: `Order payment` → Format: JSON → URL: `https://ptzmnusfgdwcqpjpbyco.supabase.co/functions/v1/shopify-order-webhook` → kopiera den **Webhook signing secret** som visas

**3. Du ger mig webhook-secret:**
- Jag begär secret-input för `SHOPIFY_WEBHOOK_SECRET`
- Du klistrar in den säkert (visas inte i chat)

**4. Vi testar:**
- Du öppnar produktsidan → bekräftar att editorn renderas
- Du lägger testorder via Shopify Bogus Gateway
- Vi kollar `gelato_orders`-tabellen → bekräftar `status: submitted`

### Vad du får
- Editor injicerad på båda produktsidorna utan dubblerade Shopify-kontroller
- Order-flöde som auto-skickar till Gelato vid betalning
- HMAC-verifierad webhook (säker mot förfalskade requests)
- Ingen beroende av Custom App eller Dev Dashboard-tokens

### Om du föredrar Väg A istället
Säg "Väg A" så ger jag CLI-instruktionerna istället. Kräver Node.js + terminalåtkomst på din dator.

