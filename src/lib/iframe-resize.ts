let lastSent = 0;

/**
 * Rapportera editorns sanna höjd till parent-Shopify-iframen.
 * - Mäter .editor-root (innehållsdriven, ingen 100vh i trädet).
 * - Jitter-skydd: skickar bara om höjden ändras med >1px.
 */
export function postEditorResize() {
  if (typeof window === "undefined") return;
  if (window.self === window.top) return;
  const root = document.querySelector(".editor-root") as HTMLElement | null;
  if (!root) return;
  // Mät det verkliga innehållets botten — INTE document/body scrollHeight,
  // som i en iframe aldrig kan bli mindre än iframens egen höjd (ger en
  // feedback-loop som blåser upp höjden och skapar tomt gap).
  let contentBottom = 0;
  const scope = document.getElementById("root") ?? document.body;
  for (const child of Array.from(scope.children)) {
    const rect = (child as HTMLElement).getBoundingClientRect();
    const bottom = rect.bottom + window.scrollY;
    if (bottom > contentBottom) contentBottom = bottom;
  }
  const h = Math.ceil(contentBottom);
  if (!h) return;
  if (Math.abs(h - lastSent) <= 1) return;
  lastSent = h;
  window.parent.postMessage({ type: "EDITOR_RESIZE", height: h }, "*");
}
