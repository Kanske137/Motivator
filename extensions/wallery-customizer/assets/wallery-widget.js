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

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

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
    // Kept mounted (iframe stays alive → design survives close+reopen), hidden
    // with display:none when closed. We only ever snapshot while it's VISIBLE.
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;background:#fff;display:none;flex-direction:column;";

    var bar = document.createElement("div");
    bar.style.cssText =
      "flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:8px;" +
      "padding:8px 12px;background:#fff;border-bottom:1px solid rgba(0,0,0,.08);";
    var label = document.createElement("span");
    label.textContent = host.dataset.overlayTitle || "Customize your design";
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
    // On close: snapshot the design while the editor is STILL VISIBLE (rendered),
    // then hide as soon as the fresh preview arrives (or after a short fallback).
    // Capturing while visible is what makes the card update on the first close.
    function requestHideWithPreview() {
      host._walleryPendingHide = true;
      try {
        iframe.contentWindow.postMessage({ type: "WALLERY_REQUEST_PREVIEW" }, "*");
      } catch (e) { /* cross-origin timing */ }
      if (host._walleryHideTimer) clearTimeout(host._walleryHideTimer);
      host._walleryHideTimer = setTimeout(function () {
        host._walleryPendingHide = false;
        hide();
      }, 1400);
    }
    close.addEventListener("click", requestHideWithPreview);

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

    // Merchant-configurable content (theme editor), with English defaults.
    var padding = (host.dataset.padding || "20") + "px";
    var showTexts = host.dataset.showTexts !== "false";
    var heading = host.dataset.heading || "Make it yours";
    var subtext = host.dataset.subtext || "Create your personal design before adding to cart.";
    var buttonLabel = host.dataset.buttonLabel || "Open customizer";

    var textsHtml = showTexts
      ? "<h3>" + esc(heading) + "</h3><p>" + esc(subtext) + "</p>"
      : "";

    var pencil =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

    var shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML =
      "<style>" +
      ":host{all:initial;display:block;}" +
      "*{box-sizing:border-box;}" +
      ".w{font-family:" + font + ";color:" + tokens.text + ";" +
      "--p:" + accent + ";--pt:" + tokens.primaryText + ";--r:" + radius + ";" +
      "width:100%;background:#fff;border:1px solid rgba(0,0,0,.07);" +
      "border-radius:calc(var(--r) + 4px);padding:" + padding + ";margin:16px 0;" +
      "box-shadow:0 1px 2px rgba(0,0,0,.04),0 6px 20px rgba(0,0,0,.06);}" +
      ".preview{position:relative;display:none;width:100%;cursor:pointer;border-radius:var(--r);" +
      "overflow:hidden;margin-bottom:16px;background:rgba(0,0,0,.03);box-shadow:0 1px 3px rgba(0,0,0,.12);}" +
      ".preview img{display:block;width:100%;height:auto;}" +
      ".preview .hint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(20,20,20,0);opacity:0;transition:opacity .18s ease;}" +
      ".preview:hover .hint{opacity:1;background:rgba(20,20,20,.28);}" +
      ".preview .hint span{display:inline-flex;align-items:center;gap:6px;background:#fff;color:#1a1a1a;" +
      "font-size:.82em;font-weight:600;padding:8px 14px;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.25);}" +
      ".preview .hint svg{width:15px;height:15px;}" +
      ".w h3{margin:0 0 4px;font-size:1.1em;font-weight:600;letter-spacing:-.01em;}" +
      ".w p{margin:0 0 16px;opacity:.62;font-size:.9em;line-height:1.45;}" +
      ".w button{font:inherit;font-weight:600;cursor:pointer;border:0;background:var(--p);color:var(--pt);" +
      "border-radius:var(--r);padding:13px 22px;width:100%;display:inline-flex;align-items:center;" +
      "justify-content:center;gap:8px;transition:transform .08s ease,filter .15s ease;}" +
      ".w button:hover{filter:brightness(.94);}" +
      ".w button:active{transform:translateY(1px);}" +
      ".w button svg{width:18px;height:18px;}" +
      "</style>" +
      '<div class="w">' +
      '<div class="preview" data-open><img data-preview alt="" />' +
      '<div class="hint"><span>' + pencil + esc(buttonLabel) + "</span></div></div>" +
      textsHtml +
      '<button type="button" data-open>' + pencil + "<span>" + esc(buttonLabel) + "</span></button>" +
      "</div>";

    // Open the customizer from either the button OR the preview image.
    shadow.querySelectorAll("[data-open]").forEach(function (el) {
      el.addEventListener("click", function () { openOverlay(host); });
    });

    var previewBox = shadow.querySelector(".preview");
    var img = shadow.querySelector("[data-preview]");
    host._walleryImg = img;
    function showPreview(src) {
      img.src = src;
      previewBox.style.display = "block";
    }

    // Motif in the card: cached default (repeat visit) or the admin-generated
    // default the block passes (first visit); updated live while editing. The
    // editor posts WALLERY_PREVIEW on render + on close.
    var cacheKey = "wallery_preview_" + (host.dataset.templateSlug || host.dataset.productHandle || "");
    var shown = false;
    try {
      var cached = localStorage.getItem(cacheKey);
      if (cached) { showPreview(cached); shown = true; }
    } catch (e) { /* storage disabled */ }
    if (!shown && host.dataset.previewUrl) showPreview(host.dataset.previewUrl);

    window.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || d.type !== "WALLERY_PREVIEW" || !d.image) return;
      showPreview(d.image);
      // Cache ONLY the default design (not in-session edits), so a fresh page load
      // shows the generic default — consistent with what the editor opens to.
      if (d.isDefault) {
        try { localStorage.setItem(cacheKey, d.image); } catch (e2) { /* quota */ }
      }
      // If a close is pending (snapshot-on-close), the fresh preview has arrived
      // while still visible — now hide.
      if (host._walleryPendingHide) {
        host._walleryPendingHide = false;
        if (host._walleryHideTimer) clearTimeout(host._walleryHideTimer);
        if (host._walleryOverlay) host._walleryOverlay.hide();
      }
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
