// Helper used by the admin LayerInspector to upload a reference image into
// the public `ai-references` bucket. Returns the public URL.
import { supabase } from "@/integrations/supabase/client";

export async function uploadAiReferenceImage(file: File): Promise<string> {
  const ext =
    file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() ||
    (file.type.split("/")[1] ?? "jpg");
  const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  const id = (crypto as { randomUUID?: () => string }).randomUUID?.() ?? `${Date.now()}`;
  const path = `${id}.${safeExt}`;
  const { error } = await supabase.storage
    .from("ai-references")
    .upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("ai-references").getPublicUrl(path);
  return data.publicUrl;
}
