

## Visa Shopify-koderna direkt i chatten

Filen `SHOPIFY_SETUP.md` skapades men du hittar den inte i Code Editor. Istället för att leta — jag klistrar in allt du behöver direkt i nästa chat-meddelande.

### Vad du får i nästa svar

**1. Liquid-snippet** (kopiera till Shopify → Edit code → Snippets → ny snippet `personlig-karta-editor`):
- iframe som laddar editorn från `https://artful-create-studio-87.lovable.app/editor?handle={{ product.handle }}`
- script som lyssnar på `ADD_TO_CART`-meddelanden från editorn och lägger varianten i Shopify-varukorgen med rätt line-item properties
- döljer Shopifys default produktinfo (pris/varianter) så bara editorn syns

**2. JSON-template** (kopiera till Shopify → Templates → ny template `product.personlig-karta.json`):
- en `custom-liquid`-section som renderar snippet:en

**3. Steg-för-steg klick-instruktioner** för Shopify Admin:
- Var du klickar för att skapa snippet
- Var du klickar för att skapa template
- Hur du tilldelar templaten till `personlig-karta-poster` och `personlig-karta-canvas`
- Hur du skapar Order payment-webhook till `https://ptzmnusfgdwcqpjpbyco.supabase.co/functions/v1/shopify-order-webhook`
- Var Shopify visar **Webhook signing secret** efter Save

**4. Felsökningstips** om editorn inte visas eller "Lägg i varukorg" inte fungerar.

### Efter att du klistrat in allt

Säg **"webhook secret klart"** → jag öppnar säker dialog för `SHOPIFY_WEBHOOK_SECRET` → vi testar med Bogus Gateway-order → bekräftar att Gelato får ordern.

### Inga kodändringar i projektet

Det här är ren copy-paste från chat till Shopify Admin. Inget byggs om i Lovable-projektet — webhook-funktionen är redan deployad och redo.

