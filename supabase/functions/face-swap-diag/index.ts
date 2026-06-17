// TEMPORARY diagnostic function for the 400 upstream_error investigation in
// `replicate-face-swap`. Calls Lovable AI Gateway (google/gemini-3.1-flash-image-preview)
// directly, RAW, with NO truncation of error bodies. Loops `repeat` times so we
// can measure non-determinism. To be deleted once the investigation is closed.
//
// POST body:
//   { promptText: string, imageUrl: string, repeat?: number (1..15), label?: string }
//
// Returns the per-attempt raw record (status, full errBody, finishReason,
// promptFeedback, safetyRatings, latency_ms) plus a tally.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.1-flash-image-preview";

function readImageSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (
    bytes.length > 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
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

async function probeImage(url: string) {
  try {
    const r = await fetch(url);
    if (!r.ok) return { ok: false, status: r.status };
    const bytes = new Uint8Array(await r.arrayBuffer());
    const size = readImageSize(bytes);
    return {
      ok: true,
      bytes: bytes.length,
      width: size?.w ?? null,
      height: size?.h ?? null,
      contentType: r.headers.get("content-type"),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function callOnce(promptText: string, imageUrl: string, apiKey: string) {
  const startedAt = Date.now();
  const body = {
    model: MODEL,
    modalities: ["image", "text"],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: promptText },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  };
  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const latency_ms = Date.now() - startedAt;
  const rawText = await res.text();

  // Try to parse as JSON to extract finishReason / safetyRatings if present.
  let parsed: unknown = null;
  let finishReason: unknown = null;
  let promptFeedback: unknown = null;
  let safetyRatings: unknown = null;
  let hasImage = false;
  try {
    parsed = JSON.parse(rawText);
    const p = parsed as Record<string, unknown>;
    const choices = p?.choices as Array<Record<string, unknown>> | undefined;
    const first = choices?.[0];
    finishReason = first?.finish_reason ?? null;
    const msg = first?.message as Record<string, unknown> | undefined;
    const images = msg?.images as unknown[] | undefined;
    hasImage = !!(images && images.length > 0);
    promptFeedback = (p as { prompt_feedback?: unknown })?.prompt_feedback ??
      (p as { promptFeedback?: unknown })?.promptFeedback ?? null;
    safetyRatings = (first as { safety_ratings?: unknown } | undefined)?.safety_ratings ??
      (first as { safetyRatings?: unknown } | undefined)?.safetyRatings ?? null;
  } catch {
    // not JSON — keep rawText as-is
  }

  return {
    httpStatus: res.status,
    ok: res.ok,
    latency_ms,
    rawBody: rawText, // FULL, untruncated
    finishReason,
    promptFeedback,
    safetyRatings,
    hasImage,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    const promptText: string = typeof body?.promptText === "string" ? body.promptText : "";
    const imageUrl: string = typeof body?.imageUrl === "string" ? body.imageUrl : "";
    const repeat = Math.max(1, Math.min(15, Number(body?.repeat) || 1));
    const label: string = typeof body?.label === "string" ? body.label : "diag";
    if (!promptText || !imageUrl) {
      return new Response(JSON.stringify({ error: "promptText + imageUrl required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const imageProbe = await probeImage(imageUrl);
    console.log(`[diag:${label}] starting repeat=${repeat} promptLen=${promptText.length} image=`, imageProbe);

    const attempts: Array<Record<string, unknown>> = [];
    let ok = 0;
    let fail = 0;
    for (let i = 1; i <= repeat; i++) {
      const r = await callOnce(promptText, imageUrl, apiKey);
      const slim = {
        attempt: i,
        httpStatus: r.httpStatus,
        latency_ms: r.latency_ms,
        hasImage: r.hasImage,
        finishReason: r.finishReason,
        promptFeedback: r.promptFeedback,
        safetyRatings: r.safetyRatings,
        rawBody: r.ok ? "(success, body omitted)" : r.rawBody, // full on failure
      };
      console.log(`[diag:${label}] attempt ${i}/${repeat}`, JSON.stringify(slim).slice(0, 2000));
      attempts.push(slim);
      if (r.ok && r.hasImage) ok++; else fail++;
    }

    return new Response(
      JSON.stringify({
        label,
        model: MODEL,
        promptLength: promptText.length,
        image: imageProbe,
        summary: { ok, fail, total: repeat },
        attempts,
      }, null, 2),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
