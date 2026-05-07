# Shopify Setup — Manuell theme-injektion (5 min)

Följ stegen i ordning. Allt sker i din Shopify Admin — ingen Dev Dashboard, ingen CLI.

> **Uppdaterar du befintligt snippet?** Steg 1 nedan innehåller nu `locale`, `currency`, `rate` och `country` i iframe-URL:en + en `pushContext()`-funktion som skickar `SHOP_CONTEXT` till editorn. Klistra över den gamla `personlig-karta-editor`-snippeten med blocket nedan så får editorn automatiskt rätt språk + valuta för varje kund.

---

## Steg 1 — Skapa editor-section i temat

> **OBS:** Vi använder en dedikerad section istället för `custom-liquid`, eftersom premiumteman (t.ex. Concept) ofta saknar `sections/custom-liquid.liquid` och då renderas ingenting.

1. **Online Store → Themes** → klicka **⋯** på ditt aktiva tema → **Edit code**
2. **Sections → Add a new section**
3. Namn: `personlig-karta-editor` → **Done**
4. Klistra in följande kod (ersätt allt befintligt innehåll), spara:

```liquid
<style>
  .lovable-map-editor-wrap { width:100%; max-width:100%; margin:0; padding:0; display:block; }
  .lovable-map-editor-wrap iframe { width:100%; min-height:100vh; border:0; display:block; background:#fff; }
</style>

<div class="lovable-map-editor-wrap">
  <iframe
    id="lovable-editor-iframe-{{ product.handle }}"
    src="https://artful-create-studio-87.lovable.app/editor?handle={{ product.handle }}&locale={{ request.locale.iso_code }}&currency={{ cart.currency.iso_code }}&rate={{ cart.currency.rate | default: 1 }}&country={{ localization.country.iso_code }}"
    allow="clipboard-write; geolocation"
    loading="eager"
  ></iframe>
</div>

<script>
(function(){
  var iframe = document.getElementById('lovable-editor-iframe-{{ product.handle }}');
  function pushContext(){
    if(!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage({
      type:'SHOP_CONTEXT',
      locale: {{ request.locale.iso_code | json }},
      currency: {{ cart.currency.iso_code | json }},
      rate: {{ cart.currency.rate | default: 1 }},
      country: {{ localization.country.iso_code | json }}
    },'*');
  }
  iframe && iframe.addEventListener('load', pushContext);
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState==='visible') pushContext();
  });

  window.addEventListener('message', function(e){
    var d = e.data; if(!d || typeof d!=='object') return;
    if(d.type==='EDITOR_RESIZE' && typeof d.height==='number' && iframe){
      iframe.style.height = Math.max(600,d.height)+'px'; return;
    }
    if(d.type!=='ADD_TO_CART') return;
    if(d.handle && d.handle!=='{{ product.handle }}') return;
    fetch('/products/{{ product.handle }}.js').then(function(r){return r.json();})
      .then(function(p){
        var match = p.variants.find(function(v){
          var o=(v.options||[]).map(function(x){return String(x).toLowerCase();});
          return o.indexOf(String(d.size).toLowerCase())>-1 && o.indexOf(String(d.variant).toLowerCase())>-1;
        }) || p.variants[0];
        var props={};
        Object.keys(d.properties||{}).forEach(function(k){props[k]=d.properties[k];});
        return fetch('/cart/add.js',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({id:match.id, quantity:d.quantity||1, properties:props})
        });
      })
      .then(function(r){return r.json();})
      .then(function(){ window.location.href='/cart'; })
      .catch(function(err){ console.error('add to cart failed', err); });
  });
})();
</script>

{% schema %}
{
  "name": "Personlig Karta Editor",
  "settings": [],
  "presets": [{ "name": "Personlig Karta Editor" }]
}
{% endschema %}
```

`{% schema %}`-blocket är obligatoriskt — utan det renderar Shopify ingenting.

---

## Steg 2 — Skapa product-template

1. **Templates → Add a new template**
2. Välj **For**: `product`, **Type**: `JSON`, **Name**: `personlig-karta`
3. Ersätt innehållet med:

```json
{
  "sections": {
    "editor": {
      "type": "personlig-karta-editor"
    }
  },
  "order": ["editor"]
}
```
---

## Steg 3 — Tilldela template till produkterna

För **varje** produkt (`personlig-karta-poster` och `personlig-karta-canvas`):

1. **Products** → öppna produkten
2. Höger sidofält → **Theme template** → välj `personlig-karta`
3. **Save**

---

## Steg 4 — Registrera order-webhook

1. **Settings** (kugghjul nere till vänster) → **Notifications**
2. Scrolla ner till **Webhooks** → **Create webhook**
3. Fyll i:
   - **Event**: `Order payment`
   - **Format**: `JSON`
   - **URL**: `https://ptzmnusfgdwcqpjpbyco.supabase.co/functions/v1/shopify-order-webhook`
   - **Webhook API version**: senaste (2025-07 eller nyare)
4. Klicka **Save**
5. **VIKTIGT**: Efter Save visas en **"Webhook signing secret"** högst upp på Webhooks-sidan (en sträng som börjar med bokstäver/siffror). **Kopiera den.**
6. Skicka till mig i chatten: `webhook secret klart` — då öppnar jag säker dialog för dig att klistra in den.

---

## Steg 5 — Test

1. Öppna `https://wdxugd-yq.myshopify.com/products/personlig-karta-poster` → editorn ska rendera utan Shopify-prischrome runt om
2. Skapa en design → "Lägg i varukorg" → checka ut via **Bogus Gateway** (Settings → Payments → test mode)
3. Säg "test order skickad" — jag kollar `gelato_orders`-tabellen och bekräftar att Gelato fick ordern

---

## Steg 6 — Cart-thumbnail visar designens preview (KRÄVS)

Shopifys `/cart/add.js` kan inte sätta line-item bild, så cart visar produktbilden som default. Vi läser istället `_preview_image`-property som editorn skickar med.

1. **Online Store → Themes → ⋯ → Edit code**
2. Hitta filen som renderar cart-rader. Vanliga namn:
   - `sections/main-cart-items.liquid`
   - `snippets/cart-item.liquid`
   - `sections/cart-template.liquid`
   - (Dawn / Sense): `sections/main-cart-items.liquid`
3. Hitta raden där `item.image` eller `line_item.image` används i en `<img>`-tag, t.ex.:
   ```liquid
   <img src="{{ item.image | image_url: width: 300 }}" ...>
   ```
4. Ersätt `item.image | image_url: width: 300` med:
   ```liquid
   {%- if item.properties._preview_image != blank -%}
     {{ item.properties._preview_image }}
   {%- else -%}
     {{ item.image | image_url: width: 300 }}
   {%- endif -%}
   ```
   Spara.
5. (Valfritt) Dölj de interna `_`-prefixerade properties från cart-listan så kunden inte ser tekniska URLs. Hitta loopen som listar properties:
   ```liquid
   {% for p in item.properties %}
     {%- assign first_char = p.first | slice: 0 -%}
     {%- unless first_char == '_' -%}
       <p>{{ p.first }}: {{ p.last }}</p>
     {%- endunless -%}
   {% endfor %}
   ```

---

## Felsökning

- **Editor visas inte / ser ut som vanlig produktsida** → template inte tilldelad. Gå tillbaka till Steg 3.
- **Editor laddar men "Lägg i varukorg" gör inget** → öppna browser DevTools → Console → leta efter fel. Skicka skärmdump.
- **Order betalas men Gelato får inget** → öppna edge function-loggar för `shopify-order-webhook`. Om du ser `missing_print_file_url` betyder det att klienten inte hann skicka med tryckfilen — be kunden göra om designen och testa igen. Om problemet kvarstår systematiskt: skicka logg-utdraget i chatten.
- **Cart-thumbnail visar fortfarande produktbilden** → Steg 6 är inte klart, eller fel template-fil. Sök i temat efter `item.image` och tillämpa snippet på alla cart-rendering-platser.
```