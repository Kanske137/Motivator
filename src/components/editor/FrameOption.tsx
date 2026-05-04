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
  disabledReason?: string;
}

export function FrameOption({ name, thumbnail, svg, selected, onClick, priceLabel, disabled, disabledReason }: Props) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      aria-disabled={disabled}
      className={cn(
        "group relative flex flex-col items-center gap-1.5 rounded-2xl p-1.5 transition",
        disabled && "opacity-40 cursor-not-allowed",
        !disabled && selected
          ? "bg-card ring-2 ring-primary shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
          : !disabled && "bg-card/60 ring-1 ring-border hover:ring-foreground/30 hover:-translate-y-0.5",
        disabled && "bg-card/40 ring-1 ring-border",
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
      <span
        className={cn(
          "text-[10px] leading-none text-center",
          disabled && "text-muted-foreground italic",
          !disabled && priceLabel.startsWith("+") && priceLabel !== "+0 kr" && "text-foreground/70",
          !disabled && priceLabel.startsWith("−") && "text-primary",
          !disabled && (priceLabel === "+0 kr" || (!priceLabel.startsWith("+") && !priceLabel.startsWith("−"))) &&
            "text-muted-foreground",
        )}
      >
        {priceLabel}
      </span>
    </button>
  );
}
