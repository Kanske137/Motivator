// Axis-agnostic sync planning (Phase 3b slice 2b).
//
// The Shopify sync pipeline used to hardcode the wall-art option model — fixed
// slots (size / variant / productTypeLabel) and fixed option names
// ("Storlek" / "Produkttyp" / <variantOptionName>). This module makes the plan
// + variant-reconciliation layer driven by a generic ORDERED LIST OF AXES, so a
// Gelato "base" catalog (mugs, apparel, …) flows through the exact same
// downstream as wall art.
//
// The invariant that protects the live wall-art path: a variant's `optionValues`
// is PARALLEL to its group's `optionAxes`, one value per axis, IN AXIS ORDER.
// Wall art fills this to mirror the old fixed layout exactly, so its emitted
// Shopify option values + variant keys are byte-identical to before. Nothing
// here knows the word "size" — it only knows "axis N".
//
// Pure logic (no Deno / esm.sh imports) so it is unit-testable from vitest.

/** One option assignment on a variant, e.g. { optionName: "Storlek", value: "30x40" }. */
export interface OptionValue {
  optionName: string;
  value: string;
}

export interface OptionAxis {
  name: string;
  values: string[];
}

export interface PlannedVariant {
  /** Parallel to the group's optionAxes, in axis order. The single source of
   *  truth for this variant's Shopify option values + reconciliation key. */
  optionValues: OptionValue[];
  sku: string;
  price: number;
  /** Legacy display fields — used only for log/skip messages, never for keys. */
  size?: string;
  variant?: string;
  productTypeLabel?: string;
}

export interface PlannedGroup {
  /** "poster" | "canvas" | "aluminum" | "acrylic" | "multi" | a baseId. */
  kind: string;
  productType: string;
  /** The non-size variant axis name (wall art). Kept for logging; the generic
   *  key uses optionAxes directly. */
  variantOptionName: string;
  optionAxes: OptionAxis[];
  isConsolidated?: boolean;
  variants: PlannedVariant[];
  skipped: { size: string; variant: string; reason: string }[];
}

export interface VariantInput {
  optionValues: { optionName: string; name: string }[];
  price: string;
  inventoryItem: { sku: string; tracked: boolean };
  inventoryPolicy: "CONTINUE";
}

/** Canonicalize an option value for keys: lower-case, drop a trailing "cm",
 *  collapse whitespace. (Unchanged from the original inline helper.) */
export function normalizeOptionValue(s: string): string {
  return s.toLowerCase().replace(/\s*cm\s*$/i, "").replace(/\s+/g, " ").trim();
}

/** Build a stable variant key from value-by-axis-name, ordered by the group's
 *  optionAxes. Returns null if any axis is missing — i.e. the variant does not
 *  belong to this option scheme (so it is never matched or deleted). */
export function keyFromValuesByAxis(
  valuesByAxis: Record<string, string>,
  optionAxes: OptionAxis[],
): string | null {
  const parts: string[] = [];
  for (const a of optionAxes) {
    const v = valuesByAxis[a.name];
    if (v === undefined) return null;
    parts.push(normalizeOptionValue(v));
  }
  return parts.join("|");
}

/** Key for an EXISTING Shopify variant, from its selectedOptions. */
export function keyFromSelectedOptions(
  selected: { name: string; value: string }[],
  optionAxes: OptionAxis[],
): string | null {
  const byName: Record<string, string> = {};
  for (const s of selected) byName[s.name] = s.value;
  return keyFromValuesByAxis(byName, optionAxes);
}

/** Key for a DESIRED planned variant, from its optionValues. */
export function keyFromPlannedVariant(v: PlannedVariant, optionAxes: OptionAxis[]): string | null {
  const byName: Record<string, string> = {};
  for (const ov of v.optionValues) byName[ov.optionName] = ov.value;
  return keyFromValuesByAxis(byName, optionAxes);
}

/** Order-independent fingerprint of ALL a variant's option values — the
 *  defensive duplicate detector for when option-name matching drifts. */
export function fullComboFingerprint(selected: { name: string; value: string }[]): string {
  return selected.map((s) => normalizeOptionValue(s.value)).sort().join("|");
}

/** Shopify variant payload from a planned variant (axis-agnostic). */
export function buildVariantInput(v: PlannedVariant): VariantInput {
  return {
    optionValues: v.optionValues.map((ov) => ({ optionName: ov.optionName, name: ov.value })),
    price: v.price.toFixed(2),
    inventoryItem: { sku: v.sku, tracked: false },
    inventoryPolicy: "CONTINUE",
  };
}

/** The desired set of values per option axis (used to pre-create Shopify option
 *  values before bulk-creating variants that reference them). */
export function desiredOptionValuesByAxis(group: PlannedGroup): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of group.optionAxes) {
    const vals = new Set<string>();
    for (const v of group.variants) {
      const ov = v.optionValues.find((o) => o.optionName === a.name);
      if (ov?.value) vals.add(ov.value);
    }
    out[a.name] = [...vals];
  }
  return out;
}

// ---------- generic base (POD-catalog) planning ----------

export interface SelectableAxisInput {
  /** Provider attribute uid, e.g. "MugSize". Used to build attributeFilters. */
  key: string;
  /** Human option name shown in Shopify, e.g. "Size". */
  name: string;
  /** Candidate values (key = provider value uid, label = human). */
  values: { key: string; label: string }[];
}

// Bookkeeping axes Gelato returns on every catalog that are NOT real customer
// choices. MUST match the client's list in src/lib/pod/bases.ts.
const NON_SELECTABLE_AXES = new Set([
  "ProductStatus",
  "State",
  "ProductModel",
  "Variable",
  "ApparelManufacturerSKU",
]);

/** Parse a `product_bases.variant_axes` jsonb value into the axes a merchant
 *  actually chooses from: drops bookkeeping axes and any single-value axis.
 *  Orientation-less products (mugs) simply have no Orientation axis to return. */
export function selectableAxesFromJson(json: unknown): SelectableAxisInput[] {
  if (!Array.isArray(json)) return [];
  const out: SelectableAxisInput[] = [];
  for (const a of json) {
    if (!a || typeof a !== "object") continue;
    const key = String((a as Record<string, unknown>).key ?? "");
    if (!key || NON_SELECTABLE_AXES.has(key)) continue;
    const rawValues = (a as Record<string, unknown>).values;
    const values = Array.isArray(rawValues)
      ? rawValues
          .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object")
          .map((v) => ({ key: String(v.key ?? ""), label: String(v.label ?? v.key ?? "") }))
          .filter((v) => v.key)
      : [];
    if (values.length <= 1) continue; // no real choice
    out.push({ key, name: String((a as Record<string, unknown>).label ?? key), values });
  }
  return out;
}

/** Cartesian product over each axis's chosen values (or ALL its values when the
 *  merchant selected none for that axis — "unrestricted" = offer everything).
 *  Every axis is always pinned, so each combo resolves to a single provider UID. */
export function enumerateBaseCombos(
  axes: SelectableAxisInput[],
  selectedAxes: Record<string, string[]>,
  cap = 250,
): { key: string; label: string; axisKey: string; axisName: string }[][] {
  const perAxis = axes.map((a) => {
    const chosen = selectedAxes[a.key] ?? [];
    const values = chosen.length
      ? a.values.filter((v) => chosen.includes(v.key))
      : a.values;
    return values.map((v) => ({ key: v.key, label: v.label, axisKey: a.key, axisName: a.name }));
  });
  // Any axis with zero candidates makes the product impossible → no combos.
  if (perAxis.some((vs) => vs.length === 0)) return [];

  let combos: { key: string; label: string; axisKey: string; axisName: string }[][] = [[]];
  for (const axisValues of perAxis) {
    const next: typeof combos = [];
    for (const combo of combos) {
      for (const v of axisValues) {
        next.push([...combo, v]);
        if (next.length > cap) return next.slice(0, cap);
      }
    }
    combos = next;
  }
  return combos;
}

/** For pricing: which combo value is the "size" slot vs the "variant" slot in
 *  the (material, size, variant) pricing_rules shape. Primary = an axis whose
 *  key contains "size" (else the first axis); the rest join into the variant
 *  slot. Deterministic; matches how a merchant prices per size + per finish. */
export function pricingSlots(
  combo: { key: string; axisKey: string }[],
): { sizeSlot: string; variantSlot: string } {
  const sizeIdx = Math.max(
    0,
    combo.findIndex((c) => /size/i.test(c.axisKey)),
  );
  const sizeSlot = combo[sizeIdx]?.key ?? "";
  const variantSlot = combo
    .filter((_, i) => i !== sizeIdx)
    .map((c) => c.key)
    .join("/");
  return { sizeSlot, variantSlot };
}

/**
 * Plan a Gelato base into a PlannedGroup. `resolveUid` runs the live provider
 * search for a fully-pinned attribute set (injected so this stays pure/testable);
 * `priceOf(sizeSlot, variantSlot)` returns the price or 0 to skip.
 */
export async function planBaseGroup(args: {
  baseId: string;
  title: string;
  axes: SelectableAxisInput[];
  selectedAxes: Record<string, string[]>;
  resolveUid: (attributeFilters: Record<string, string[]>) => Promise<string | null>;
  priceOf: (sizeSlot: string, variantSlot: string) => number;
  /** Extra fixed filters every search carries, e.g. { ProductStatus: ["activated"] }. */
  baseFilters?: Record<string, string[]>;
}): Promise<PlannedGroup> {
  const { baseId, title, axes, selectedAxes, resolveUid, priceOf, baseFilters } = args;

  const group: PlannedGroup = {
    kind: baseId,
    productType: title,
    variantOptionName: axes[axes.length - 1]?.name ?? "",
    optionAxes: axes.map((a) => ({
      name: a.name,
      values: (selectedAxes[a.key]?.length
        ? a.values.filter((v) => selectedAxes[a.key].includes(v.key))
        : a.values
      ).map((v) => v.label),
    })),
    variants: [],
    skipped: [],
  };

  const combos = enumerateBaseCombos(axes, selectedAxes);
  for (const combo of combos) {
    const attributeFilters: Record<string, string[]> = { ...(baseFilters ?? {}) };
    for (const c of combo) attributeFilters[c.axisKey] = [c.key];

    const comboLabel = combo.map((c) => c.label).join(" / ");
    const { sizeSlot, variantSlot } = pricingSlots(combo);
    const price = priceOf(sizeSlot, variantSlot);
    if (!price) {
      group.skipped.push({ size: sizeSlot, variant: variantSlot, reason: "no price" });
      continue;
    }

    const uid = await resolveUid(attributeFilters);
    if (!uid) {
      group.skipped.push({ size: sizeSlot, variant: variantSlot, reason: "no Gelato SKU" });
      continue;
    }

    group.variants.push({
      optionValues: combo.map((c) => ({ optionName: c.axisName, value: c.label })),
      sku: uid,
      price,
      size: sizeSlot,
      variant: variantSlot,
    });
  }
  return group;
}
