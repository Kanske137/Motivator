/* Wallery cart image swap.
 *
 * Replaces the static product image in the cart (cart page, drawer, mini-cart —
 * anywhere) with the customer's saved design preview, for line items that carry
 * our `_preview_image` property. Theme-agnostic: it reads /cart.js for the truth
 * and matches DOM rows by line key (several strategies) with a variant-id
 * fallback, re-running whenever the cart DOM changes (drawer open, ajax update).
 */
(function () {
  "use strict";

  var PROPS = ["_preview_image", "_wallery_preview"];
  var ROW_SEL =
    '[data-key],[data-cart-item],[data-line-item],.cart-item,.cart__row,' +
    '.cart-items__item,cart-drawer-item,[id^="CartItem"],[id^="CartDrawer-Item"]';

  function candidateRows() {
    var out = [];
    document.querySelectorAll(ROW_SEL).forEach(function (r) {
      if (r.getAttribute("data-wallery-swapped") !== "1" && r.querySelector("img")) out.push(r);
    });
    return out;
  }

  function keyFor(row) {
    if (row.dataset && row.dataset.key) return row.dataset.key;
    var q = row.querySelector('[name^="updates["]');
    if (q) {
      var m = (q.getAttribute("name") || "").match(/updates\[(.+?)\]/);
      if (m) return m[1];
    }
    var link = row.querySelector('a[href*="/cart/change"]');
    if (link) {
      var m2 = (link.getAttribute("href") || "").match(/[?&]id=([^&]+)/);
      if (m2) return decodeURIComponent(m2[1]);
    }
    return null;
  }

  function variantFor(row) {
    if (row.dataset && row.dataset.variantId) return String(row.dataset.variantId);
    var a = row.querySelector('a[href*="variant="]');
    if (a) {
      var m = (a.getAttribute("href") || "").match(/[?&]variant=(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  function urlFrom(props) {
    if (!props) return null;
    for (var i = 0; i < PROPS.length; i++) if (props[PROPS[i]]) return props[PROPS[i]];
    return null;
  }

  function run() {
    var rows = candidateRows();
    if (!rows.length) return; // nothing to do (not on a cart surface)
    fetch("/cart.js", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cart) {
        if (!cart || !cart.items) return;
        var byKey = {}, byVariant = {}, any = false;
        cart.items.forEach(function (it) {
          var url = urlFrom(it.properties);
          if (!url) return;
          any = true;
          byKey[it.key] = url;
          byVariant[String(it.variant_id)] = url;
        });
        if (!any) return;
        rows.forEach(function (row) {
          var url = null;
          var k = keyFor(row);
          if (k && byKey[k]) url = byKey[k];
          if (!url) {
            var v = variantFor(row);
            if (v && byVariant[v]) url = byVariant[v];
          }
          if (!url) return;
          var img = row.querySelector("img");
          if (!img) return;
          img.removeAttribute("srcset");
          img.removeAttribute("data-srcset");
          img.removeAttribute("data-src");
          img.srcset = "";
          img.src = url;
          row.setAttribute("data-wallery-swapped", "1");
        });
      })
      .catch(function () {});
  }

  var t = null;
  function schedule() {
    if (t) return;
    t = setTimeout(function () { t = null; run(); }, 200);
  }

  if (document.readyState !== "loading") schedule();
  document.addEventListener("DOMContentLoaded", schedule);
  try {
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  } catch (e) {
    /* observer unavailable */
  }
})();
