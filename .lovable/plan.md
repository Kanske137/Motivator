

## Plan: Be Lovable om utökad Shopify-behörighet (write_themes)

### Bakgrund
Lovable-appen är installerad i din butik som en **försäljningskanal**, inte som en admin-app. Den nuvarande OAuth-tokenen som Lovable fick vid installation saknar `write_themes`-scope, vilket krävs för att injicera vår editor-snippet och produkt-template i ditt Shopify-tema. Därför får vi `403: This action requires merchant approval for write_themes scope` när vi försöker köra `shopify-inject-editor`.

Jag (assistenten) kan inte själv lägga till nya OAuth-scopes — det är Shopifys säkerhetsmodell: utökade behörigheter måste alltid godkännas av butiksägaren via en re-auth-prompt som Lovable-plattformen genererar.

### Vad jag gör nu
Jag triggar Lovables egen **reconnect-prompt** mot Shopify-anslutningen och ber om scopet `write_themes` (utöver de befintliga). Då dyker det upp en knapp/dialog i ditt Lovable-gränssnitt där du klickar "Reconnect / Approve" → du skickas till Shopify → godkänner det nya scopet → tillbaka till Lovable. Allt utan att gå via Shopify Admin manuellt.

### Vad du gör
1. Klicka på reconnect-prompten som dyker upp i chatten/sidopanelen efter denna plan godkänns.
2. Godkänn `write_themes` i Shopifys auktoriseringsdialog.
3. Säg till mig "klart" — då kör jag om `shopify-inject-editor` automatiskt och hela editor + webhook-flödet rullar igång på riktigt.

### Alternativ om reconnect-prompten inte funkar
Om Lovable-plattformen inte exponerar Shopify-anslutningen via standard reconnect-flödet (Shopify hanteras delvis utanför connector-systemet), faller vi tillbaka på:
- **Disconnect + Reconnect** av butiken via Shopify-menyn i Lovables nav-bar (ellipsis-meny → "Disconnect store" → sedan koppla på nytt via chatt). Vid den nya kopplingen begär Lovable utökade scopes inklusive `write_themes`. Inga produkter eller orderdata i din butik påverkas av disconnect.

### Inga kodändringar behövs i denna iteration
All kod (edge functions, migration, EditorPage-payload) är redan på plats sedan förra iterationen. Det enda som blockerar är behörigheten. När den är godkänd: jag kör inject-funktionen → snippet + template läggs in → båda produkterna får vår editor → webhook registreras → klart.

