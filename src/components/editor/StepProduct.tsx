import { useEditorStore } from "@/stores/editorStore";
import { Card } from "@/components/ui/card";
import { Image as ImageIcon, Frame } from "lucide-react";

export function StepProduct() {
  const { setProductType, next } = useEditorStore();

  const choose = (t: "posters" | "canvas") => {
    setProductType(t);
    next();
  };

  return (
    <div className="p-4 space-y-4">
      <p className="text-sm text-muted-foreground">Vad vill du skapa idag?</p>
      <div className="grid gap-4">
        <Card
          onClick={() => choose("posters")}
          className="p-6 cursor-pointer hover:border-primary transition-colors active:scale-[0.98]"
        >
          <div className="flex items-center gap-4">
            <div className="size-14 rounded-lg bg-primary/10 flex items-center justify-center">
              <Frame className="size-7 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">Personlig Karta – Poster</h3>
              <p className="text-sm text-muted-foreground">Från 199 kr · 6 storlekar · 5 ramval</p>
            </div>
          </div>
        </Card>
        <Card
          onClick={() => choose("canvas")}
          className="p-6 cursor-pointer hover:border-primary transition-colors active:scale-[0.98]"
        >
          <div className="flex items-center gap-4">
            <div className="size-14 rounded-lg bg-primary/10 flex items-center justify-center">
              <ImageIcon className="size-7 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">Personlig Karta – Canvas</h3>
              <p className="text-sm text-muted-foreground">Från 299 kr · 8 storlekar · 2cm / 4cm djup</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
