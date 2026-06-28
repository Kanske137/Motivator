import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { SectionMeta, SectionId } from "./ControlPanel";
import { useOnboarding } from "@/hooks/useOnboarding";

interface Props {
  sections: SectionMeta[];
  activeId: SectionId;
  onSelect: (id: SectionId) => void;
  /** "vertical" for desktop rail, "horizontal" for mobile tab bar. */
  orientation?: "vertical" | "horizontal";
  className?: string;
}

export function NavRail({ sections, activeId, onSelect, orientation = "vertical", className }: Props) {
  const { t } = useTranslation();
  const { activeHintSection, hasAnyCompleted } = useOnboarding();
  const isVertical = orientation === "vertical";
  return (
    <nav
      aria-label="Editor sections"
      className={cn(
        isVertical
          ? "flex flex-col w-[70px] shrink-0 border-r bg-background"
          : "flex flex-row overflow-x-auto border-t bg-background",
        className,
      )}
    >
      {sections.map((s) => {
        const Icon = s.icon;
        const active = s.id === activeId;
        const label = t(s.labelKey);
        const showHint = activeHintSection === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            aria-current={active ? "page" : undefined}
            aria-label={label}
            className={cn(
              "relative flex flex-col items-center justify-center gap-1 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              isVertical ? "h-16 w-full" : "min-w-[64px] h-16 flex-1",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
            )}
          >
            {/* Active indicator */}
            <span
              aria-hidden
              className={cn(
                "absolute bg-foreground transition-opacity",
                isVertical ? "left-0 top-2 bottom-2 w-[3px] rounded-r" : "bottom-0 left-3 right-3 h-[3px] rounded-t",
                active ? "opacity-100" : "opacity-0",
              )}
            />
            <div className="relative">
              <Icon className="h-[18px] w-[18px]" />
              {showHint && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 -top-3 -translate-x-1/2 whitespace-nowrap rounded-sm bg-primary px-1 py-px text-[8px] font-semibold uppercase tracking-wide text-primary-foreground shadow-sm animate-fade-in"
                >
                  {t(hasAnyCompleted ? "onboarding.continueHere" : "onboarding.startHere")}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium leading-none tracking-wide">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
