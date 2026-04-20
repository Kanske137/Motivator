import { useEditorStore, type Step } from "@/stores/editorStore";
import { Check } from "lucide-react";

const STEPS: { key: Step; label: string }[] = [
  { key: "product", label: "Produkt" },
  { key: "image", label: "Bild" },
  { key: "map", label: "Karta" },
  { key: "text", label: "Text" },
  { key: "style", label: "Stil" },
  { key: "size", label: "Storlek" },
  { key: "mockup", label: "Förhandsvisa" },
];

export function StepHeader() {
  const { step, productType } = useEditorStore();
  const currentIdx = STEPS.findIndex((s) => s.key === step);
  const nextStep = STEPS[currentIdx + 1];

  return (
    <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Steg {currentIdx + 1} / {STEPS.length}</p>
          <h1 className="text-base font-semibold">{STEPS[currentIdx]?.label}</h1>
        </div>
        {nextStep && (
          <p className="text-xs text-muted-foreground">Nästa: <span className="text-foreground">{nextStep.label}</span></p>
        )}
      </div>
      <div className="flex gap-1 px-4 pb-3">
        {STEPS.map((s, i) => (
          <div
            key={s.key}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < currentIdx ? "bg-primary" : i === currentIdx ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
