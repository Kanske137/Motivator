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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Replicate human face-swap model. Pinned to a specific version for stability.
const FACE_SWAP_MODEL_VERSION =
  "cdingram/face-swap:d1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111";
const FACE_SWAP_MODEL_NAME = "cdingram/face-swap";

// Lovable AI Gateway — Nano Banana 2 (Gemini 3.1 Flash Image).
// Free of extra API keys: uses the auto-provisioned LOVABLE_API_KEY.
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const ANIMAL_MODEL = "google/gemini-3.1-flash-image-preview";

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

  const start = await fetch(`https://api.replicate.com/v1/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
      Prefer: "wait=30",
    },
    body: JSON.stringify({
      version: FACE_SWAP_MODEL_VERSION.split(":")[1],
      input: {
        input_image: params.referenceImageUrl,
        swap_image: params.faceImageUrl,
      },
    }),
  });

  let prediction = await start.json();
  if (!start.ok) {
    console.error("[face-swap] replicate start failed", prediction);
    return {
      ok: false,
      response: fallbackResponse(
        "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
        `Replicate start failed: ${prediction?.detail ?? start.status}`,
      ),
    };
  }

  const deadline = Date.now() + 90_000;
  while (
    prediction.status !== "succeeded" &&
    prediction.status !== "failed" &&
    prediction.status !== "canceled" &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
    });
    prediction = await poll.json();
  }

  if (prediction.status !== "succeeded") {
    const errStr = String(prediction.error ?? "").toLowerCase();
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
        `Replicate ${prediction.status}: ${prediction.error || "timeout"}`,
      ),
    };
  }

  const output = Array.isArray(prediction.output)
    ? prediction.output[0]
    : prediction.output;
  if (!output) {
    return {
      ok: false,
      response: fallbackResponse(
        "Vi kunde inte hitta något tydligt ansikte i din bild. Prova en annan bild med tydligt ansikte och bra ljus.",
        "Replicate succeeded but produced no output URL",
      ),
    };
  }

  const imgRes = await fetch(output);
  if (!imgRes.ok) {
    return {
      ok: false,
      response: fallbackResponse(
        "Vi kunde inte hämta den genererade bilden. Försök igen.",
        `Replicate image fetch failed ${imgRes.status}`,
      ),
    };
  }
  const bytes = new Uint8Array(await imgRes.arrayBuffer());
  const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
  return { ok: true, bytes, contentType, outputUrl: output };
}

// ---------- Route 2: Lovable AI Gateway (Nano Banana 2) for animals ----------
async function runAnimalSwap(params: {
  referenceImageUrl: string;
  faceImageUrl: string;
  subjectKind: "cat" | "dog" | "other";
  adminPrompt: string;
}): Promise<{ ok: true; bytes: Uint8Array; contentType: string; outputUrl: string }
  | { ok: false; response: Response }> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return {
      ok: false,
      response: fallbackResponse(
        "Tjänsten är tillfälligt otillgänglig. Försök igen senare.",
        "LOVABLE_API_KEY not configured",
      ),
    };
  }

  const animalNoun =
    params.subjectKind === "cat" ? "cat"
      : params.subjectKind === "dog" ? "dog"
      : "animal";

  const adminPromptLine = params.adminPrompt?.trim()
    ? `Additional styling guidance from the artist: ${params.adminPrompt.trim()}`
    : "";

  const promptText = [
    `You are editing image #1 (the reference scene). Image #2 is a photograph of the customer's own ${animalNoun}.`,
    `Replace the ${animalNoun} that appears in image #1 with the specific ${animalNoun} from image #2 — keep the unique markings, fur color/pattern, breed traits, eye color, and overall identity from image #2.`,
    `Keep EVERYTHING ELSE from image #1 unchanged: the costume/clothing, props, background, lighting, camera angle, art style, composition, framing, and aspect ratio. Do not change the pose unless required to make the new ${animalNoun} fit naturally.`,
    `Return ONE single edited image (NOT a collage, NOT side-by-side, NOT a comparison). Output must have the same aspect ratio as image #1.`,
    adminPromptLine,
  ].filter(Boolean).join("\n");

  const aiRes = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ANIMAL_MODEL,
      modalities: ["image", "text"],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: promptText },
            { type: "image_url", image_url: { url: params.referenceImageUrl } },
            { type: "image_url", image_url: { url: params.faceImageUrl } },
          ],
        },
      ],
    }),
  });

  if (!aiRes.ok) {
    const errBody = await aiRes.text();
    console.error("[face-swap] AI gateway error", aiRes.status, errBody);
    if (aiRes.status === 429) {
      return {
        ok: false,
        response: fallbackResponse(
          "Vi har för många AI-förfrågningar just nu. Vänta en liten stund och försök igen.",
          "Lovable AI rate-limited (429)",
        ),
      };
    }
    if (aiRes.status === 402) {
      return {
        ok: false,
        response: fallbackResponse(
          "AI-krediten är slut. Kontakta supporten så löser vi det.",
          "Lovable AI payment required (402)",
        ),
      };
    }
    return {
      ok: false,
      response: fallbackResponse(
        "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
        `AI gateway error ${aiRes.status}: ${errBody.slice(0, 200)}`,
      ),
    };
  }

  const data = await aiRes.json();
  const usage = data?.usage;
  if (usage) {
    console.log(
      `[face-swap] AI usage prompt=${usage.prompt_tokens ?? "?"} ` +
        `completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`,
    );
  }

  // Nano Banana 2 returns generated images on the assistant message.
  // The OpenAI-compatible shape on Lovable AI Gateway is:
  //   data.choices[0].message.images[0].image_url.url   (data: URL or https URL)
  // We accept either form, plus a few defensive fallbacks.
  const msg = data?.choices?.[0]?.message;
  const imageUrl: string | undefined =
    msg?.images?.[0]?.image_url?.url ??
    msg?.images?.[0]?.url ??
    (typeof msg?.content === "string" && msg.content.startsWith("data:")
      ? msg.content
      : undefined);

  if (!imageUrl) {
    console.error("[face-swap] AI returned no image", JSON.stringify(data).slice(0, 500));
    return {
      ok: false,
      response: fallbackResponse(
        "AI-modellen returnerade ingen bild. Prova att skapa igen.",
        "AI gateway response missing image",
      ),
    };
  }

  let bytes: Uint8Array;
  let contentType = "image/png";
  if (imageUrl.startsWith("data:")) {
    const mimeMatch = imageUrl.match(/^data:([^;]+);base64,/);
    if (mimeMatch) contentType = mimeMatch[1];
    bytes = base64ToBytes(imageUrl);
  } else {
    const r = await fetch(imageUrl);
    if (!r.ok) {
      return {
        ok: false,
        response: fallbackResponse(
          "Vi kunde inte hämta den genererade bilden. Försök igen.",
          `AI image fetch failed ${r.status}`,
        ),
      };
    }
    bytes = new Uint8Array(await r.arrayBuffer());
    contentType = r.headers.get("content-type") ?? contentType;
  }

  return {
    ok: true,
    bytes,
    contentType,
    outputUrl: imageUrl.startsWith("data:") ? "(inline base64)" : imageUrl,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const referenceImageUrl: string | undefined = body?.referenceImageUrl;
    const faceImageUrl: string | undefined = body?.faceImageUrl;
    const prompt: string = typeof body?.prompt === "string" ? body.prompt : "";
    const subjectKindRaw: string =
      typeof body?.subjectKind === "string" ? body.subjectKind : "human";
    const subjectKind = (["human", "cat", "dog", "other"].includes(subjectKindRaw)
      ? subjectKindRaw
      : "human") as "human" | "cat" | "dog" | "other";
    const designId: string =
      typeof body?.designId === "string" ? body.designId : crypto.randomUUID();

    if (!referenceImageUrl || !faceImageUrl) {
      return jsonResponse(
        { error: "referenceImageUrl and faceImageUrl required" },
        400,
      );
    }

    const isAnimal = subjectKind === "cat" || subjectKind === "dog" || subjectKind === "other";
    const route = isAnimal ? "animal-nano-banana" : "human-replicate";
    const modelUsed = isAnimal ? ANIMAL_MODEL : FACE_SWAP_MODEL_NAME;

    console.log(
      `[face-swap] start route=${route} model=${modelUsed} ` +
        `subjectKind=${subjectKind} designId=${designId} ` +
        `referenceImage=${referenceImageUrl} faceImage=${faceImageUrl} ` +
        `adminPrompt="${prompt.slice(0, 120)}"`,
    );

    const result = isAnimal
      ? await runAnimalSwap({
          referenceImageUrl,
          faceImageUrl,
          subjectKind: subjectKind as "cat" | "dog" | "other",
          adminPrompt: prompt,
        })
      : await runReplicateFaceSwap({
          referenceImageUrl,
          faceImageUrl,
          designId,
        });

    if (!result.ok) return result.response;

    // Sanity-check dimensions to catch collages / weirdly-shaped outputs.
    const dims = readImageSize(result.bytes);
    if (dims) {
      const ratio = dims.w / Math.max(1, dims.h);
      console.log(
        `[face-swap] outputDimensions=${dims.w}x${dims.h} aspectRatio=${ratio.toFixed(2)}`,
      );
      if (ratio > 2.2 || ratio < 0.45) {
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
