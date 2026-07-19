// Pricing math — provider-agnostic. Retail is derived from the POD wholesale
// cost and the merchant's target margin, then rounded to a store-friendly value.
//
// Margin is the classic gross margin: margin = (retail − cost) / retail, so
//   retail = cost / (1 − margin).
// A 60% target on a 40 kr cost → 40 / 0.4 = 100 → rounded to 99.
//
// Kept dependency-free so the admin UI (via a thin edge endpoint) and sync
// compute identical numbers.

export type Rounding = "up9" | "whole" | "none";

export interface PricingConfig {
  marginPct: number;   // target gross margin, 0..<100
  rounding: Rounding;
}

export const DEFAULT_PRICING: PricingConfig = { marginPct: 60, rounding: "up9" };

/** Round a raw price to the configured store convention (always ≥ the input,
 *  so rounding never pushes retail below cost × markup). */
export function roundRetail(value: number, rounding: Rounding): number {
  if (!(value > 0)) return 0;
  switch (rounding) {
    // Nearest higher integer ending in 9 (…9, …19, …99): 187.4 → 189, 190 → 199.
    case "up9": return Math.ceil((value + 1) / 10) * 10 - 1;
    case "whole": return Math.ceil(value);
    default: return Math.round(value * 100) / 100;
  }
}

/** retail = round( cost / (1 − margin) ). Returns 0 when cost is unusable. */
export function retailFromCost(cost: number, cfg: PricingConfig): number {
  if (!(cost > 0)) return 0;
  const m = Math.min(Math.max(cfg.marginPct, 0), 95) / 100;
  return roundRetail(cost / (1 - m), cfg.rounding);
}

/** Realised margin for a (retail, cost) pair, as a percentage. */
export function marginOf(retail: number, cost: number): number {
  if (!(retail > 0) || !(cost >= 0)) return 0;
  return ((retail - cost) / retail) * 100;
}
