// Validates and prepares a user-uploaded photo for the print pipeline.
// We keep the ORIGINAL file untouched (passed through to Gelato) and create a
// downscaled preview (max 1500px longest side) for fast editor rendering.
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MIN_SHORT_EDGE_PX = 1500; // Gelato print quality threshold
const PREVIEW_MAX_EDGE = 1500;

export interface PhotoSource {
  /** Original file — uploaded as-is to print-files bucket. */
  file: File;
  /** Object URL of a downscaled preview, used by editor canvas (cheap to render). */
  previewUrl: string;
  widthPx: number;
  heightPx: number;
  sizeBytes: number;
}

export async function preparePhotoSource(file: File): Promise<PhotoSource> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Bilden måste vara JPEG, PNG eller WebP.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`Bilden är för stor (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`);
  }

  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  const shortEdge = Math.min(img.width, img.height);
  if (shortEdge < MIN_SHORT_EDGE_PX) {
    URL.revokeObjectURL(url);
    throw new Error(
      `Bilden är för liten för print (${img.width}×${img.height}). Minst ${MIN_SHORT_EDGE_PX} px på kortaste sidan krävs.`
    );
  }

  // Downscale for editor preview to keep UI snappy.
  const longest = Math.max(img.width, img.height);
  if (longest <= PREVIEW_MAX_EDGE) {
    return {
      file,
      previewUrl: url,
      widthPx: img.width,
      heightPx: img.height,
      sizeBytes: file.size,
    };
  }
  const scale = PREVIEW_MAX_EDGE / longest;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { file, previewUrl: url, widthPx: img.width, heightPx: img.height, sizeBytes: file.size };
  }
  ctx.drawImage(img, 0, 0, w, h);
  const previewBlob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("preview toBlob failed"))), "image/jpeg", 0.85)
  );
  URL.revokeObjectURL(url);
  return {
    file,
    previewUrl: URL.createObjectURL(previewBlob),
    widthPx: img.width,
    heightPx: img.height,
    sizeBytes: file.size,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Kunde inte läsa bilden."));
    img.src = src;
  });
}
