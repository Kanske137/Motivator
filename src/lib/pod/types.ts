// Provider abstraction (Phase 3) — client side.
//
// Today only the catalog + SKU-resolution surface is implemented, and only for
// Gelato, at strict PARITY with the pre-refactor behavior. Print spec, mockups,
// ordering, pricing and shipping join this interface in later phases (3b–3e).
//
// The point of the abstraction: consumers ask the registry for a provider and
// call its methods, instead of importing Gelato-specific functions directly — so
// a second/third provider becomes a new adapter, never a rewrite.

export type Orientation = "portrait" | "landscape";

/** Product kinds we model today. Generalized to a data-driven catalog in Phase 3b. */
export type PodProductKind = "poster" | "canvas" | "aluminum" | "acrylic";

export interface ResolvedSku {
  /** The provider's SKU/UID, or null when nothing matched. */
  sku: string | null;
  source: "db" | "local-fallback" | "missing";
  key: string;
}

export interface PodProvider {
  readonly id: string;

  // --- Catalog (today: derived from the provider's SKU map) ---
  /** Sizes offered for a product kind. */
  getKindSizes(kind: PodProductKind): string[];
  /** Variants (frames / depths / materials / finishes) for a product kind. */
  getKindVariants(kind: PodProductKind): string[];
  /** Whether the provider has a SKU for this exact kind + size + variant. */
  hasSku(kind: PodProductKind, size: string, variant: string): boolean;
  /** The provider SKU for a kind + size + variant + orientation, or null. */
  getSku(
    kind: PodProductKind,
    size: string,
    variant: string,
    orientation?: Orientation,
  ): string | null;

  // --- Order-time resolution (per-config DB override + local fallbacks) ---
  resolveSku(args: {
    productType: string;
    size: string;
    variant?: string | null;
    orientation: Orientation;
    dbMap?: Record<string, Record<string, string>> | null;
  }): ResolvedSku;
}
