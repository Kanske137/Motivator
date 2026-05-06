// Customer-side photo upload. Replaces the map content with the uploaded
// image (clipped by the same map-layer shapes). The original photo is uploaded
// lazily to the cart-previews bucket on first AI request — kept here as a
// preview-only File until then.
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Upload, Image as ImageIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/stores/editorStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export function PhotoUploadSection() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const photoFile = useEditorStore((s) => s.photoFile);
  const photoPreviewUrl = useEditorStore((s) => s.photoPreviewUrl);
  const setPhotoSource = useEditorStore((s) => s.setPhotoSource);
  const resetDesignSource = useEditorStore((s) => s.resetDesignSource);

  const onFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (!f) return;
      if (!f.type.match(/^image\//)) {
        toast.error(t("photo.errorOnlyImages"));
        return;
      }
      if (f.size > MAX_BYTES) {
        toast.error(t("photo.errorTooLarge"), {
          description: t("photo.errorTooLargeHint"),
        });
        return;
      }
      // Revoke previous blob URL
      if (photoPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(photoPreviewUrl);
      const url = URL.createObjectURL(f);
      setPhotoSource(f, url);
    },
    [photoPreviewUrl, setPhotoSource],
  );

  const onRemove = () => {
    if (photoPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(photoPreviewUrl);
    resetDesignSource();
  };

  return (
    <div className="space-y-3">
      {!photoFile ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add("ring-primary", "bg-accent/40");
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove("ring-primary", "bg-accent/40");
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("ring-primary", "bg-accent/40");
            onFiles(e.dataTransfer.files);
          }}
          className={cn(
            "w-full h-32 rounded-2xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 transition ring-1 ring-transparent hover:bg-accent/30",
          )}
        >
          <Upload className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm font-medium">Ladda upp bild</span>
          <span className="text-[11px] text-muted-foreground">
            JPG, PNG, WebP · max 25 MB
          </span>
        </button>
      ) : (
        <div className="space-y-2">
          <div className="relative rounded-2xl overflow-hidden border bg-muted aspect-[4/3]">
            {photoPreviewUrl ? (
              <img
                src={photoPreviewUrl}
                alt="Uppladdad bild"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Byt bild
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRemove}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Ta bort
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Dra i bilden för att välja utsnitt inom ramen.
          </p>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
    </div>
  );
}
