/* Wallery Customizer storefront widget.
 *
 * Mounts into each app-block root as a SHADOW DOM (isolated from the theme's
 * CSS), and inherits the theme's fonts/colours/button style as design tokens so
 * it resembles the store. Built as a standalone, platform-agnostic bundle: only
 * the delivery differs per platform (Shopify app block here; WooCommerce
 * shortcode / plain <script> later) — the widget itself is the same.
 *
 * Scaffold: renders a themed placeholder. Next steps: load the full customizer
 * and wire "add to cart" via the AJAX Cart API with line item properties
 * (_wallery_design, _wallery_preview).
 */
(function () {
  "use strict";

  // --- Read the theme's design tokens (so we resemble the store) -------------
  function readThemeTokens() {
    const body = getComputedStyle(document.body);
    // Sample the theme's add-to-cart button for the primary colour/radius.
    const btn = document.querySelector(
      'product-form button[name="add"], button[name="add"], .product-form__submit, [type="submit"].button, [type="submit"].btn',
    );
    const b = btn ? getComputedStyle(btn) : null;
    const nonEmpty = (v, fallback) =>
      v && v !== "rgba(0, 0, 0, 0)" && v !== "transparent" ? v : fallback;
    return {
      font: body.fontFamily || "system-ui, -apple-system, sans-serif",
      text: nonEmpty(body.color, "#1a1a1a"),
      primary: nonEmpty(b && b.backgroundColor, "#1a1a1a"),
      primaryText: nonEmpty(b && b.color, "#ffffff"),
      radius: (b && b.borderRadius && b.borderRadius !== "0px" ? b.borderRadius : "8px"),
    };
  }

  function mount(host) {
    if (host.dataset.walleryMounted) return;
    host.dataset.walleryMounted = "1";

    const tokens = readThemeTokens();
    const accent = host.dataset.accent || tokens.primary;
    const radius = host.dataset.radius ? host.dataset.radius + "px" : tokens.radius;
    const inheritFonts = host.dataset.inheritFonts !== "false";
    const font = inheritFonts ? tokens.font : "system-ui, -apple-system, sans-serif";
    const slug = host.dataset.templateSlug || "";

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = [
      "<style>",
      ":host { all: initial; display: block; }",
      ".wallery{",
      "  font-family:" + font + ";",
      "  color:" + tokens.text + ";",
      "  --wallery-primary:" + accent + ";",
      "  --wallery-primary-text:" + tokens.primaryText + ";",
      "  --wallery-radius:" + radius + ";",
      "  box-sizing:border-box; width:100%;",
      "  border:1px solid rgba(0,0,0,.12); border-radius:var(--wallery-radius);",
      "  padding:20px; margin:16px 0;",
      "}",
      ".wallery h3{ margin:0 0 6px; font-size:1.15em; }",
      ".wallery p{ margin:0 0 16px; opacity:.7; font-size:.9em; }",
      ".wallery button{",
      "  font:inherit; font-weight:600; cursor:pointer; border:0;",
      "  background:var(--wallery-primary); color:var(--wallery-primary-text);",
      "  border-radius:var(--wallery-radius); padding:12px 22px; width:100%;",
      "}",
      "@media (min-width:600px){ .wallery button{ width:auto; } }",
      "</style>",
      '<div class="wallery">',
      "  <h3>Anpassa din design</h3>",
      "  <p>Skapa din personliga version innan du lägger i varukorgen." +
        (slug ? " (" + slug + ")" : "") +
        "</p>",
      '  <button type="button" data-wallery-open>Öppna anpassaren</button>',
      "</div>",
    ].join("");

    // Placeholder action until the full customizer is wired in.
    const openBtn = shadow.querySelector("[data-wallery-open]");
    if (openBtn) {
      openBtn.addEventListener("click", function () {
        // TODO: launch the customizer; on done -> AJAX cart add with
        // line item properties (_wallery_design, _wallery_preview).
        console.log("[wallery] open customizer for", slug, host.dataset);
      });
    }
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
