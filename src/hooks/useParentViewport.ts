import { useEffect, useState } from "react";

export interface ParentViewport {
  /** Pixel-offset i iframens egna koordinater där det synliga området börjar. */
  visibleTop: number;
  /** Höjd på den synliga delen av iframen i mobilens fönster. */
  visibleHeight: number;
}

/**
 * Lyssnar på `SHOP_VIEWPORT`-meddelanden från Shopify-temat så att overlays
 * (t.ex. mobil-drawer) kan ankras till den del av iframen som faktiskt syns
 * i kundens fönster — inte hela iframens innehållshöjd.
 *
 * Fallback (utan parent-message, t.ex. när temat ännu inte uppdaterats eller
 * när vi kör utanför iframe): använder `visualViewport` / `window.innerHeight`.
 */
export function useParentViewport(): ParentViewport {
  const [vp, setVp] = useState<ParentViewport>(() => readLocalFallback());

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== "object" || d.type !== "SHOP_VIEWPORT") return;
      const visibleTop = Number(d.iframeVisibleTop);
      const visibleHeight = Number(d.visibleHeight);
      if (!Number.isFinite(visibleTop) || !Number.isFinite(visibleHeight)) return;
      if (visibleHeight <= 0) return;
      setVp({ visibleTop: Math.max(0, visibleTop), visibleHeight });
    };
    window.addEventListener("message", onMessage);

    // Lokal fallback — håll i synk om iframens egen visualViewport ändras
    // (mjukvarutangentbord, rotation osv).
    const updateLocal = () => setVp((prev) => {
      // Endast om vi inte fått ett SHOP_VIEWPORT nyligen — då har parent
      // bättre information. Vi detekterar det grovt: ifall visibleTop === 0
      // och visibleHeight ≈ window.innerHeight, så är vi i fallback-läge.
      const fallback = readLocalFallback();
      const isFallback = prev.visibleTop === 0 && Math.abs(prev.visibleHeight - window.innerHeight) < 4;
      return isFallback ? fallback : prev;
    });
    window.addEventListener("resize", updateLocal);
    window.visualViewport?.addEventListener("resize", updateLocal);
    window.visualViewport?.addEventListener("scroll", updateLocal);

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("resize", updateLocal);
      window.visualViewport?.removeEventListener("resize", updateLocal);
      window.visualViewport?.removeEventListener("scroll", updateLocal);
    };
  }, []);

  return vp;
}

function readLocalFallback(): ParentViewport {
  if (typeof window === "undefined") return { visibleTop: 0, visibleHeight: 800 };
  const h = window.visualViewport?.height ?? window.innerHeight ?? 800;
  return { visibleTop: 0, visibleHeight: Math.round(h) };
}
