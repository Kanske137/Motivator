// Single dispatcher for producing a print-ready file URL the Shopify webhook
// can hand directly to Gelato.
//
// ALL sources (map / photo / ai) now go through the multi-layer hi-res
// snapshot renderer so the print file is an exact composite of every layer
// the customer sees in the editor (background, all maps, text, photo with
// shape-clip + pan, lines, margins). The customer-uploaded photo or AI
// result is supplied as `photoOverlayUrl` and rendered into the photo layer.
//
// No silent fallbacks — if any step fails, throw so the caller can show a
// toast and abort the cart-add flow.
import {
  renderHiresTemplateSnapshotSafe,
  type TemplateSnapshotInput,
} from "./template-snapshot";
import { uploadPrintFile } from "./upload-preview";

export type DesignSource = "map" | "photo" | "ai";

export interface PrintPipelineArgs {
  source: DesignSource;
  designId: string;
  /** Required for ALL sources — the multi-layer template input. */
  templateInput: TemplateSnapshotInput;
}

export async function getPrintFileUrl(args: PrintPipelineArgs): Promise<string> {
  const { source, designId, templateInput } = args;

  if (!templateInput) throw new Error("Missing templateInput.");

  // Photo/AI sources require the template to actually have a photo layer
  // (otherwise the uploaded image has nowhere to land).
  if (source === "ai" || source === "photo") {
    const layers =
      templateInput.template.defaultLayout[templateInput.orientation]?.layers;
    const hasPhotoLayer = !!layers?.some((l) => l.type === "photo");
    if (!hasPhotoLayer) {
      throw new Error(
        "Mallen saknar bildplats — be admin lägga till ett bildlager.",
      );
    }
    if (!templateInput.photoOverlayUrl) {
      throw new Error(
        `Source=${source} men ingen photoOverlayUrl tillhandahölls.`,
      );
    }
  }

  const snap = await renderHiresTemplateSnapshotSafe(templateInput);
  const t0 = performance.now();
  const url = await uploadPrintFile(snap.dataUrl, designId);
  const ms = Math.round(performance.now() - t0);
  console.info(
    `[print-pipeline] source=${source}, composite ${snap.widthPx}×${snap.heightPx}px, upload=${ms}ms → ${url}`,
  );
  return url;
}
