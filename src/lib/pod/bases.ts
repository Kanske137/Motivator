// Product bases (Phase 3b) — the client's view of the imported provider catalog.
//
// `product_bases` is the provider-catalog cache imported by `pod-catalog-import`
// (one row per Gelato catalog, with GENERIC variant axes instead of hardcoded
// size/frame/depth lists). The table is public-read, so the client fetches it
// directly. This module is the data layer the coming base-driven admin/editor
// slices build on; the four legacy wall-art kinds keep their curated vocabulary
// (gelato-catalog.ts) until they are migrated onto bases.
import { supabase } from "@/integrations/supabase/client";

export interface VariantAxisValue {
  key: string; // provider value uid, e.g. "200x300-mm" / "natural-wood"
  label: string; // human title from the provider, e.g. "200x300 mm"
}

export interface VariantAxis {
  key: string; // provider attribute uid, e.g. "GarmentSize"
  label: string;
  values: VariantAxisValue[];
}

export interface PrintArea {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  safeAreaMm?: number;
  bleedMm?: number;
}

export interface ProductBase {
  id: string;
  provider: string;
  /** Provider's catalog/product-family id, e.g. Gelato catalogUid ("t-shirts"). */
  providerProductId: string;
  title: string;
  category: string | null;
  variantAxes: VariantAxis[];
  printAreas: PrintArea[];
  mockup: "api" | "overlay" | "procedural";
  importedAt: string;
}

/** Runtime-narrow a jsonb `variant_axes` value into typed axes (drops junk). */
export function parseVariantAxes(json: unknown): VariantAxis[] {
  if (!Array.isArray(json)) return [];
  const axes: VariantAxis[] = [];
  for (const a of json) {
    if (!a || typeof a !== "object") continue;
    const key = String((a as Record<string, unknown>).key ?? "");
    if (!key) continue;
    const rawValues = (a as Record<string, unknown>).values;
    const values: VariantAxisValue[] = Array.isArray(rawValues)
      ? rawValues
          .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object")
          .map((v) => ({ key: String(v.key ?? ""), label: String(v.label ?? v.key ?? "") }))
          .filter((v) => v.key)
      : [];
    axes.push({ key, label: String((a as Record<string, unknown>).label ?? key), values });
  }
  return axes;
}

/** Runtime-narrow a jsonb `print_areas` value (empty until slice 3/3c fills it). */
export function parsePrintAreas(json: unknown): PrintArea[] {
  if (!Array.isArray(json)) return [];
  const out: PrintArea[] = [];
  for (const p of json) {
    if (!p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    const id = String(r.id ?? "");
    const widthMm = Number(r.widthMm);
    const heightMm = Number(r.heightMm);
    if (!id || !Number.isFinite(widthMm) || !Number.isFinite(heightMm)) continue;
    out.push({
      id,
      label: String(r.label ?? id),
      widthMm,
      heightMm,
      safeAreaMm: Number.isFinite(Number(r.safeAreaMm)) ? Number(r.safeAreaMm) : undefined,
      bleedMm: Number.isFinite(Number(r.bleedMm)) ? Number(r.bleedMm) : undefined,
    });
  }
  return out;
}

function normalizeMockup(raw: unknown): ProductBase["mockup"] {
  return raw === "overlay" || raw === "procedural" ? raw : "api";
}

type BaseRow = {
  id: string;
  provider: string;
  provider_product_id: string;
  title: string;
  category: string | null;
  variant_axes: unknown;
  print_areas: unknown;
  mockup: string;
  imported_at: string;
};

export function rowToProductBase(row: BaseRow): ProductBase {
  return {
    id: row.id,
    provider: row.provider,
    providerProductId: row.provider_product_id,
    title: row.title,
    category: row.category,
    variantAxes: parseVariantAxes(row.variant_axes),
    printAreas: parsePrintAreas(row.print_areas),
    mockup: normalizeMockup(row.mockup),
    importedAt: row.imported_at,
  };
}

/** All imported bases for a provider, alphabetical by title. */
export async function fetchProductBases(provider = "gelato"): Promise<ProductBase[]> {
  const { data, error } = await supabase
    .from("product_bases")
    .select("id, provider, provider_product_id, title, category, variant_axes, print_areas, mockup, imported_at")
    .eq("provider", provider)
    .order("title", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => rowToProductBase(row as BaseRow));
}
