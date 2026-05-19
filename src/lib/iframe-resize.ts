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
  // Mät det verkliga innehållet. I en iframe sträcks <html>, <body> och
  // #root:s flex-barn alltid till minst iframens höjd — så vi mäter inte
  // dem. Vi går ner till de faktiska innehållsblocken (header, editor-root,
  // mockup-galleri) och tar den lägsta verkliga underkanten.
  let contentBottom = 0;
  const measure = (el: Element) => {
    const cs = getComputedStyle(el as HTMLElement);
    if (cs.position === "fixed" || cs.position === "absolute") return;
    if (cs.display === "none") return;
    const rect = (el as HTMLElement).getBoundingClientRect();
    if (rect.height === 0) return;
    const bottom = rect.bottom + window.scrollY;
    if (bottom > contentBottom) contentBottom = bottom;
  };
  // EditorPage-roten är <div class="flex flex-col bg-background"> — dess
  // direkta barn är de verkliga blocken. Mät dem, inte rot-divens som
  // sträcks av iframens höjd.
  const appRoot = root.parentElement ?? document.body;
  for (const child of Array.from(appRoot.children)) {
    measure(child);
  }
  const h = Math.ceil(contentBottom);
  if (!h) return;
  if (Math.abs(h - lastSent) <= 1) return;
  lastSent = h;
  window.parent.postMessage({ type: "EDITOR_RESIZE", height: h }, "*");
}
