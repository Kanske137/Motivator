// Edge function: face-swap / background-removal for the editor's aiPhoto
// layer. Routed by `subjectKind`:
//
//   subjectKind === "human"
//     → Replicate `cdingram/face-swap` (dedicated human face-swap model;
//       structured input_image/swap_image; works very well on people).
//
//   subjectKind === "pet"
//     → Lovable AI Gateway, Nano Banana 2 (`google/gemini-3.1-flash-image-preview`).
//       Multi-image edit: reference scene + customer pet photo. Animals don't
//       have the facial-landmark structure that face-swap models depend on,
//       so a general identity-aware editor produces much better results for
//       both cats and dogs.
//
//   subjectKind === "removeBackground"
//     → Lovable AI Gateway, Nano Banana 2. SINGLE image: customer's photo.
//       The model removes the background, places the subject on a white
//       backdrop and surrounds it with a soft watercolor/dot ring. An
//       optional AI style preset (sent as removeBackgroundStylePrompt) is
//       applied to the SUBJECT only; the background-removal + dot-ring
//       effect is enforced regardless.
//
// Inputs (JSON body):
//   referenceImageUrl  — admin's curated body/scene image (REQUIRED for
//                        human/pet, ignored for removeBackground)
//   faceImageUrl       — customer's uploaded photo (always REQUIRED)
//   prompt             — admin's free-text instruction
//   subjectKind        — human | pet | removeBackground
//   designId           — used for the output filename
//   removeBackgroundStyleId / removeBackgroundStylePrompt /
//   removeBackgroundStyleLabel — optional, only used in removeBackground mode
//
// Always returns HTTP 200. On recoverable errors the body is
// { error, fallback: true, userMessage } so the client can show a friendly
// toast instead of crashing on a non-2xx.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { replicatePredict } from "../_shared/replicate.ts";
import { runRecipe, type ExecRecipe } from "../_shared/ai-models.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Replicate human face-swap model. Pinned to a specific version for stability.
const FACE_SWAP_MODEL_VERSION =
  "cdingram/face-swap:d1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111";
const FACE_SWAP_MODEL_NAME = "cdingram/face-swap";

// Nano Banana (Gemini image) via Replicate — same REPLICATE_API_TOKEN as the
// other models, so ALL AI now runs through Replicate (no Lovable gateway).
const NANO_BANANA_URL =
  "https://api.replicate.com/v1/models/google/nano-banana/predictions";
const ANIMAL_MODEL = "google/nano-banana";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fallbackResponse(userMessage: string, internal: string) {
  console.error(`[face-swap] fallback: ${internal}`);
  return jsonResponse({
    error: internal,
    fallback: true,
    userMessage,
  });
}

// Decode JPEG/PNG/WebP dimensions. Returns null when the format isn't
// recognised — we then skip the dimension sanity check.
function readImageSize(bytes: Uint8Array): { w: number; h: number } | null {
  // PNG: 8-byte signature, then IHDR with width/height as big-endian u32.
  if (
    bytes.length > 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  // JPEG: scan SOF markers for size.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      i += 2;
      if (marker === 0xd8 || marker === 0xd9) return null;
      const len = (bytes[i] << 8) | bytes[i + 1];
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        const h = (bytes[i + 3] << 8) | bytes[i + 4];
        const w = (bytes[i + 5] << 8) | bytes[i + 6];
        return { w, h };
      }
      i += len;
    }
  }
  return null;
}

// Convert a base64 string (possibly a data URL) to a Uint8Array.
function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.startsWith("data:")
    ? b64.slice(b64.indexOf(",") + 1)
    : b64;
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- Route 1: Replicate human face-swap ----------
async function runReplicateFaceSwap(params: {
  referenceImageUrl: string;
  faceImageUrl: string;
  designId: string;
}): Promise<{ ok: true; bytes: Uint8Array; contentType: string; outputUrl: string }
  | { ok: false; response: Response }> {
  const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
  if (!REPLICATE_API_TOKEN) {
    return {
      ok: false,
      response: fallbackResponse(
        "Tjänsten är tillfälligt otillgänglig. Försök igen senare.",
        "REPLICATE_API_TOKEN not configured",
      ),
    };
  }

  // Adapter: Replicate cdingram/face-swap via the shared prediction runner.
  const res = await replicatePredict({
    apiKey: REPLICATE_API_TOKEN,
    endpoint: "https://api.replicate.com/v1/predictions",
    body: {
      version: FACE_SWAP_MODEL_VERSION.split(":")[1],
      input: {
        input_image: params.referenceImageUrl,
        swap_image: params.faceImageUrl,
      },
    },
    waitSeconds: 30,
    deadlineMs: 90_000,
  });

  if (!res.ok) {
    if (res.stage === "start") {
      console.error("[face-swap] replicate start failed", res.error);
      return {
        ok: false,
        response: fallbackResponse(
          "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
          `Replicate start failed: ${res.status}`,
        ),
      };
    }
    if (res.stage === "output") {
      return {
        ok: false,
        response: fallbackResponse(
          "Vi kunde inte hitta något tydligt ansikte i din bild. Prova en annan bild med tydligt ansikte och bra ljus.",
          "Replicate succeeded but produced no output URL",
        ),
      };
    }
    if (res.stage === "fetch") {
      return {
        ok: false,
        response: fallbackResponse(
          "Vi kunde inte hämta den genererade bilden. Försök igen.",
          `Replicate image fetch failed ${res.status}`,
        ),
      };
    }
    // stage "poll": failed / canceled / timeout — usually a missing face.
    const errStr = res.error.toLowerCase();
    const noFace =
      errStr.includes("no face") ||
      errStr.includes("face not detected") ||
      errStr.includes("could not detect");
    return {
      ok: false,
      response: fallbackResponse(
        noFace
          ? "Vi kunde inte hitta något ansikte i din bild. Prova en annan bild med tydligt ansikte och bra ljus."
          : "Vi kunde inte skapa bilden den här gången. Prova en annan bild eller försök igen.",
        `Replicate poll: ${res.error}`,
      ),
    };
  }

  return { ok: true, bytes: res.bytes, contentType: res.contentType, outputUrl: res.outputUrl };
}

// ---------- Shared helper: call Nano Banana 2 via Lovable AI Gateway ----------
// Sends one user message with `promptText` plus an arbitrary number of input
// images. Returns either the decoded image bytes or a Response wrapping a
// friendly error.
//
// Resilience: the underlying Google Vertex pool for Nano Banana 2 frequently
// returns transient 429 (Resource Exhausted) when several requests land within
// a few seconds, and the model occasionally responds with text instead of an
// image. We auto-retry the EXACT same payload up to 2 times with exponential
// backoff (4s, 8s) so the customer doesn't have to manually re-trigger the
// generation. The payload itself (prompt, modalities, model, images) is never
// changed — output bytes are identical to a single-shot call when it succeeds.
async function callNanoBananaOnce(params: {
  promptText: string;
  imageUrls: string[];
  apiKey: string;
}): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string; outputUrl: string }
  | { ok: false; retriable: boolean; status: number; reason: string; userMessage: string }
> {
  // Adapter: Replicate google/nano-banana via the shared prediction runner.
  const res = await replicatePredict({
    apiKey: params.apiKey,
    endpoint: NANO_BANANA_URL,
    body: {
      input: {
        prompt: params.promptText,
        image_input: params.imageUrls,
        output_format: "png",
      },
    },
    waitSeconds: 55,
    deadlineMs: 60_000,
  });

  if (res.ok) {
    return { ok: true, bytes: res.bytes, contentType: res.contentType, outputUrl: res.outputUrl };
  }

  if (res.stage === "start") {
    console.error("[face-swap] Replicate nano-banana error", res.status, res.error);
    if (res.status === 429) {
      return {
        ok: false,
        retriable: true,
        status: 429,
        reason: "Replicate rate-limited (429)",
        userMessage:
          "AI-tjänsten är överbelastad just nu. Vänta 10–15 sekunder och försök igen.",
      };
    }
    if (res.status === 402) {
      return {
        ok: false,
        retriable: false,
        status: 402,
        reason: "Replicate credits exhausted (402)",
        userMessage: "AI-krediten är slut. Kontakta supporten så löser vi det.",
      };
    }
    // 5xx are likely transient — retry. Other 4xx are not.
    return {
      ok: false,
      retriable: res.status >= 500,
      status: res.status,
      reason: `Replicate error ${res.status}: ${res.error}`,
      userMessage: "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
    };
  }

  if (res.stage === "fetch") {
    return {
      ok: false,
      retriable: res.status >= 500,
      status: res.status,
      reason: `AI image fetch failed ${res.status}`,
      userMessage: "Vi kunde inte hämta den genererade bilden. Försök igen.",
    };
  }

  // stage "poll" (failed/canceled/timeout) or "output" (missing image).
  console.error("[face-swap] Replicate produced no image", res.error);
  return {
    ok: false,
    retriable: true,
    status: 200,
    reason: `Replicate ${res.stage}: ${res.error}`,
    userMessage:
      "AI-modellen returnerade ingen bild den här gången. Försök igen.",
  };
}

async function callNanoBanana(params: {
  promptText: string;
  imageUrls: string[];
}): Promise<{ ok: true; bytes: Uint8Array; contentType: string; outputUrl: string }
  | { ok: false; response: Response }> {
  const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
  if (!REPLICATE_API_TOKEN) {
    return {
      ok: false,
      response: fallbackResponse(
        "Tjänsten är tillfälligt otillgänglig. Försök igen senare.",
        "REPLICATE_API_TOKEN not configured",
      ),
    };
  }

  // Backoff schedule between retries (ms). Total worst-case extra latency: 12s.
  const BACKOFF_MS = [4000, 8000];
  const MAX_ATTEMPTS = BACKOFF_MS.length + 1; // 1 initial + 2 retries

  let lastFail:
    | { reason: string; userMessage: string; status: number }
    | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await callNanoBananaOnce({
      promptText: params.promptText,
      imageUrls: params.imageUrls,
      apiKey: REPLICATE_API_TOKEN,
    });

    if (result.ok) {
      if (attempt > 1) {
        console.log(`[face-swap] succeeded on retry attempt ${attempt}/${MAX_ATTEMPTS}`);
      }
      return result;
    }

    lastFail = {
      reason: result.reason,
      userMessage: result.userMessage,
      status: result.status,
    };

    if (!result.retriable || attempt === MAX_ATTEMPTS) break;

    const wait = BACKOFF_MS[attempt - 1];
    console.log(
      `[face-swap] retriable failure (${result.reason}) — backing off ${wait}ms ` +
        `before attempt ${attempt + 1}/${MAX_ATTEMPTS}`,
    );
    await new Promise((r) => setTimeout(r, wait));
  }

  return {
    ok: false,
    response: fallbackResponse(
      lastFail?.userMessage ??
        "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
      `${lastFail?.reason ?? "unknown"} (after ${MAX_ATTEMPTS} attempts)`,
    ),
  };
}

// ---------- Route 2b: pet face/identity transfer (cats + dogs) ----------
async function runPetSwap(params: {
  referenceImageUrl: string;
  faceImageUrl: string;
  adminPrompt: string;
}) {
  const adminPromptLine = params.adminPrompt?.trim()
    ? `Additional styling guidance from the artist: ${params.adminPrompt.trim()}`
    : "";

  const promptText = [
    `You are editing image #1 (the reference scene). Image #2 is a photograph of the customer's own pet (a cat or a dog).`,
    `Replace the pet that appears in image #1 with the specific pet from image #2 — keep the unique markings, fur color/pattern, breed traits, eye color, ear shape and overall identity from image #2.`,
    `Keep EVERYTHING ELSE from image #1 unchanged: the costume/clothing, props, background, lighting, camera angle, art style, composition, framing, and aspect ratio. Do not change the pose unless required to make the new pet fit naturally.`,
    `Return ONE single edited image (NOT a collage, NOT side-by-side, NOT a comparison). Output must have the same aspect ratio as image #1.`,
    adminPromptLine,
  ].filter(Boolean).join("\n");

  return callNanoBanana({
    promptText,
    imageUrls: [params.referenceImageUrl, params.faceImageUrl],
  });
}

// ---------- Route 3: remove background + dot/splatter ring ----------
// Single-image edit. The customer's photo is the only input. The admin
// reference image is intentionally NOT used — this mode is meant to work
// even when the template has no reference. An optional `stylePrompt`
// (from the template's AI style presets) is applied to the SUBJECT only;
// the background-removal + dot-ring effect is enforced regardless.
async function runRemoveBackground(params: {
  faceImageUrl: string;
  adminPrompt: string;
  stylePrompt: string | null;
  styleLabel: string | null;
  targetAspectRatio: number | null;
  backdropColor: string | null;
  fillFrame: boolean;
  preserveSubjectColors: boolean;
  designId: string;
  fluxStylePrompt: string | null;
  subjectKind: "removeBackground";
  simpleStyleMode: boolean;
  styleInstruction: string | null;
}) {
  // Detect whether the chosen AI style is a watercolor style. The colorful
  // dot/splatter ring is ONLY appropriate for watercolor — for any other
  // style (pencil sketch, line-art, oil, cartoon, vector, etc.) the dots
  // would clash visually, so we suppress them and rely on a soft pigment-
  // free fade-out instead.
  const styleHaystack = `${params.stylePrompt ?? ""} ${params.styleLabel ?? ""}`.toLowerCase();
  const isWatercolorStyle =
    !params.stylePrompt?.trim() || // default (no style picked) = watercolor dots
    /water\s*colou?r|akvarell|aquarelle/.test(styleHaystack);

  const backdropHex = params.backdropColor ?? "#FFFFFF";
  const backdropIsWhite = backdropHex.toUpperCase() === "#FFFFFF";

  const adminPromptLine = params.adminPrompt?.trim()
    ? (isWatercolorStyle
        ? `HIGH-PRIORITY artist guidance for the dot/splatter color tones and density (this overrides any conflicting default below): ${params.adminPrompt.trim()}`
        : `HIGH-PRIORITY artist guidance (this overrides any conflicting default below — apply only where compatible with the chosen style, do NOT use it as an excuse to add watercolor dots or splatters): ${params.adminPrompt.trim()}`)
    : "";

  const preserveColorsLine = params.preserveSubjectColors
    ? `PRESERVE SUBJECT COLORS — keep the subject's original colors, hue, saturation, paint/material tone and lighting exactly as in the input photo. Any artistic style applied later is a SURFACE TREATMENT only and must NOT shift the subject's base colors (e.g. a red car must stay the same red, skin tone must stay the same).`
    : "";

  const styleBlock = params.stylePrompt?.trim()
    ? [
        `Apply the following artistic style to THE SUBJECT itself (not to the background):`,
        params.stylePrompt.trim(),
        isWatercolorStyle
          ? `IMPORTANT: regardless of the style above, the background must remain the configured backdrop with the organic, asymmetric watercolor splatter described below — NEVER arranged as a ring, circle, halo or border. Do NOT bring back the original photo background. Do NOT extend the style into the background — only the subject is restyled.`
          : `IMPORTANT: the background must remain the configured backdrop with NOTHING on it — no watercolor dots, no paint splatters, no droplets, no pigment flecks, no colored marks of any kind. Do NOT bring back the original photo background. Do NOT extend the style into the background — only the subject is restyled. The chosen style is NOT watercolor, so the decorative dot/splatter ring must be completely omitted.`,
      ].join("\n")
    : "";

  // Step 2 — backdrop instruction parameterised by hex color.
  const backdropInstruction = backdropIsWhite
    ? `2. Place the subject on a backdrop that is PURE WHITE — exact RGB (255,255,255) / hex #FFFFFF. The background must be perfectly neutral white with ZERO tint: no cream, no beige, no ivory, no off-white, no warm/cool cast, no subtle gradient, no paper texture, no vignette, no shadow halo around the subject. The pure-white backdrop must extend cleanly all the way to all four edges of the output image.`
    : `2. Place the subject on a backdrop that is exactly the solid color ${backdropHex}. The backdrop must be perfectly flat and uniform — no gradient, no texture, no vignette, no shadow halo around the subject — and must extend cleanly to all four edges of the output image. Do not introduce any other color in the background.`;

  const surroundColorPhrase = backdropIsWhite ? "pure white (#FFFFFF)" : `the backdrop color ${backdropHex}`;

  const ringInstruction = isWatercolorStyle
    ? `3. Add loose, organic watercolor splatter and irregular paint droplets close around the subject only — scattered naturally and asymmetrically, varied in size, hand-painted feel. Default tones: warm earthy colors (amber, rust, soft brown, hint of pink). Keep the splatter concentrated near the subject and fading out naturally into the surrounding ${surroundColorPhrase}. CRITICAL: do NOT arrange the splatter into any ring, circle, oval, halo, wreath or border formation around the subject. No evenly spaced or evenly distributed dots. No geometric framing of the subject. The splatter must look like spontaneous, random paint marks — never a decorative outline.`
    : `3. Do NOT add any watercolor dots, paint splatters, droplets, pigment flecks or colored marks around the subject. The area surrounding the subject must be completely empty ${surroundColorPhrase}. The splatter decoration is reserved exclusively for the watercolor style and must be entirely omitted for the chosen style.`;

  const edgeInstruction = isWatercolorStyle
    ? `4. CRITICAL EDGE TREATMENT — applies to the ENTIRE silhouette on ALL FOUR sides equally: the subject must NOT have a hard, clean cut-out silhouette against the backdrop. The full perimeter should softly dissolve and feather into loose watercolor washes, gentle pigment bleeds, wispy translucent edges, and a few stray paint droplets that flow organically into the surrounding ${surroundColorPhrase}. The fade must be visibly symmetrical on top, bottom, left and right. Keep the subject's key features and important details crisp and in focus. No sharp masking artifacts, no visible cut-out outline, no halo or fringe of off-color pixels around the subject.`
    : `4. CRITICAL EDGE TREATMENT — applies to the ENTIRE silhouette on ALL FOUR sides equally: the subject must NOT have a hard, clean cut-out silhouette against the backdrop. The full perimeter must softly feather and fade into the surrounding ${surroundColorPhrase} using ONLY techniques native to the chosen style (e.g. softened pencil strokes for sketch, dissolving line-work for line-art, loose brushstrokes for painting styles) — NEVER by adding watercolor washes, paint splatters or colored droplets. The fade must be visibly symmetrical on all four sides. Keep the subject's key features and important details crisp and in focus. No sharp masking artifacts, no visible cut-out outline, no halo or fringe of off-color pixels around the subject.`;

  // Step 5 — framing. Either "fill the frame" (legacy) OR "preserve framing".
  const framingInstruction = params.fillFrame
    ? (isWatercolorStyle
        ? `5. FILL THE FRAME — the subject must be SCALED UP to fill as much of the output image as possible while keeping the soft watercolor feathered edge intact on all four sides. Aim for the subject (including its dissolving watercolor halo) to occupy roughly 90-95% of the output canvas, leaving only a thin (~2-5%) sliver of ${surroundColorPhrase} at the very outer edge. DO NOT leave large empty backdrop margins around the subject. The watercolor splatter should fade from full intensity at the subject down to nothing within that thin outer sliver, with no hard splatters touching or bleeding off any of the four edges — and NEVER forming a ring or oval around the subject.`
        : `5. FILL THE FRAME — the subject must be SCALED UP to fill as much of the output image as possible while keeping a soft style-native feathered edge on all four sides. Aim for the subject to occupy roughly 90-95% of the output canvas, leaving only a thin (~2-5%) sliver of ${surroundColorPhrase} at the very outer edge. DO NOT leave large empty backdrop margins around the subject. Nothing should touch or bleed off any of the four edges, and the soft fade from styled subject into the backdrop must look symmetrical on all four sides.`)
    : `5. PRESERVE EXACT FRAMING — the subject must keep the SAME position, scale, rotation, perspective and crop as it has in the input photo. Do NOT zoom in, zoom out, re-center, re-crop, rotate, mirror or otherwise re-frame the subject. The only thing that changes from input to output is the background (replaced with the configured backdrop) and, where applicable, the surface treatment from the chosen art style. Empty backdrop margins around the subject are EXPECTED and CORRECT — do not try to fill them by enlarging the subject.`;

  function aspectLabel(ar: number): string {
    const candidates: Array<{ label: string; value: number }> = [
      { label: "1:1", value: 1 },
      { label: "4:5", value: 4 / 5 },
      { label: "3:4", value: 3 / 4 },
      { label: "2:3", value: 2 / 3 },
      { label: "9:16", value: 9 / 16 },
      { label: "5:4", value: 5 / 4 },
      { label: "4:3", value: 4 / 3 },
      { label: "3:2", value: 3 / 2 },
      { label: "16:9", value: 16 / 9 },
    ];
    let best = candidates[0];
    let bestDiff = Math.abs(ar - best.value);
    for (const c of candidates) {
      const d = Math.abs(ar - c.value);
      if (d < bestDiff) { best = c; bestDiff = d; }
    }
    return best.label;
  }

  const aspectInstruction = params.targetAspectRatio && params.targetAspectRatio > 0
    ? (params.fillFrame
        ? `Return ONE single edited image with an output aspect ratio of approximately ${aspectLabel(params.targetAspectRatio)} (width:height ≈ ${params.targetAspectRatio.toFixed(3)}). The whole subject must be visible and SCALED UP to fill the output frame as much as possible. Never stretch or distort the subject. No collage, no side-by-side, no before/after comparison.`
        : `Return ONE single edited image with an output aspect ratio of approximately ${aspectLabel(params.targetAspectRatio)} (width:height ≈ ${params.targetAspectRatio.toFixed(3)}). Keep the subject's original position and scale from the input — do NOT enlarge it to fill the new aspect ratio; simply extend the backdrop as needed. No collage, no side-by-side.`)
    : (params.fillFrame
        ? `Return ONE single edited image with the same aspect ratio as the input. The subject must fill the frame as much as possible. No collage, no side-by-side, no before/after comparison.`
        : `Return ONE single edited image with the same aspect ratio as the input. Keep the subject's original position and scale. No collage, no side-by-side.`);

  // Style-neutral motif/isolation block from the template config. Inserted
  // BEFORE the customer's chosen style so style words always win at the end.
  // MUST NOT contain artistic style language — that's the customer's choice.
  const fluxMotifBlock = params.fluxStylePrompt?.trim() ?? "";

  const promptText = [
    `Edit the input photo:`,
    `1. Isolate the main subject in the photo and COMPLETELY REMOVE the original background.`,
    preserveColorsLine,
    adminPromptLine,
    fluxMotifBlock,
    backdropInstruction,
    ringInstruction,
    edgeInstruction,
    framingInstruction,
    `6. Keep the subject's identity, shape, surfaces, colors and proportions exactly as in the input photo unless an artistic style is specified below.`,
    styleBlock,
    aspectInstruction,
  ].filter(Boolean).join("\n");

  // simpleStyleMode: short Kontext-Pro instruction, then bg-remove. Skips
  // ALL the legacy prompt construction below.
  if (params.simpleStyleMode) {
    const instructionRaw = (params.styleInstruction?.trim() || params.stylePrompt?.trim()) ?? "";
    if (instructionRaw.length > 0) {
      console.log(
        `[runRemoveBackground] simpleStyleMode active — routing to kontext-simple ` +
          `styleLabel="${params.styleLabel}" instruction="${instructionRaw}"`,
      );
      return callKontextSimpleStyle({
        faceImageUrl: params.faceImageUrl,
        instruction: instructionRaw,
        designId: params.designId,
      });
    }
    console.warn(
      `[runRemoveBackground] simpleStyleMode=true but no styleInstruction/prompt — falling back to Nano-Banana`,
    );
  }

  const fluxEnabled = Deno.env.get("FLUX_REMOVEBG_ENABLED") === "true";
  const useFlux =
    params.subjectKind === "removeBackground" &&
    typeof params.fluxStylePrompt === "string" &&
    params.fluxStylePrompt.trim().length > 0 &&
    fluxEnabled;

  // Build a SEPARATE compact prompt for Flux Kontext Pro. Flux follows the
  // first concrete instruction it sees, so the 4300-char Nano-Banana prompt
  // (with "PRESERVE SUBJECT COLORS", "keep colors exactly", "FILL THE FRAME
  // 90-95%", etc.) drowns out the customer's style. Style words MUST come
  // last so they win. Backdrop is mid-grey #7f7f7f (validated against
  // 851-labs/background-remover); the bg-remover step strips it and returns
  // RGBA, so the customer-facing backdropColor still applies in
  // snapshot/preview.
  const styleLabelLower = (params.styleLabel ?? "").toLowerCase();
  const styleHaystackForBridge = `${styleLabelLower} ${(params.stylePrompt ?? "").toLowerCase()}`;
  const bridge =
    /water\s*colou?r|akvarell|aquarelle/.test(styleHaystackForBridge)
      ? "soft watercolor painting, wet-on-wet washes, pigment bleed, visible paper grain, not a photo"
      : /oil|olja|oljemålning|impasto/.test(styleHaystackForBridge)
        ? "oil painting, impasto, brush strokes, canvas texture, not a photo"
        : /sketch|skiss|pencil|graphite/.test(styleHaystackForBridge)
          ? "pencil drawing, graphite strokes, paper grain, cross hatching, not a photo"
          : /line|linje|ink|kontur/.test(styleHaystackForBridge)
            ? "black ink line drawing, minimal fill, white paper, not a photo"
            : /pop[\s-]?art|warhol/.test(styleHaystackForBridge)
              ? "flat comic poster, halftone, hard outlines, saturated color blocks, not a photo"
              : /vintage|retro|aged/.test(styleHaystackForBridge)
                ? "screen printed 1950s poster illustration, flat shapes, limited palette, grain, not a photo"
                : "artistic illustration, painterly surface, not a photo";

  const fluxBase =
    "The subject is the main object in the input photo. Preserve its structure, " +
    "proportions and overall composition so it stays recognizable as the same subject. " +
    "Keep the subject at the EXACT same orientation, facing direction, angle and " +
    "position as in the input photo. NEVER mirror, flip, rotate or re-angle it. " +
    "Do not output a mirror image. If the subject faces left in the input it must " +
    "face left in the output; if it faces right it must face right. " +
    "Completely isolate the subject on a perfectly flat mid-grey (#7f7f7f) studio backdrop. " +
    "ABSOLUTELY NO landscape, NO sky, NO trees, NO foliage, NO bushes, NO grass, NO ground, " +
    "NO shadow, NO surroundings, NO people, NO vehicles, NO text, NO watermark. " +
    "The area outside the subject silhouette must be a single solid flat #7f7f7f, nothing else.";

  const fluxStyleTail = params.stylePrompt?.trim()
    ? [
        bridge,
        "Render the subject in the following art style. Apply it fully to the subject while keeping its structure and identity recognizable. The style is a SURFACE TREATMENT only — it must not change the subject's orientation, facing direction, position or scale:",
        params.stylePrompt.trim(),
      ].filter(Boolean).join("\n")
    : "";

  const fluxMotifLine = params.fluxStylePrompt?.trim() ?? "";
  const fluxPromptText = [
    fluxMotifLine ? `${fluxBase} ${fluxMotifLine}` : fluxBase,
    fluxStyleTail,
  ].filter(Boolean).join("\n\n");

  console.log("[runRemoveBackground] config", {
    designId: params.designId,
    backdropHex,
    fillFrame: params.fillFrame,
    preserveSubjectColors: params.preserveSubjectColors,
    isWatercolorStyle,
    styleLabel: params.styleLabel,
    targetAspectRatio: params.targetAspectRatio,
    promptLength: promptText.length,
    fluxPromptLength: fluxPromptText.length,
    fluxEnabled,
    hasFluxStylePrompt: !!params.fluxStylePrompt?.trim(),
    useFlux,
  });

  if (useFlux) {
    console.log("[runRemoveBackground] fluxPromptText\n" + fluxPromptText);
    return callFluxRemoveBg({
      faceImageUrl: params.faceImageUrl,
      promptText: fluxPromptText,
      designId: params.designId,
    });
  }

  console.log("[runRemoveBackground] promptText\n" + promptText);
  return callNanoBanana({
    promptText,
    imageUrls: [params.faceImageUrl],
  });
}

// ---------- Route 3b: Flux Kontext Pro → 851-labs background-remover ----------
// Gated by env FLUX_REMOVEBG_ENABLED === "true" AND a non-empty
// defaults.fluxStylePrompt on the layer. Mirrors the validated diag6 pipeline.
// Returns the bg-remover's RGBA PNG bytes RAW — no Canvas, no flatten, no
// JPEG — so the caller's existing upload (~line 803-820) preserves alpha.
const FLUX_KONTEXT_MODEL = "black-forest-labs/flux-kontext-pro";
const BG_REMOVER_VERSION =
  "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc";

async function pollReplicate(
  predictionId: string,
  token: string,
  maxAttempts: number,
  shortMs: number,
  longMs: number,
): Promise<
  | { ok: true; output: string }
  | { ok: false; reason: string }
> {
  for (let i = 1; i <= maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, i < 5 ? shortMs : longMs));
    const r = await fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const j = await r.json();
    const status = j?.status;
    if (status === "succeeded") {
      const out = Array.isArray(j.output) ? j.output[0] : j.output;
      if (typeof out === "string" && out.length > 0) {
        return { ok: true, output: out };
      }
      return { ok: false, reason: "Empty output" };
    }
    if (status === "failed" || status === "canceled") {
      return { ok: false, reason: `${status}: ${j?.error ?? "(no error)"}` };
    }
  }
  return { ok: false, reason: "timeout" };
}

async function callFluxRemoveBg(params: {
  faceImageUrl: string;
  promptText: string;
  designId: string;
}): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string; outputUrl: string }
  | { ok: false; response: Response }
> {
  const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
  if (!REPLICATE_API_TOKEN) {
    return {
      ok: false,
      response: fallbackResponse(
        "Tjänsten är tillfälligt otillgänglig. Försök igen senare.",
        "REPLICATE_API_TOKEN not configured (flux path)",
      ),
    };
  }

  console.log(`[flux-removebg] start designId=${params.designId}`);

  // Step 1: Flux Kontext Pro — restyle / isolate against flat backdrop.
  const fluxStart = await fetch(
    `https://api.replicate.com/v1/models/${FLUX_KONTEXT_MODEL}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          input_image: params.faceImageUrl,
          prompt: params.promptText,
          output_format: "png",
          safety_tolerance: 2,
          prompt_upsampling: false,
          aspect_ratio: "match_input_image",
        },
      }),
    },
  );
  const fluxJson = await fluxStart.json();
  if (!fluxStart.ok || !fluxJson?.id) {
    return {
      ok: false,
      response: fallbackResponse(
        "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
        `Flux start failed: ${fluxStart.status} ${JSON.stringify(fluxJson).slice(0, 300)}`,
      ),
    };
  }
  const fluxPoll = await pollReplicate(fluxJson.id, REPLICATE_API_TOKEN, 120, 3000, 6000);
  if (!fluxPoll.ok) {
    return {
      ok: false,
      response: fallbackResponse(
        "Vi kunde inte skapa bilden den här gången. Försök igen.",
        `Flux ${fluxPoll.reason}`,
      ),
    };
  }
  const fluxUrl = fluxPoll.output;
  console.log(`[flux-removebg] flux done designId=${params.designId} url=${fluxUrl}`);

  // Step 2: 851-labs/background-remover — RGBA PNG cutout.
  const bgStart = await fetch(`https://api.replicate.com/v1/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: BG_REMOVER_VERSION,
      input: {
        image: fluxUrl,
        format: "png",
        background_type: "rgba",
      },
    }),
  });
  const bgJson = await bgStart.json();
  if (!bgStart.ok || !bgJson?.id) {
    return {
      ok: false,
      response: fallbackResponse(
        "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
        `BG-remover start failed: ${bgStart.status} ${JSON.stringify(bgJson).slice(0, 300)}`,
      ),
    };
  }
  const bgPoll = await pollReplicate(bgJson.id, REPLICATE_API_TOKEN, 90, 2000, 4000);
  if (!bgPoll.ok) {
    return {
      ok: false,
      response: fallbackResponse(
        "Vi kunde inte skapa bilden den här gången. Försök igen.",
        `BG-remover ${bgPoll.reason}`,
      ),
    };
  }
  const cutoutUrl = bgPoll.output;

  // Fetch the RGBA bytes raw — no decode, no re-encode, alpha preserved.
  const cutoutResp = await fetch(cutoutUrl);
  if (!cutoutResp.ok) {
    return {
      ok: false,
      response: fallbackResponse(
        "Vi kunde inte hämta den genererade bilden. Försök igen.",
        `BG-remover fetch ${cutoutResp.status}`,
      ),
    };
  }
  const ab = await cutoutResp.arrayBuffer();
  const bytes = new Uint8Array(ab);
  const contentType = cutoutResp.headers.get("content-type") ?? "image/png";
  console.log(
    `[flux-removebg] done designId=${params.designId} bytes=${bytes.byteLength} ` +
      `contentType=${contentType} url=${cutoutUrl}`,
  );
  return { ok: true, bytes, contentType, outputUrl: cutoutUrl };
}

// ---------- Route 3d: simpleStyleMode — flux-kontext-pro with a tiny ----------
// Empirically, Kontext preserves geometry and applies style perfectly when
// the prompt is a SHORT instruction (e.g. "make this in oil styling"). Long
// prompts make Kontext interpret the text as "recreate against this" and the
// geometry drifts. So this branch sends ONLY `instruction` as the text input
// — no base prompt, no isolation rules, no negative — then runs the standard
// 851-labs background-remover on the Kontext output.
async function callKontextSimpleStyle(params: {
  faceImageUrl: string;
  instruction: string;
  designId: string;
}): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string; outputUrl: string }
  | { ok: false; response: Response }
> {
  const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
  if (!REPLICATE_API_TOKEN) {
    return {
      ok: false,
      response: fallbackResponse(
        "Tjänsten är tillfälligt otillgänglig. Försök igen senare.",
        "REPLICATE_API_TOKEN not configured (kontext-simple)",
      ),
    };
  }

  console.log(
    `[kontext-simple] start designId=${params.designId} instruction="${params.instruction}"`,
  );

  // Step 1: flux-kontext-pro with ONLY the short instruction.
  const fluxStart = await fetch(
    `https://api.replicate.com/v1/models/${FLUX_KONTEXT_MODEL}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          input_image: params.faceImageUrl,
          prompt: params.instruction,
          output_format: "png",
          safety_tolerance: 2,
          prompt_upsampling: false,
          aspect_ratio: "match_input_image",
        },
      }),
    },
  );
  const fluxJson = await fluxStart.json();
  if (!fluxStart.ok || !fluxJson?.id) {
    return {
      ok: false,
      response: fallbackResponse(
        "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
        `Kontext-simple start failed: ${fluxStart.status} ${JSON.stringify(fluxJson).slice(0, 300)}`,
      ),
    };
  }
  const fluxPoll = await pollReplicate(fluxJson.id, REPLICATE_API_TOKEN, 120, 3000, 6000);
  if (!fluxPoll.ok) {
    return {
      ok: false,
      response: fallbackResponse(
        "Vi kunde inte skapa bilden den här gången. Försök igen.",
        `Kontext-simple ${fluxPoll.reason}`,
      ),
    };
  }
  const styledUrl = fluxPoll.output;
  console.log(`[kontext-simple] flux done designId=${params.designId} url=${styledUrl}`);

  // Step 2: 851-labs/background-remover — RGBA PNG cutout from the styled image.
  const bgStart = await fetch(`https://api.replicate.com/v1/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: BG_REMOVER_VERSION,
      input: {
        image: styledUrl,
        format: "png",
        background_type: "rgba",
      },
    }),
  });
  const bgJson = await bgStart.json();
  if (!bgStart.ok || !bgJson?.id) {
    return {
      ok: false,
      response: fallbackResponse(
        "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
        `Kontext-simple BG-remover start failed: ${bgStart.status} ${JSON.stringify(bgJson).slice(0, 300)}`,
      ),
    };
  }
  const bgPoll = await pollReplicate(bgJson.id, REPLICATE_API_TOKEN, 90, 2000, 4000);
  if (!bgPoll.ok) {
    return {
      ok: false,
      response: fallbackResponse(
        "Vi kunde inte skapa bilden den här gången. Försök igen.",
        `Kontext-simple BG-remover ${bgPoll.reason}`,
      ),
    };
  }
  const cutoutUrl = bgPoll.output;
  const cutoutResp = await fetch(cutoutUrl);
  if (!cutoutResp.ok) {
    return {
      ok: false,
      response: fallbackResponse(
        "Vi kunde inte hämta den genererade bilden. Försök igen.",
        `Kontext-simple BG-remover fetch ${cutoutResp.status}`,
      ),
    };
  }
  const ab = await cutoutResp.arrayBuffer();
  const bytes = new Uint8Array(ab);
  const contentType = cutoutResp.headers.get("content-type") ?? "image/png";
  console.log(
    `[kontext-simple] done designId=${params.designId} bytes=${bytes.byteLength} ` +
      `contentType=${contentType} url=${cutoutUrl}`,
  );
  return { ok: true, bytes, contentType, outputUrl: cutoutUrl };
}





Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Parse query params early — used for the Flux test-stub (Fas 0) and the
  // ?engine= test-override (Fas 1).
  const reqUrl = new URL(req.url);
  const engineParam = reqUrl.searchParams.get("engine");
  const stubParam = reqUrl.searchParams.get("stub");
  const stubUrlParam = reqUrl.searchParams.get("stubUrl");

  try {
    const body = await req.json();
    const referenceImageUrl: string | undefined = body?.referenceImageUrl;
    const faceImageUrl: string | undefined = body?.faceImageUrl;
    const prompt: string = typeof body?.prompt === "string" ? body.prompt : "";
    const subjectKindRaw: string =
      typeof body?.subjectKind === "string" ? body.subjectKind : "human";
    // Accept the new vocabulary AND the old one — the client may be a stale
    // cached bundle still sending cat/dog/other. Map them to "pet".
    const normalizedKind: string =
      subjectKindRaw === "cat" || subjectKindRaw === "dog" || subjectKindRaw === "other"
        ? "pet"
        : subjectKindRaw;
    const subjectKind = (["human", "pet", "removeBackground"].includes(normalizedKind)
      ? normalizedKind
      : "human") as "human" | "pet" | "removeBackground";
    const designId: string =
      typeof body?.designId === "string" ? body.designId : crypto.randomUUID();

    // ── Recipe executor path (Step 2b). Runs ONLY when the request carries a
    //    `recipe`; the legacy subjectKind routing below is untouched. Same
    //    response shape → client + pipelines see no difference. ────────────────
    if (body?.recipe && typeof body.recipe === "object") {
      const RECIPE_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
      if (!RECIPE_TOKEN) {
        return fallbackResponse(
          "Tjänsten är tillfälligt otillgänglig. Försök igen senare.",
          "REPLICATE_API_TOKEN not configured (recipe)",
        );
      }
      const customerImageUrls: string[] = Array.isArray(body.customerImageUrls)
        ? body.customerImageUrls.filter((u: unknown) => typeof u === "string")
        : faceImageUrl ? [faceImageUrl] : [];
      const referenceImageUrls: string[] = Array.isArray(body.referenceImageUrls)
        ? body.referenceImageUrls.filter((u: unknown) => typeof u === "string")
        : referenceImageUrl ? [referenceImageUrl] : [];
      const optionValues: Record<string, string> =
        body.optionValues && typeof body.optionValues === "object" ? body.optionValues : {};

      const recipe = body.recipe as ExecRecipe;
      console.log(
        `[face-swap] recipe run model=${recipe.model} steps=${recipe.steps?.length ?? 0} ` +
          `customer=${customerImageUrls.length} ref=${referenceImageUrls.length} designId=${designId}`,
      );
      const rec = await runRecipe(
        recipe,
        { customerImageUrls, referenceImageUrls, optionValues },
        RECIPE_TOKEN,
      );
      if (!rec.ok) {
        return fallbackResponse(
          "Vi kunde inte skapa bilden den här gången. Försök igen.",
          `recipe ${recipe.model}: ${rec.error}`,
        );
      }
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const ext = rec.contentType.includes("png") ? "png" : "jpg";
      const path = `${designId}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("print-files")
        .upload(path, rec.bytes, { contentType: rec.contentType, upsert: true });
      if (upErr) {
        return fallbackResponse(
          "Vi kunde inte spara den genererade bilden. Försök igen.",
          `recipe upload failed: ${upErr.message}`,
        );
      }
      const { data: pub } = supabase.storage.from("print-files").getPublicUrl(path);
      const printFileUrl = pub.publicUrl;
      return jsonResponse({
        output: printFileUrl,
        previewUrl: printFileUrl,
        printFileUrl,
        replicateOutputUrl: rec.outputUrl,
        modelUsed: recipe.model,
        route: "recipe",
      });
    }

    // -------- Fas 0 stub: skip all models, return a known transparent PNG --
    // Trigger: ?engine=flux&stub=1 with subjectKind=removeBackground.
    // Source: ?stubUrl=<https://...> OR env FACE_SWAP_DIAG_TRANSPARENT_PNG_URL.
    // Purpose: verify that the editor + print pipeline composites the per-layer
    // backdropColor under a truly-transparent AI result. Default flow untouched.
    if (
      engineParam === "flux" &&
      stubParam === "1" &&
      subjectKind === "removeBackground"
    ) {
      const stubUrl =
        stubUrlParam ?? Deno.env.get("FACE_SWAP_DIAG_TRANSPARENT_PNG_URL") ?? "";
      if (!stubUrl) {
        return fallbackResponse(
          "Stub-URL saknas.",
          "stub mode: no ?stubUrl= and FACE_SWAP_DIAG_TRANSPARENT_PNG_URL not set",
        );
      }
      console.log(`[face-swap] stub mode: designId=${designId} stubUrl=${stubUrl}`);
      try {
        const r = await fetch(stubUrl);
        if (!r.ok) {
          return fallbackResponse(
            "Kunde inte hämta stub-bilden.",
            `stub fetch ${r.status}`,
          );
        }
        const ab = await r.arrayBuffer();
        const bytes = new Uint8Array(ab);
        const contentType = r.headers.get("content-type") ?? "image/png";
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const ext = contentType.includes("png") ? "png" : "jpg";
        const path = `${designId}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("print-files")
          .upload(path, bytes, { contentType, upsert: true });
        if (upErr) {
          return fallbackResponse(
            "Kunde inte spara stub-bilden.",
            `stub upload failed: ${upErr.message}`,
          );
        }
        const { data: pub } = supabase.storage.from("print-files").getPublicUrl(path);
        const printFileUrl = pub.publicUrl;
        console.log(`[face-swap] stub done → printFileUrl=${printFileUrl}`);
        return jsonResponse({
          output: printFileUrl,
          previewUrl: printFileUrl,
          printFileUrl,
          replicateOutputUrl: stubUrl,
          usedFaceImageUrl: faceImageUrl ?? null,
          modelUsed: "stub-passthrough",
          route: "remove-bg-stub",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return fallbackResponse("Stub-fel.", `stub mode error: ${msg}`);
      }
    }


    const removeBackgroundStylePrompt: string | null =
      typeof body?.removeBackgroundStylePrompt === "string"
        ? body.removeBackgroundStylePrompt
        : null;
    const removeBackgroundStyleLabel: string | null =
      typeof body?.removeBackgroundStyleLabel === "string"
        ? body.removeBackgroundStyleLabel
        : null;
    const removeBackgroundStyleId: string | null =
      typeof body?.removeBackgroundStyleId === "string"
        ? body.removeBackgroundStyleId
        : null;

    // Validation: faceImageUrl is always required. referenceImageUrl is
    // required only for human + pet routes.
    if (!faceImageUrl) {
      return jsonResponse({ error: "faceImageUrl required" }, 400);
    }
    if (subjectKind !== "removeBackground" && !referenceImageUrl) {
      return jsonResponse({ error: "referenceImageUrl required for this subjectKind" }, 400);
    }

    const fluxEnabledHandler = Deno.env.get("FLUX_REMOVEBG_ENABLED") === "true";
    const hasFluxStyle =
      typeof body?.fluxStylePrompt === "string" && body.fluxStylePrompt.trim().length > 0;
    const simpleStyleMode: boolean =
      subjectKind === "removeBackground" && body?.simpleStyleMode === true;
    const styleInstruction: string | null =
      typeof body?.styleInstruction === "string" && body.styleInstruction.trim().length > 0
        ? body.styleInstruction.trim()
        : null;
    const willUseSimple =
      simpleStyleMode &&
      (!!styleInstruction ||
        (typeof body?.removeBackgroundStylePrompt === "string" &&
          body.removeBackgroundStylePrompt.trim().length > 0));
    const willUseFlux =
      !willUseSimple &&
      subjectKind === "removeBackground" &&
      fluxEnabledHandler &&
      hasFluxStyle;
    const route =
      subjectKind === "human" ? "human-cdingram"
      : subjectKind === "pet" ? "pet-nano-banana"
      : willUseSimple ? "remove-bg-simple"
      : willUseFlux ? "remove-bg-flux"
      : "remove-bg-nano-banana";
    const modelUsed =
      subjectKind === "human" ? FACE_SWAP_MODEL_NAME
      : willUseSimple ? "black-forest-labs/flux-kontext-pro+851-labs/background-remover"
      : willUseFlux ? "black-forest-labs/flux-kontext-pro+851-labs/background-remover"
      : ANIMAL_MODEL;

    console.log(
      `[face-swap] start route=${route} model=${modelUsed} ` +
        `subjectKind=${subjectKind} designId=${designId} ` +
        `referenceImage=${referenceImageUrl ?? "(none)"} faceImage=${faceImageUrl} ` +
        `removeBgStyleId=${removeBackgroundStyleId ?? "(none)"} ` +
        `simpleStyleMode=${simpleStyleMode} styleInstruction="${styleInstruction ?? ""}" ` +
        `adminPrompt="${prompt.slice(0, 120)}"`,
    );

    const targetAspectRatio: number | null =
      typeof body?.targetAspectRatio === "number" &&
      isFinite(body.targetAspectRatio) &&
      body.targetAspectRatio > 0
        ? body.targetAspectRatio
        : null;

    const backdropColor: string | null =
      typeof body?.backdropColor === "string" &&
      /^#([0-9a-fA-F]{6})$/.test(body.backdropColor)
        ? body.backdropColor.toUpperCase()
        : null;
    const fillFrame: boolean =
      typeof body?.fillFrame === "boolean" ? body.fillFrame : true;
    const preserveSubjectColors: boolean =
      typeof body?.preserveSubjectColors === "boolean"
        ? body.preserveSubjectColors
        : true;
    const fluxStylePrompt: string | null =
      typeof body?.fluxStylePrompt === "string" && body.fluxStylePrompt.trim().length > 0
        ? body.fluxStylePrompt
        : null;



    const result =
      subjectKind === "human"
        ? await runReplicateFaceSwap({
            referenceImageUrl: referenceImageUrl!,
            faceImageUrl,
            designId,
          })
        : subjectKind === "pet"
        ? await runPetSwap({
            referenceImageUrl: referenceImageUrl!,
            faceImageUrl,
            adminPrompt: prompt,
          })
        : await runRemoveBackground({
            faceImageUrl,
            adminPrompt: prompt,
            stylePrompt: removeBackgroundStylePrompt,
            styleLabel: removeBackgroundStyleLabel,
            targetAspectRatio,
            backdropColor,
            fillFrame,
            preserveSubjectColors,
            designId,
            fluxStylePrompt,
            subjectKind: "removeBackground",
            simpleStyleMode,
            styleInstruction,
          });


    if (!result.ok) return result.response;

    // Sanity-check dimensions to catch collages / weirdly-shaped outputs.
    // When a targetAspectRatio was provided, allow any ratio reasonably close
    // to the target (the layer might legitimately be very tall or very wide).
    const dims = readImageSize(result.bytes);
    if (dims) {
      const ratio = dims.w / Math.max(1, dims.h);
      console.log(
        `[face-swap] outputDimensions=${dims.w}x${dims.h} aspectRatio=${ratio.toFixed(2)} ` +
          `targetAspectRatio=${targetAspectRatio?.toFixed(2) ?? "(none)"}`,
      );
      // Default safe band; widen to match the target when one is provided.
      let minRatio = 0.45;
      let maxRatio = 2.2;
      if (targetAspectRatio && targetAspectRatio > 0) {
        minRatio = Math.min(minRatio, targetAspectRatio * 0.5);
        maxRatio = Math.max(maxRatio, targetAspectRatio * 2.0);
      }
      if (ratio > maxRatio || ratio < minRatio) {
        return fallbackResponse(
          "AI-modellen returnerade en ogiltig bild. Prova att skapa igen, eller använd en tydligare bild.",
          `Suspicious output dimensions ${dims.w}x${dims.h} — likely a collage`,
        );
      }
    }

    // Upload to print-files so the customer gets a stable public URL.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const ext = result.contentType.includes("png") ? "png" : "jpg";
    const path = `${designId}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("print-files")
      .upload(path, result.bytes, { contentType: result.contentType, upsert: true });
    if (upErr) {
      return fallbackResponse(
        "Vi kunde inte spara den genererade bilden. Försök igen.",
        `Print upload failed: ${upErr.message}`,
      );
    }

    const { data: pub } = supabase.storage.from("print-files").getPublicUrl(path);
    const printFileUrl = pub.publicUrl;
    console.log(
      `[face-swap] done route=${route} → printFileUrl=${printFileUrl} ` +
        `aiOutputUrl=${result.outputUrl}`,
    );

    return jsonResponse({
      output: printFileUrl,
      previewUrl: printFileUrl,
      printFileUrl,
      replicateOutputUrl: result.outputUrl,
      usedReferenceImageUrl: referenceImageUrl,
      usedFaceImageUrl: faceImageUrl,
      modelUsed,
      route,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[face-swap] error:", msg);
    return fallbackResponse(
      "Något gick fel. Försök igen om en stund.",
      msg,
    );
  }
});
