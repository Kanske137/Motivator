
# Fix: tom produktsida i Concept-temat

## Vad som händer
`personlig-karta.json` använder sektionstypen `custom-liquid`. Concept-temat innehåller troligen ingen `sections/custom-liquid.liquid` (premium-teman utelämnar den ofta). När en JSON-template refererar en sektionstyp som inte finns i temat renderar Shopify den som tom — vilket exakt matchar symptomet (header + footer OK, mitten tom).

Fix: skapa en egen section-fil och referera den i template:n. Snippet:en kan då slopas — vi flyttar in innehållet direkt i sektionen.

## Steg du gör i Shopify Admin

### 1. Skapa ny section i Concept-temat
**Online Store → Themes → Concept → Edit code → Sections → Add a new section**
- Namn: `personlig-karta-editor`
- Klistra in koden i nästa avsnitt och spara.

### 2. Section-kod (`sections/personlig-karta-editor.liquid`)

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
    if(!iframe||!iframe.contentWindow) return;
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
          body:JSON.stringify({id:match.id, quantity:d.quantity||1, properties:props})
        });
      })
      .then(function(r){return r.json();})
      .then(function(){window.location.href='/cart';})
      .catch(function(err){console.error('add to cart failed',err);});
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

### 3. Uppdatera template:n
**Templates → `personlig-karta.json`** — ersätt allt med:

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

(`type` matchar nu vår section-fil istället för `custom-liquid`.)

### 4. Behåll eller ta bort gamla snippet
`snippets/personlig-karta-editor.liquid` används inte längre — kan ligga kvar eller raderas.

### 5. Hard reload produktsidan
Cmd/Ctrl + Shift + R.

## Varför detta löser det
- Garanterad section-typ — vi äger filen själva.
- `{% schema %}` säkerställer att Shopify registrerar den som en giltig sektion.
- Inga `display:none`-regler längre — concept-temat har redan inget extra produktinnehåll i en custom template, så vi behöver bara visa iframen.

## Diagnos om det fortfarande är tomt
View source på produktsidan och sök efter `lovable-editor-iframe`:
- **Finns inte** → section-filen renderas inte (felstavat namn i template, schema-fel, eller temat behöver väljas om för produkten).
- **Finns** → iframe är där men gömd; öppna DevTools, kolla om `<iframe>` har `display:none` eller `height:0` ärvt från ett tema-wrap.

I så fall skicka en skärmdump av view-source-utdraget runt iframen så kan jag rikta CSS:en exakt.
