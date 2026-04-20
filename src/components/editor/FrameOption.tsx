import { cn } from "@/lib/utils";

interface Props {
  name: string;
  thumbnail?: string; // image src
  svg?: React.ReactNode; // for "Ingen ram" / canvas depth
  selected: boolean;
  onClick: () => void;
  priceLabel: string;
}

export function FrameOption({ name, thumbnail, svg, selected, onClick, priceLabel }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col items-center gap-1.5 rounded-lg p-1.5 transition",
        selected ? "bg-accent ring-2 ring-primary" : "hover:bg-muted/60 ring-1 ring-border"
      )}
    >
      <div className="relative w-full aspect-square overflow-hidden rounded-md bg-muted">
        {thumbnail ? (
          <img src={thumbnail} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            {svg}
          </div>
        )}
      </div>
      <span className="text-xs font-medium leading-tight">{name}</span>
      <span
        className={cn(
          "text-[10px] leading-none",
          priceLabel.startsWith("+") && "text-foreground/70",
          priceLabel.startsWith("−") && "text-primary",
          !priceLabel.startsWith("+") && !priceLabel.startsWith("−") && "text-muted-foreground"
        )}
      >
        {priceLabel}
      </span>
    </button>
  );
}
