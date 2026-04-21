// Injects an iframe-based map editor into the connected Shopify store.
// Creates a Liquid snippet + product template, then assigns the template to the
// product handles passed in the request (defaults to both seeded products).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHOPIFY_API_VERSION = "2025-07";

interface InjectBody {
  editorOrigin?: string;
  handles?: string[];
}

async function shopifyAdmin(domain: string, token: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}${path}`, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch {}
  if (!res.ok) {
    throw new Error(`Shopify ${path} ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body as any;
}

function snippetLiquid(editorOrigin: string): string {
  return `{%- comment -%} Personlig Karta editor — auto-injected {%- endcomment -%}
<style>
  /* Hide any leftover Shopify product chrome on this template */
  .shopify-section-main-product, .product, .product__info-wrapper, .product__media-wrapper { display: none !important; }
  .lovable-map-editor-wrap { width:100%; max-width:100%; margin:0; padding:0; }
  .lovable-map-editor-wrap iframe { width:100%; min-height:100vh; border:0; display:block; background:#fff; }
</style>
<div class="lovable-map-editor-wrap">
  <iframe
    id="lovable-editor-iframe-{{ product.handle }}"
    src="${editorOrigin}/editor?handle={{ product.handle }}"
    allow="clipboard-write; geolocation"
    loading="eager"
  ></iframe>
</div>
<script>
(function(){
  var iframe = document.getElementById('lovable-editor-iframe-{{ product.handle }}');
  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;

    // Auto-resize from editor
    if (d.type === 'EDITOR_RESIZE' && typeof d.height === 'number' && iframe) {
      iframe.style.height = Math.max(600, d.height) + 'px';
      return;
    }

    if (d.type !== 'ADD_TO_CART') return;
    if (d.handle && d.handle !== '{{ product.handle }}') return;

    fetch('/products/{{ product.handle }}.js')
      .then(function(r){ return r.json(); })
      .then(function(product){
        var match = product.variants.find(function(v){
          var opts = (v.options || []).map(function(o){ return String(o).toLowerCase(); });
          return opts.indexOf(String(d.size).toLowerCase()) > -1 &&
                 opts.indexOf(String(d.variant).toLowerCase()) > -1;
        }) || product.variants[0];
        var props = {};
        Object.keys(d.properties || {}).forEach(function(k){ props[k] = d.properties[k]; });
        return fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: match.id, quantity: d.quantity || 1, properties: props })
        });
      })
      .then(function(r){ return r.json(); })
      .then(function(){ window.location.href = '/cart'; })
      .catch(function(err){ console.error('add to cart failed', err); });
  });
})();
</script>`;
}

// Minimal product template — only renders our editor snippet. No price, variants, gallery, etc.
const TEMPLATE_JSON = JSON.stringify(
  {
    sections: {
      "personlig-karta-editor": {
        type: "custom-liquid",
        settings: {
          custom_liquid: "{% render 'personlig-karta-editor' %}",
        },
      },
    },
    order: ["personlig-karta-editor"],
  },
  null,
  2
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const domain = Deno.env.get("SHOPIFY_STORE_PERMANENT_DOMAIN") ?? Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const token = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!domain || !token) {
      return new Response(JSON.stringify({ error: "Shopify credentials missing" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: InjectBody = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const editorOrigin = body.editorOrigin ?? "https://artful-create-studio-87.lovable.app";
    const handles = body.handles ?? ["personlig-karta-poster", "personlig-karta-canvas"];

    // 1) Find main theme
    const themesRes = await shopifyAdmin(domain, token, `/themes.json`);
    const mainTheme = themesRes.themes.find((t: any) => t.role === "main");
    if (!mainTheme) throw new Error("No main theme found");
    const themeId = mainTheme.id;

    // 2) Upload snippet
    await shopifyAdmin(domain, token, `/themes/${themeId}/assets.json`, {
      method: "PUT",
      body: JSON.stringify({
        asset: { key: "snippets/personlig-karta-editor.liquid", value: snippetLiquid(editorOrigin) },
      }),
    });

    // 3) Upload product template
    await shopifyAdmin(domain, token, `/themes/${themeId}/assets.json`, {
      method: "PUT",
      body: JSON.stringify({
        asset: { key: "templates/product.personlig-karta.json", value: TEMPLATE_JSON },
      }),
    });

    // 4) Assign template to products
    const injected: string[] = [];
    for (const handle of handles) {
      try {
        const search = await shopifyAdmin(
          domain, token,
          `/products.json?handle=${encodeURIComponent(handle)}&fields=id,handle,template_suffix`
        );
        const product = search.products?.[0];
        if (!product) continue;
        await shopifyAdmin(domain, token, `/products/${product.id}.json`, {
          method: "PUT",
          body: JSON.stringify({ product: { id: product.id, template_suffix: "personlig-karta" } }),
        });
        injected.push(handle);
      } catch (e) {
        console.error("Failed to assign template for", handle, e);
      }
    }

    // 5) Auto-register orders/paid webhook (idempotent)
    let webhook: { id?: number; created?: boolean; address?: string } = {};
    try {
      const webhookAddress = `https://ptzmnusfgdwcqpjpbyco.supabase.co/functions/v1/shopify-order-webhook`;
      const existing = await shopifyAdmin(domain, token, `/webhooks.json?topic=orders/paid`);
      const match = (existing.webhooks || []).find((w: any) => w.address === webhookAddress);
      if (match) {
        webhook = { id: match.id, created: false, address: webhookAddress };
      } else {
        const created = await shopifyAdmin(domain, token, `/webhooks.json`, {
          method: "POST",
          body: JSON.stringify({
            webhook: { topic: "orders/paid", address: webhookAddress, format: "json" },
          }),
        });
        webhook = { id: created.webhook?.id, created: true, address: webhookAddress };
      }
    } catch (e) {
      console.error("Webhook registration failed", e);
    }

    return new Response(
      JSON.stringify({ ok: true, themeId, injected: injected.length, handles: injected, webhook }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
