import { Loader2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface Props {
  price: string;
  summary?: string;
  loading?: boolean;
  disabled?: boolean;
  onAdd: () => void;
  className?: string;
}

export function StickyCta({ price, summary, loading, disabled, onAdd, className }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "w-full bg-foreground text-background border-t border-foreground/20",
        "flex items-center gap-3 px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {summary && (
          <div className="text-[10px] uppercase tracking-wider opacity-60 truncate">{summary}</div>
        )}
        <div className="text-base md:text-lg font-semibold leading-tight">{price}</div>
      </div>
      <Button
        onClick={onAdd}
        disabled={loading || disabled}
        aria-label={t("common.addToCart")}
        className="h-12 md:h-12 rounded-full bg-background text-foreground hover:bg-background/90 px-5 md:px-7 font-semibold disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <span className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            <span className="hidden sm:inline">{t("common.addToCart")}</span>
          </span>
        )}
      </Button>
    </div>
  );
}
