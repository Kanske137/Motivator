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
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    throw new Error(`Shopify ${path} ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body as any;
}

function snippetLiquid(editorOrigin: string): string {
  return `{%- comment -%} Personlig Karta editor — auto-injected {%- endcomment -%}
<div class="lovable-map-editor" style="width:100%;max-width:1400px;margin:0 auto;">
  <iframe
    id="lovable-editor-iframe-{{ product.handle }}"
    src="${editorOrigin}/editor?handle={{ product.handle }}"
    style="width:100%;height:90vh;border:0;display:block;background:#fff;"
    allow="clipboard-write"
    loading="lazy"
  ></iframe>
</div>
<script>
(function(){
  var iframe = document.getElementById('lovable-editor-iframe-{{ product.handle }}');
  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || d.type !== 'ADD_TO_CART') return;
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

const TEMPLATE_JSON = JSON.stringify(
  {
    sections: {
      main: {
        type: "main-product",
        blocks: {
          editor: {
            type: "@app",
          },
        },
        block_order: ["editor"],
        custom_liquid: {
          type: "custom_liquid",
          settings: { custom_liquid: "{% render 'personlig-karta-editor' %}" },
        },
        settings: {},
      },
      "custom-liquid": {
        type: "custom_liquid",
        settings: {
          custom_liquid: "{% render 'personlig-karta-editor' %}",
        },
      },
    },
    order: ["main", "custom-liquid"],
  },
  null,
  2
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const domain = Deno.env.get("SHOPIFY_STORE_PERMANENT_DOMAIN") ??
      Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const token = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!domain || !token) {
      return new Response(JSON.stringify({ error: "Shopify credentials missing" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: InjectBody = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const editorOrigin =
      body.editorOrigin ?? "https://artful-create-studio-87.lovable.app";
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
        asset: {
          key: "snippets/personlig-karta-editor.liquid",
          value: snippetLiquid(editorOrigin),
        },
      }),
    });

    // 3) Upload product template
    await shopifyAdmin(domain, token, `/themes/${themeId}/assets.json`, {
      method: "PUT",
      body: JSON.stringify({
        asset: {
          key: "templates/product.personlig-karta.json",
          value: TEMPLATE_JSON,
        },
      }),
    });

    // 4) Assign template to products via product_listings update
    const injected: string[] = [];
    for (const handle of handles) {
      try {
        const search = await shopifyAdmin(
          domain,
          token,
          `/products.json?handle=${encodeURIComponent(handle)}&fields=id,handle,template_suffix`
        );
        const product = search.products?.[0];
        if (!product) continue;
        await shopifyAdmin(domain, token, `/products/${product.id}.json`, {
          method: "PUT",
          body: JSON.stringify({
            product: { id: product.id, template_suffix: "personlig-karta" },
          }),
        });
        injected.push(handle);
      } catch (e) {
        console.error("Failed to assign template for", handle, e);
      }
    }

    return new Response(JSON.stringify({ ok: true, themeId, injected: injected.length, handles: injected }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
