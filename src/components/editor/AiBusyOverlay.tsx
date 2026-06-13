// Fullscreen blur overlay shown whenever any AI flow is active.
// Drives a time-based progress indicator that ramps to 90% over the
// primary job's expectedSeconds, then snaps to 100% on close.
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useIsAnyAiBusy, usePrimaryAiJob } from "@/stores/aiBusyStore";
import { cn } from "@/lib/utils";

export function AiBusyOverlay() {
  const { t } = useTranslation();
  const busy = useIsAnyAiBusy();
  const job = usePrimaryAiJob();

  const [pct, setPct] = useState(0);
  const [visible, setVisible] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const startedAt = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);
  const fadeTimer = useRef<number | null>(null);

  const expectedSeconds = job?.expectedSeconds ?? 15;

  useEffect(() => {
    if (busy) {
      if (fadeTimer.current) {
        window.clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }
      setVisible(true);
      setFadingOut(false);
      if (startedAt.current == null) {
        startedAt.current = performance.now();
        setPct(0);
      }
      const tick = () => {
        if (startedAt.current == null) return;
        const elapsed = (performance.now() - startedAt.current) / 1000;
        const ramped = Math.min(90, (elapsed / Math.max(1, expectedSeconds)) * 90);
        setPct(ramped);
        rafId.current = requestAnimationFrame(tick);
      };
      rafId.current = requestAnimationFrame(tick);
      return () => {
        if (rafId.current) cancelAnimationFrame(rafId.current);
        rafId.current = null;
      };
    }

    // Not busy: snap to 100% and fade out.
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    if (startedAt.current != null) {
      setPct(100);
      setFadingOut(true);
      startedAt.current = null;
      fadeTimer.current = window.setTimeout(() => {
        setVisible(false);
        setPct(0);
        setFadingOut(false);
      }, 350);
    }
    return () => {
      if (fadeTimer.current) {
        window.clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }
    };
  }, [busy, expectedSeconds]);

  if (!visible) return null;

  const displayPct = Math.round(pct);
  const title = job?.label ?? t("ai.overlay.title", { defaultValue: "Skapar din bild" });
  const stage = job?.stage ?? t("ai.overlay.subtitle", { defaultValue: "Det här tar bara en stund …" });

  return (
    <div
      className={cn(
        "fixed inset-0 z-[60] flex items-center justify-center",
        "bg-background/55 backdrop-blur-md",
        "transition-opacity duration-300",
        fadingOut ? "opacity-0" : "opacity-100",
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
      // Swallow all pointer / wheel / touch events.
      onClickCapture={(e) => e.stopPropagation()}
      onWheelCapture={(e) => e.stopPropagation()}
      onTouchMoveCapture={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col items-center gap-3 px-6 py-5 rounded-2xl bg-background/80 ring-1 ring-border shadow-lg min-w-[200px]">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <div className="text-sm font-medium text-foreground text-center">
          {title}
        </div>
        <div className="text-2xl font-semibold tabular-nums text-foreground">
          {displayPct}%
        </div>
        <div className="text-[11px] text-muted-foreground text-center leading-tight max-w-[220px]">
          {stage}
        </div>
      </div>
    </div>
  );
}
