// Edge function: MULTI face-swap (OPTIONAL mode for aiPhoto layers).
//
// Strictly additive — NEVER called by single-face flows. The legacy
// `replicate-face-swap` function and all of its behavior are untouched.
//
// Inputs (JSON body):
//   layerId            — aiPhoto layer id (used for caching + filename)
//   referenceImageUrl  — admin's reference artwork (REQUIRED)
//   prompt             — admin-edited prompt; may contain `{{SLOTS}}`
//   slots              — ordered: [{ id, position }, …]
//   portraits          — { [slotId]: publicPortraitUrl }
//   designId           — used for the output filename
//
// Calls Lovable AI Gateway with Nano Banana 2 (Gemini 3.1 flash image),
// passing image 1 = reference, image 2..N+1 = portraits in slot order.
//
// Always returns HTTP 200. On recoverable errors the body is
// { error, fallback: true, userMessage } so the client can show a friendly
// toast instead of crashing on a non-2xx.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NANO_BANANA_URL =
  "https://api.replicate.com/v1/models/google/nano-banana/predictions";
const MODEL = "google/nano-banana";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fallbackResponse(userMessage: string, internal: string) {
  console.error(`[multi-face-swap] fallback: ${internal}`);
  return jsonResponse({ error: internal, fallback: true, userMessage });
}

function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.startsWith("data:") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function buildSlotMappingText(slots: Array<{ id: string; position: string }>): string {
  return slots
    .map((s, i) => `- The person at the ${s.position} position becomes the face in image ${i + 2}`)
    .join("\n");
}

async function callNanoBananaOnce(params: {
  promptText: string;
  imageUrls: string[];
  apiKey: string;
}): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string; outputUrl: string }
  | { ok: false; retriable: boolean; status: number; reason: string; userMessage: string }
> {
  // Replicate-hosted Nano Banana (google/nano-banana): text prompt + an array of
  // reference image URLs → one generated image URL.
  const start = await fetch(NANO_BANANA_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
      Prefer: "wait=55",
    },
    body: JSON.stringify({
      input: {
        prompt: params.promptText,
        image_input: params.imageUrls,
        output_format: "png",
      },
    }),
  });

  let prediction = await start.json();
  if (!start.ok) {
    const status = start.status;
    console.error("[multi-face-swap] Replicate nano-banana error", status, JSON.stringify(prediction).slice(0, 300));
    if (status === 429) {
      return {
        ok: false, retriable: true, status: 429,
        reason: "Replicate rate-limited (429)",
        userMessage: "AI-tjänsten är överbelastad just nu. Vänta 10–15 sekunder och försök igen.",
      };
    }
    if (status === 402) {
      return {
        ok: false, retriable: false, status: 402,
        reason: "Replicate credits exhausted (402)",
        userMessage: "AI-krediten är slut. Kontakta supporten så löser vi det.",
      };
    }
    return {
      ok: false, retriable: status >= 500, status,
      reason: `Replicate error ${status}: ${JSON.stringify(prediction).slice(0, 200)}`,
      userMessage: "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
    };
  }

  const deadline = Date.now() + 60_000;
  while (
    prediction.status !== "succeeded" &&
    prediction.status !== "failed" &&
    prediction.status !== "canceled" &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${params.apiKey}` },
    });
    prediction = await poll.json();
  }

  if (prediction.status !== "succeeded") {
    return {
      ok: false, retriable: true, status: 200,
      reason: `Replicate ${prediction.status}: ${prediction.error ?? "timeout"}`,
      userMessage: "AI-modellen returnerade ingen bild den här gången. Försök igen.",
    };
  }

  const imageUrl: string | undefined = Array.isArray(prediction.output)
    ? prediction.output[0]
    : prediction.output;

  if (!imageUrl || typeof imageUrl !== "string") {
    console.error("[multi-face-swap] Replicate produced no image", JSON.stringify(prediction).slice(0, 400));
    return {
      ok: false, retriable: true, status: 200,
      reason: "Replicate response missing image",
      userMessage: "AI-modellen returnerade ingen bild den här gången. Försök igen.",
    };
  }

  const r = await fetch(imageUrl);
  if (!r.ok) {
    return {
      ok: false, retriable: r.status >= 500, status: r.status,
      reason: `AI image fetch failed ${r.status}`,
      userMessage: "Vi kunde inte hämta den genererade bilden. Försök igen.",
    };
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  const contentType = r.headers.get("content-type") ?? "image/png";

  return { ok: true, bytes, contentType, outputUrl: imageUrl };
}

async function callNanoBanana(params: { promptText: string; imageUrls: string[] }) {
  const apiKey = Deno.env.get("REPLICATE_API_TOKEN");
  if (!apiKey) {
    return {
      ok: false as const,
      response: fallbackResponse(
        "Tjänsten är tillfälligt otillgänglig. Försök igen senare.",
        "REPLICATE_API_TOKEN not configured",
      ),
    };
  }
  const BACKOFF_MS = [4000, 8000];
  const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
  let lastFail: { reason: string; userMessage: string; status: number } | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await callNanoBananaOnce({ ...params, apiKey });
    if (r.ok) {
      if (attempt > 1) console.log(`[multi-face-swap] succeeded on retry ${attempt}/${MAX_ATTEMPTS}`);
      return { ok: true as const, ...r };
    }
    lastFail = { reason: r.reason, userMessage: r.userMessage, status: r.status };
    if (!r.retriable || attempt === MAX_ATTEMPTS) break;
    const wait = BACKOFF_MS[attempt - 1];
    console.log(`[multi-face-swap] retriable failure (${r.reason}) — backing off ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
  }
  return {
    ok: false as const,
    response: fallbackResponse(
      lastFail?.userMessage ?? "Vi kunde inte skapa bilden just nu. Försök igen om en stund.",
      `${lastFail?.reason ?? "unknown"} (after ${MAX_ATTEMPTS} attempts)`,
    ),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const layerId: string | undefined = body?.layerId;
    const referenceImageUrl: string | undefined = body?.referenceImageUrl;
    const adminPrompt: string = typeof body?.prompt === "string" ? body.prompt : "";
    const slots = Array.isArray(body?.slots) ? body.slots : [];
    const portraits = (body?.portraits ?? {}) as Record<string, string>;
    const designId: string =
      typeof body?.designId === "string" ? body.designId : crypto.randomUUID();

    if (!layerId) return jsonResponse({ error: "layerId required" }, 400);
    if (!referenceImageUrl) return jsonResponse({ error: "referenceImageUrl required" }, 400);
    if (!Array.isArray(slots) || slots.length < 2 || slots.length > 4) {
      return jsonResponse({ error: "slots must be an array of 2-4 entries" }, 400);
    }

    const normalisedSlots: Array<{ id: string; position: string }> = [];
    for (const s of slots) {
      if (!s || typeof s.id !== "string" || typeof s.position !== "string") {
        return jsonResponse({ error: "each slot must have {id, position}" }, 400);
      }
      normalisedSlots.push({ id: s.id, position: s.position });
    }
    const portraitUrls: string[] = [];
    for (const s of normalisedSlots) {
      const url = portraits[s.id];
      if (typeof url !== "string" || !url) {
        return fallbackResponse(
          "Ladda upp ett porträtt per ansikte och försök igen.",
          `missing portrait for slot ${s.id}`,
        );
      }
      portraitUrls.push(url);
    }

    const slotMappingText = buildSlotMappingText(normalisedSlots);
    const promptText = (adminPrompt && adminPrompt.trim().length > 0
      ? adminPrompt
      : `You are given several images. Image 1 is the reference artwork to preserve exactly. Re-render image 1 with the following face replacements: {{SLOTS}}. Keep everything else unchanged. Return one single edited image with the same aspect ratio as image 1.`
    ).replace(/\{\{SLOTS\}\}/g, slotMappingText);

    console.log(
      `[multi-face-swap] start layerId=${layerId} designId=${designId} ` +
      `slots=${normalisedSlots.length} referenceImage=${referenceImageUrl} ` +
      `portraits=${portraitUrls.join(",")}`,
    );

    const result = await callNanoBanana({
      promptText,
      imageUrls: [referenceImageUrl, ...portraitUrls],
    });
    if (!result.ok) return result.response;

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
    console.log(`[multi-face-swap] done → printFileUrl=${printFileUrl}`);

    return jsonResponse({
      printFileUrl,
      previewUrl: printFileUrl,
      output: printFileUrl,
      modelUsed: MODEL,
      usedReferenceImageUrl: referenceImageUrl,
      usedPortraitUrls: portraitUrls,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[multi-face-swap] error:", msg);
    return fallbackResponse("Något gick fel. Försök igen om en stund.", msg);
  }
});
