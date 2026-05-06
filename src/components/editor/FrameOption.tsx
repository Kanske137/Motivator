import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface Props {
  name: string;
  thumbnail?: string;
  svg?: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  priceLabel: string;
  disabled?: boolean;
  /** Visas under namnet när disabled (i stället för pris). */
  unavailableLabel?: string;
}

export function FrameOption({
  name,
  thumbnail,
  svg,
  selected,
  onClick,
  priceLabel,
  disabled = false,
  unavailableLabel,
}: Props) {
  const { t } = useTranslation();
  const fallbackUnavailable = t("frame.unavailable");
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled ? unavailableLabel ?? fallbackUnavailable : undefined}
      className={cn(
        "group relative flex flex-col items-center gap-1.5 rounded-2xl p-1.5 transition",
        disabled
          ? "bg-card/40 ring-1 ring-border/60 opacity-50 cursor-not-allowed"
          : selected
            ? "bg-card ring-2 ring-primary shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
            : "bg-card/60 ring-1 ring-border hover:ring-foreground/30 hover:-translate-y-0.5",
      )}
    >
      <div className="relative w-full aspect-square overflow-hidden rounded-xl bg-muted">
        {thumbnail ? (
          <img src={thumbnail} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            {svg}
          </div>
        )}
        {selected && !disabled && (
          <span className="absolute top-1 right-1 inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground shadow">
            <Check className="h-3 w-3" />
          </span>
        )}
      </div>
      <span className="text-xs font-medium leading-tight">{name}</span>
      {disabled ? (
        <span className="text-[9px] leading-tight text-muted-foreground text-center px-0.5">
          {unavailableLabel ?? fallbackUnavailable}
        </span>
      ) : (
        <span
          className={cn(
            "text-[10px] leading-none",
            priceLabel.startsWith("+") && priceLabel !== "+0 kr" && "text-foreground/70",
            priceLabel.startsWith("−") && "text-primary",
            (priceLabel === "+0 kr" || (!priceLabel.startsWith("+") && !priceLabel.startsWith("−"))) &&
              "text-muted-foreground",
          )}
        >
          {priceLabel}
        </span>
      )}
    </button>
  );
}
