// Admin language picker. Lives in the admin header (and Settings). Switching is
// immediate and persisted (see admin-locale). Labels are endonyms so the choice is
// recognizable regardless of the current UI language.
import { useTranslation } from "react-i18next";
import { Languages, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ADMIN_LOCALES, setAdminLocale, type AdminLocale } from "@/lib/admin-locale";

export default function LanguageToggle({ className }: { className?: string }) {
  const { i18n } = useTranslation();
  const current = (i18n.language as AdminLocale) ?? "en";
  const currentLabel =
    ADMIN_LOCALES.find((l) => l.code === current)?.label ?? current.toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={cn("gap-2", className)}>
          <Languages className="h-4 w-4" />
          <span className="hidden sm:inline">{currentLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-auto">
        {ADMIN_LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onSelect={() => setAdminLocale(l.code)}
            className="justify-between gap-6"
          >
            <span>{l.label}</span>
            <Check className={cn("h-4 w-4", l.code === current ? "opacity-100" : "opacity-0")} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
