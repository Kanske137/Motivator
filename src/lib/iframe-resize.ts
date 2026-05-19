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
  const h = Math.ceil(root.getBoundingClientRect().height);
  if (!h) return;
  if (Math.abs(h - lastSent) <= 1) return;
  lastSent = h;
  window.parent.postMessage({ type: "EDITOR_RESIZE", height: h }, "*");
}
