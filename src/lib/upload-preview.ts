// Uploads the customer's editor snapshot to the public `cart-previews` bucket
// so Shopify can show it as the line-item thumbnail. We compress to JPEG at
// modest dimensions (~800px longest side) — keeps files <400 kB and uploads fast.
//
// Print files (hi-res) go to the `print-files` bucket — pass-through, no resize.
import { supabase } from "@/integrations/supabase/client";

const MAX_LONG_EDGE = 800;
const JPEG_QUALITY = 0.82;

async function compressDataUrl(dataUrl: string): Promise<Blob> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("snapshot image load failed"));
    img.src = dataUrl;
  });

  const longest = Math.max(img.width, img.height);
  const scale = longest > MAX_LONG_EDGE ? MAX_LONG_EDGE / longest : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D ctx unavailable for compress");
  ctx.drawImage(img, 0, 0, w, h);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

/** Upload snapshot dataURL to cart-previews. Returns public URL. */
export async function uploadCartPreview(dataUrl: string, designId: string): Promise<string> {
  const blob = await compressDataUrl(dataUrl);
  const path = `${designId}.jpg`;
  const { error } = await supabase.storage
    .from("cart-previews")
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("cart-previews").getPublicUrl(path);
  return data.publicUrl;
}

/** Upload a hi-res print-quality JPEG dataURL to print-files (no recompression).
 *  Returns the public URL Gelato will fetch. */
export async function uploadPrintFile(dataUrl: string, designId: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return uploadPrintFileBlob(blob, designId, "jpg");
}

/** Upload a raw Blob/File directly to print-files. Used for photo pass-through
 *  and AI images where the source is already a binary, not a dataURL. */
export async function uploadPrintFileBlob(
  blob: Blob,
  designId: string,
  ext: "jpg" | "png" | "webp" = "jpg"
): Promise<string> {
  const contentType =
    blob.type && blob.type.startsWith("image/")
      ? blob.type
      : ext === "png"
      ? "image/png"
      : ext === "webp"
      ? "image/webp"
      : "image/jpeg";
  const path = `${designId}.${ext}`;
  const { error } = await supabase.storage
    .from("print-files")
    .upload(path, blob, { contentType, upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("print-files").getPublicUrl(path);
  return data.publicUrl;
}
