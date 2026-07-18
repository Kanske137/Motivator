// Client access to the composed wall-art PRESETS (poster, …). The preset is the
// single source of truth for a composed product's merchant-facing options; the
// admin reads its axes from here so it shows the SAME sizes/frames/paper the
// sync resolves (both import the shared pure module). Provider-agnostic.
import { POSTER_PRESET } from "../../../supabase/functions/_shared/pod/presets";
export { POSTER_PRESET };

/** The value keys of a preset axis, e.g. presetAxisKeys(POSTER_PRESET, "size"). */
export function presetAxisKeys(
  preset: typeof POSTER_PRESET,
  axisKey: string,
): string[] {
  return (preset.axes.find((a) => a.key === axisKey)?.values ?? []).map((v) => v.key);
}
