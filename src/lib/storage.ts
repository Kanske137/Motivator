import { supabase } from "@/integrations/supabase/client";

export async function uploadPrintFile(file: Blob, ext = "jpg"): Promise<string> {
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("print-files").upload(path, file, {
    contentType: file.type || `image/${ext}`,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("print-files").getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadDataUrl(dataUrl: string, ext = "jpg"): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return uploadPrintFile(blob, ext);
}
