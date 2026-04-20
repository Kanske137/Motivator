import { useRef, useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, Loader2, RefreshCw } from "lucide-react";
import { uploadPrintFile } from "@/lib/storage";
import { toast } from "sonner";

export function StepImage() {
  const { imageUrl, setImageUrl, next, back } = useEditorStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Välj en bildfil");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const url = await uploadPrintFile(file, ext);
      setImageUrl(url);
      toast.success("Bild uppladdad");
    } catch (e) {
      console.error(e);
      toast.error("Uppladdning misslyckades");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <p className="text-sm text-muted-foreground">Ladda upp bilden du vill trycka. Hög upplösning ger bäst resultat.</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      {!imageUrl ? (
        <Card
          onClick={() => inputRef.current?.click()}
          className="p-10 cursor-pointer border-2 border-dashed hover:border-primary transition-colors"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            {uploading ? (
              <Loader2 className="size-10 animate-spin text-primary" />
            ) : (
              <Upload className="size-10 text-muted-foreground" />
            )}
            <p className="font-medium">{uploading ? "Laddar upp…" : "Tryck för att välja bild"}</p>
            <p className="text-xs text-muted-foreground">JPG, PNG, max 20 MB</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          <Card className="overflow-hidden">
            <img src={imageUrl} alt="Uppladdad bild" className="w-full h-auto" />
          </Card>
          <Button variant="outline" className="w-full" onClick={() => inputRef.current?.click()}>
            <RefreshCw className="mr-2 size-4" /> Byt bild
          </Button>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={back}>Tillbaka</Button>
        <Button className="flex-1" disabled={!imageUrl} onClick={next}>Nästa</Button>
      </div>
    </div>
  );
}
