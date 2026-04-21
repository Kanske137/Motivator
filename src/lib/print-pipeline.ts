// Single dispatcher for producing a print-ready file URL the Shopify webhook
// can hand directly to Gelato. The SOURCE of the design dictates which path:
//
//   "map"   → render hi-res browser snapshot (Mapbox GL + WebGL)
//   "photo" → upload the user's original file (no re-encoding)
//   "ai"    → already lives in the print-files bucket (uploaded by edge fn)
//
// Every path returns a public URL pointing at the print-files bucket. NO
// silent fallbacks — if any step fails, throw so the caller can show a toast
// and abort the cart-add flow.
import type { SnapshotInput } from "./editor-snapshot";
import { renderHiresSnapshotSafe } from "./editor-snapshot";
import { uploadPrintFile, uploadPrintFileBlob } from "./upload-preview";

export type DesignSource = "map" | "photo" | "ai";

export interface PrintPipelineArgs {
  source: DesignSource;
  designId: string;
  /** Required when source = "map" */
  mapInput?: SnapshotInput;
  /** Required when source = "photo" */
  photoFile?: File;
  /** Required when source = "ai" — already uploaded to print-files. */
  aiPrintFileUrl?: string;
}

export async function getPrintFileUrl(args: PrintPipelineArgs): Promise<string> {
  const { source, designId } = args;

  if (source === "ai") {
    if (!args.aiPrintFileUrl) {
      throw new Error("AI source missing printFileUrl — apply an AI style first.");
    }
    console.info(`[print-pipeline] source=ai, passthrough → ${args.aiPrintFileUrl}`);
    return args.aiPrintFileUrl;
  }

  if (source === "photo") {
    if (!args.photoFile) throw new Error("Photo source missing file.");
    const t0 = performance.now();
    const ext = pickExt(args.photoFile.type);
    const url = await uploadPrintFileBlob(args.photoFile, designId, ext);
    const ms = Math.round(performance.now() - t0);
    console.info(
      `[print-pipeline] source=photo, passthrough ${(args.photoFile.size / 1024 / 1024).toFixed(2)}MB, upload=${ms}ms → ${url}`
    );
    return url;
  }

  // source === "map"
  if (!args.mapInput) throw new Error("Map source missing mapInput.");
  const snap = await renderHiresSnapshotSafe(args.mapInput);
  const t0 = performance.now();
  const url = await uploadPrintFile(snap.dataUrl, designId);
  const ms = Math.round(performance.now() - t0);
  console.info(`[print-pipeline] source=map, upload=${ms}ms → ${url}`);
  return url;
}

function pickExt(mime: string): "jpg" | "png" | "webp" {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}
