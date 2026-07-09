// Shared Replicate prediction runner used by the AI model adapters.
//
// One place that does: POST a prediction → poll `urls.get` until it settles →
// fetch the output image bytes. Timings are parameters so each model keeps its
// exact current behaviour (e.g. cdingram polls up to 90s, nano-banana 60s).
// Errors are returned NEUTRAL (with a `stage`); each adapter maps them to its
// own friendly, user-facing message so behaviour is unchanged.

export type ReplicateResult =
  | { ok: true; outputUrl: string; bytes: Uint8Array; contentType: string }
  | { ok: false; stage: "start" | "poll" | "output" | "fetch"; status: number; error: string };

export async function replicatePredict(opts: {
  apiKey: string;
  /** Full predictions endpoint — either the model endpoint
   *  (`.../v1/models/<owner>/<model>/predictions`) or `.../v1/predictions`
   *  (then pass `version` inside `body`). */
  endpoint: string;
  body: Record<string, unknown>;
  /** `Prefer: wait=<n>` — Replicate holds the request open up to n seconds. */
  waitSeconds: number;
  /** Total poll budget after the initial wait. */
  deadlineMs: number;
  pollMs?: number;
}): Promise<ReplicateResult> {
  const start = await fetch(opts.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      Prefer: `wait=${opts.waitSeconds}`,
    },
    body: JSON.stringify(opts.body),
  });

  let prediction = await start.json();
  if (!start.ok) {
    return {
      ok: false,
      stage: "start",
      status: start.status,
      error: JSON.stringify(prediction).slice(0, 300),
    };
  }

  const deadline = Date.now() + opts.deadlineMs;
  const pollMs = opts.pollMs ?? 1500;
  while (
    prediction.status !== "succeeded" &&
    prediction.status !== "failed" &&
    prediction.status !== "canceled" &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, pollMs));
    const poll = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    });
    prediction = await poll.json();
  }

  if (prediction.status !== "succeeded") {
    return {
      ok: false,
      stage: "poll",
      status: 200,
      error: `${prediction.status}: ${prediction.error ?? "timeout"}`,
    };
  }

  const outputUrl = Array.isArray(prediction.output)
    ? prediction.output[0]
    : prediction.output;
  if (!outputUrl || typeof outputUrl !== "string") {
    return { ok: false, stage: "output", status: 200, error: JSON.stringify(prediction).slice(0, 300) };
  }

  const r = await fetch(outputUrl);
  if (!r.ok) {
    return { ok: false, stage: "fetch", status: r.status, error: `image fetch ${r.status}` };
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  const contentType = r.headers.get("content-type") ?? "image/png";
  return { ok: true, outputUrl, bytes, contentType };
}
