/* Wallery Customizer storefront widget.
 *
 * On the product page it renders a themed entry card (inherits the theme's
 * fonts/colours/button style). Clicking "Öppna anpassaren" opens the customizer
 * as an IN-PAGE fullscreen overlay (not a new window) hosting the existing
 * editor. When the customer finishes, the editor posts ADD_TO_CART; we resolve
 * the Shopify variant and add it to the cart via the AJAX Cart API with the
 * design + preview as line item properties.
 *
 * Standalone, platform-agnostic bundle — only the delivery differs per platform.
 */
(function () {
  "use strict";

  // The hosted Wallery app (editor). Later: custom domain.
  var APP_ORIGIN = "https://motivator-8uw.pages.dev";

  // --- Inherit the theme's design tokens (so the entry card fits the store) --
  function readThemeTokens() {
    var body = getComputedStyle(document.body);
    var btn = document.querySelector(
      'product-form button[name="add"], button[name="add"], .product-form__submit, [type="submit"].button, [type="submit"].btn'
    );
    var b = btn ? getComputedStyle(btn) : null;
    function ok(v, fb) {
      return v && v !== "rgba(0, 0, 0, 0)" && v !== "transparent" ? v : fb;
    }
    return {
      font: body.fontFamily || "system-ui, -apple-system, sans-serif",
      text: ok(body.color, "#1a1a1a"),
      primary: ok(b && b.backgroundColor, "#1a1a1a"),
      primaryText: ok(b && b.color, "#ffffff"),
      radius: b && b.borderRadius && b.borderRadius !== "0px" ? b.borderRadius : "8px",
    };
  }

  function editorUrl(host) {
    var slug = host.dataset.templateSlug || host.dataset.productHandle || "";
    var params = new URLSearchParams();
    params.set("handle", slug);
    params.set("embedded", "1");
    if (host.dataset.currency) params.set("currency", host.dataset.currency);
    if (host.dataset.locale) params.set("locale", host.dataset.locale);
    if (host.dataset.shop) params.set("shop", host.dataset.shop);
    return APP_ORIGIN + "/editor?" + params.toString();
  }

  // --- Resolve the chosen variant on the storefront + add to cart ------------
  function addToCart(msg) {
    return fetch("/products/" + encodeURIComponent(msg.handle) + ".js", {
      headers: { Accept: "application/json" },
    })
      .then(function (r) {
        if (!r.ok) throw new Error("Produkten " + msg.handle + " hittades inte");
        return r.json();
      })
      .then(function (product) {
        var want = [msg.size, msg.variant].filter(Boolean).map(String);
        var match = (product.variants || []).find(function (v) {
          var opts = (v.options || []).map(String);
          return want.every(function (w) { return opts.indexOf(w) !== -1; });
        });
        if (!match) throw new Error("Hittade ingen variant för " + want.join(" / "));
        return fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            id: match.id,
            quantity: msg.quantity || 1,
            properties: msg.properties || {},
          }),
        }).then(function (r) {
          if (!r.ok) {
            return r.json().then(function (j) {
              throw new Error((j && j.description) || "Kunde inte lägga i varukorgen");
            });
          }
          return r.json();
        });
      });
  }

  // --- Fullscreen in-page overlay hosting the editor -------------------------
  // Built once per host and kept in the DOM (iframe stays alive) so the
  // customer's in-progress design survives closing + reopening. Close hides it;
  // open shows it again.
  function getOverlay(host) {
    if (host._walleryOverlay) return host._walleryOverlay;

    var overlay = document.createElement("div");
    overlay.setAttribute("data-wallery-overlay", "");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;background:#fff;display:none;flex-direction:column;";

    var bar = document.createElement("div");
    bar.style.cssText =
      "flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:8px;" +
      "padding:8px 12px;background:#fff;border-bottom:1px solid rgba(0,0,0,.08);";
    var label = document.createElement("span");
    label.textContent = "Anpassa din design";
    label.style.cssText = "font:600 15px/1.2 system-ui,-apple-system,sans-serif;color:#1a1a1a;";
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Stäng");
    close.style.cssText =
      "font:600 18px/1 system-ui;cursor:pointer;border:0;background:transparent;padding:8px 12px;color:#1a1a1a;";
    bar.appendChild(label);
    bar.appendChild(close);

    var iframe = document.createElement("iframe");
    iframe.src = editorUrl(host);
    iframe.setAttribute("allow", "clipboard-write; geolocation; camera");
    iframe.style.cssText = "flex:1 1 auto;width:100%;height:100%;border:0;display:block;";

    overlay.appendChild(bar);
    overlay.appendChild(iframe);
    document.body.appendChild(overlay);

    function hide() {
      overlay.style.display = "none";
      document.documentElement.style.overflow = "";
    }
    close.addEventListener("click", hide);

    // ADD_TO_CART fires only while the editor is open, so a single listener is fine.
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || d.type !== "ADD_TO_CART") return;
      close.disabled = true;
      addToCart(d)
        .then(function () {
          window.location.href = "/cart";
        })
        .catch(function (err) {
          close.disabled = false;
          console.error("[wallery] add to cart failed", err);
          alert("Kunde inte lägga i varukorgen: " + (err && err.message ? err.message : err));
        });
    });

    host._walleryOverlay = { el: overlay, hide: hide };
    return host._walleryOverlay;
  }

  function openOverlay(host) {
    var o = getOverlay(host);
    o.el.style.display = "flex";
    document.documentElement.style.overflow = "hidden";
  }

  // --- Themed entry card on the product page ---------------------------------
  function mount(host) {
    if (host.dataset.walleryMounted) return;
    host.dataset.walleryMounted = "1";

    var tokens = readThemeTokens();
    var accent = host.dataset.accent || tokens.primary;
    var radius = host.dataset.radius ? host.dataset.radius + "px" : tokens.radius;
    var font = host.dataset.inheritFonts !== "false" ? tokens.font : "system-ui, -apple-system, sans-serif";

    var shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML =
      "<style>" +
      ":host{all:initial;display:block;}" +
      ".w{font-family:" + font + ";color:" + tokens.text + ";" +
      "--p:" + accent + ";--pt:" + tokens.primaryText + ";--r:" + radius + ";" +
      "box-sizing:border-box;width:100%;border:1px solid rgba(0,0,0,.12);" +
      "border-radius:var(--r);padding:20px;margin:16px 0;}" +
      ".w h3{margin:0 0 6px;font-size:1.15em;}" +
      ".w p{margin:0 0 16px;opacity:.7;font-size:.9em;}" +
      ".w button{font:inherit;font-weight:600;cursor:pointer;border:0;background:var(--p);" +
      "color:var(--pt);border-radius:var(--r);padding:12px 22px;width:100%;}" +
      "@media(min-width:600px){.w button{width:auto;}}" +
      "</style>" +
      '<div class="w"><h3>Gör den till din</h3>' +
      "<p>Skapa din personliga design innan du lägger i varukorgen.</p>" +
      '<button type="button" data-open>Öppna anpassaren</button></div>';

    shadow.querySelector("[data-open]").addEventListener("click", function () {
      openOverlay(host);
    });
  }

  function init() {
    document.querySelectorAll("[data-wallery-root]").forEach(mount);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
