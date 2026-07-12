// Sidebar list of all layers in the active orientation.
//   - Click to select
//   - Up/down to reorder zIndex
//   - Eye to toggle visibility lock
//   - Lock icon to lock/unlock everything
//   - Trash to delete
import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, Trash2, Unlock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TemplateLayer } from "@/lib/template-schema";
import { defaultLocks } from "@/lib/template-schema";

interface Props {
  layers: TemplateLayer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onToggleVisibility: (id: string) => void;
  onToggleLockAll: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function LayerList({
  layers,
  selectedId,
  onSelect,
  onMove,
  onToggleVisibility,
  onToggleLockAll,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const typeLabel: Record<TemplateLayer["type"], string> = {
    map: t("admin.layerList.typeMap"),
    text: t("admin.layerList.typeText"),
    image: t("admin.layerList.typeImage"),
    photo: t("admin.layerList.typePhoto"),
    line: t("admin.layerList.typeLine"),
    margin: t("admin.layerList.typeMargin"),
    shape: t("admin.layerList.typeShape"),
  };

  // Display top → bottom = highest zIndex first (matches visual stacking).
  const sorted = [...layers].sort((a, b) => b.zIndex - a.zIndex);

  if (sorted.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        {t("admin.layerList.empty")}
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {sorted.map((layer, idx) => {
        const isSelected = selectedId === layer.id;
        const fullyLocked = Object.values(layer.locks).every((v) => v === true);
        const isHidden = layer.locks.visibility === true && idx === -1; // visibility lock != hidden; we use a separate hidden flag below
        return (
          <li key={layer.id}>
            <div
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-1.5 text-sm cursor-pointer",
                isSelected ? "border-primary bg-accent" : "border-transparent hover:bg-accent/50",
              )}
              onClick={() => onSelect(layer.id)}
            >
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-12 shrink-0">
                {typeLabel[layer.type]}
              </span>
              <span className="flex-1 truncate">{layer.name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title={t("admin.layerList.moveUp")}
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(layer.id, "up");
                }}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title={t("admin.layerList.moveDown")}
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(layer.id, "down");
                }}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title={layer.locks.visibility ? t("admin.layerList.unlockVisibility") : t("admin.layerList.lockVisibility")}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(layer.id);
                }}
              >
                {layer.locks.visibility ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title={fullyLocked ? t("admin.layerList.unlockAll") : t("admin.layerList.lockAll")}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLockAll(layer.id);
                }}
              >
                {fullyLocked ? (
                  <Lock className="h-3.5 w-3.5" />
                ) : (
                  <Unlock className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                title={t("admin.layerList.delete")}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(layer.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Helper used by DesignerPage when toggling "lock all"
export function toggleAllLocks(layer: TemplateLayer): TemplateLayer {
  const allLocked = Object.values(layer.locks).every((v) => v === true);
  const next = allLocked
    ? defaultLocks({
        position: false,
        move: false,
        size: false,
        shape: false,
        content: false,
        font: false,
        visibility: false,
        style: false,
      })
    : defaultLocks({
        position: true,
        move: true,
        size: true,
        shape: true,
        content: true,
        font: true,
        visibility: true,
        style: true,
      });
  return { ...layer, locks: next };
}
