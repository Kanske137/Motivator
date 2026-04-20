import { useEditorStore } from "@/stores/editorStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function StepText() {
  const { text, setText, next, back, mapAddress } = useEditorStore();

  return (
    <div className="p-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        Lägg till en titel eller text på trycket (valfritt).
      </p>
      <div className="space-y-2">
        <label className="text-sm font-medium">Text</label>
        <Textarea
          placeholder={mapAddress ? `T.ex. "${mapAddress}"` : "T.ex. Vårt hem · Stockholm 2024"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={120}
        />
        <p className="text-xs text-muted-foreground text-right">{text.length} / 120</p>
      </div>
      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={back}>Tillbaka</Button>
        <Button className="flex-1" onClick={next}>{text ? "Nästa" : "Hoppa över"}</Button>
      </div>
    </div>
  );
}
