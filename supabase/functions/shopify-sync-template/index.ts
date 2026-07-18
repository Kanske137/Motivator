// Creates or updates a Shopify product to match a template stored in
// product_configs. Uses the Shopify Admin GraphQL API.
//
// Behaviour:
// - One Shopify product per (template, product_type). Handles get a -poster
//   or -canvas suffix when both kinds are enabled (so they remain separate
//   products with their own variants — Shopify's 3-option-axis limit makes
//   merging poster+canvas under one product impractical anyway).
// - Variants are the cartesian product of allowedSizes × (allowedFrames|allowedDepths).
//   SKU = Gelato UID (portrait orientation).
// - Status: DRAFT. Vendor: empty. Tags: [template_slug, product_type, "personalized", "print-on-demand"].
// - Online Store sales channel: published via publishablePublish.
// - On update we sync productOptions (so newly-added sizes/frames actually
//   become valid option-values BEFORE we try to bulk-create variants for them).
import { gelatoUid, searchGelatoProductUids } from "../_shared/pod/gelato.ts";
import { getPreset, resolvePreset } from "../_shared/pod/presets.ts";
import {
  buildVariantInput,
  desiredOptionValuesByAxis,
  fullComboFingerprint,
  keyFromPlannedVariant,
  keyFromSelectedOptions,
  planBaseGroup,
  selectableAxesFromJson,
  type PlannedGroup,
  type PlannedVariant,
  type VariantInput,
} from "../_shared/pod/sync-plan.ts";

// Local CORS headers — MUST allow the x-shopify-session-token header so the
// browser's preflight passes (the shared esm.sh corsHeaders doesn't list it).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shopify-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
import {
  makeShopifyAdmin,
  type ShopifyAdminClient,
  type ShopifyAuthError,
} from "../_shared/shopify-admin.ts";
import {
  AuthError,
  authErrorResponse,
  requireInstallation,
} from "../_shared/require-installation.ts";

// Mirrors src/lib/pricing.ts — used by the live "Personlig Karta" products.
// Speglar src/lib/pricing.ts. Hängare ingår som extra ramvärden under
// samma "Ram"-option. 13x18 har inga hängare (Gelato saknar SKU).
const POSTER_PRICES: Record<string, Record<string, number>> = {
  "13x18": { Ingen: 199, Vit: 349, Svart: 349, Ek: 369, "Valnöt": 369 },
  "21x30": { Ingen: 239, Vit: 399, Svart: 399, Ek: 429, "Valnöt": 429, "Hängare Vit": 339, "Hängare Svart": 339, "Hängare Ek": 349, "Hängare Valnöt": 349 },
  "30x40": { Ingen: 259, Vit: 559, Svart: 559, Ek: 589, "Valnöt": 589, "Hängare Vit": 439, "Hängare Svart": 439, "Hängare Ek": 449, "Hängare Valnöt": 449 },
  "40x50": { Ingen: 289, Vit: 749, Svart: 749, Ek: 789, "Valnöt": 789, "Hängare Vit": 489, "Hängare Svart": 489, "Hängare Ek": 499, "Hängare Valnöt": 499 },
  "50x70": { Ingen: 329, Vit: 919, Svart: 919, Ek: 969, "Valnöt": 969, "Hängare Vit": 589, "Hängare Svart": 589, "Hängare Ek": 599, "Hängare Valnöt": 599 },
  "70x100": { Ingen: 429, Vit: 1249, Svart: 1249, Ek: 1299, "Valnöt": 1299, "Hängare Vit": 729, "Hängare Svart": 729, "Hängare Ek": 749, "Hängare Valnöt": 749 },
};

const CANVAS_PRICES: Record<string, Record<string, number>> = {
  "20x25": { "2cm": 299, "4cm": 319 },
  "20x30": { "2cm": 349, "4cm": 379 },
  "30x40": { "2cm": 449, "4cm": 489 },
  "40x50": { "2cm": 599, "4cm": 649 },
  "40x60": { "2cm": 699, "4cm": 759 },
  "50x70": { "2cm": 799, "4cm": 869 },
  "60x80": { "2cm": 999, "4cm": 1099 },
  "70x100": { "2cm": 1299, "4cm": 1399 },
};

const ALUMINUM_PRICES: Record<string, Record<string, number>> = {
  "20x30": { Standard: 399 },
  "30x40": { Standard: 499 },
  "40x50": { Standard: 649 },
  "50x70": { Standard: 849 },
  "70x100": { Standard: 1199 },
};

const ACRYLIC_PRICES: Record<string, Record<string, number>> = {
  "20x30": { Standard: 499 },
  "30x40": { Standard: 699 },
  "40x50": { Standard: 899 },
  "50x70": { Standard: 1099 },
  "70x100": { Standard: 1599 },
};

type Kind = "poster" | "canvas" | "aluminum" | "acrylic";
const KIND_TO_SKU_KEY: Record<Kind, string> = {
  poster: "posters",
  canvas: "canvas",
  aluminum: "aluminum",
  acrylic: "acrylic",
};

function getUid(
  kind: Kind,
  size: string,
  variant: string,
  presetUids?: Record<string, string>,
): string | null {
  // Poster resolves through the generic PRESET (data-driven, live catalog) when
  // it was pre-resolved (see resolvePosterPresetUids); otherwise the frozen
  // sku-map is the fallback, so a failed/absent live lookup never regresses sync.
  // Proven byte-equivalent to the frozen map (verifyPreset: 50/50). Portrait UID
  // is the Shopify SKU, exactly as before.
  const fromPreset = presetUids?.[`${kind}|${size}|${variant}`];
  if (fromPreset) return fromPreset;
  return gelatoUid(KIND_TO_SKU_KEY[kind], size, variant, "portrait");
}

// Which config field holds each wall-art kind's variant values, and any axes to
// fix (poster paper). The preset catalogAxis value keys match these values.
const WALL_ART_PRESET_KINDS: Record<Kind, { variantsFrom: (opts: any) => string[]; fixed?: Record<string, string> }> = {
  poster: { variantsFrom: (o) => mergedPosterFrames(o.poster?.allowedFrames), fixed: { paper: "200-gsm-uncoated" } },
  canvas: { variantsFrom: (o) => o.canvas?.allowedDepths ?? [] },
  aluminum: { variantsFrom: (o) => o.aluminum?.allowedMaterials ?? [] },
  acrylic: { variantsFrom: (o) => o.acrylic?.allowedFinishes ?? [] },
};

/** Pre-resolve wall-art UIDs through each kind's generic preset (one live Gelato
 *  search per enabled size×variant), keyed `<kind>|<size>|<variant>`. Runs once
 *  before planning so plan()/planConsolidated() stay synchronous. The frozen
 *  sku-map remains the fallback inside getUid. */
async function resolveWallArtPresetUids(
  template: any,
  apiKey: string | undefined,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const opts = template?.productOptions ?? {};
  if (!apiKey) return out;
  for (const kind of Object.keys(WALL_ART_PRESET_KINDS) as Kind[]) {
    if (!opts[kind]?.enabled) continue;
    const preset = getPreset(kind);
    if (!preset) continue;
    const cfg = WALL_ART_PRESET_KINDS[kind];
    const sizes: string[] = opts[kind].allowedSizes ?? [];
    const variants = cfg.variantsFrom(opts);
    for (const size of sizes) {
      for (const variant of variants) {
        const res = resolvePreset(preset, { ...(cfg.fixed ?? {}), size, [preset.catalogAxis]: variant });
        if (!res) continue;
        try {
          const r = await searchGelatoProductUids({
            apiKey, catalogUid: res.catalog,
            attributeFilters: { ...res.filters, Orientation: ["ver"] }, limit: 2,
          });
          if (r.productUids[0]) out[`${kind}|${size}|${variant}`] = r.productUids[0];
        } catch (e) {
          console.warn(`[preset] ${kind} ${size}|${variant} failed, using frozen map: ${e}`);
        }
      }
    }
  }
  console.log(`[preset] pre-resolved ${Object.keys(out).length} wall-art UIDs via presets`);
  return out;
}

// Effective price lookup: per-template override ?? per-tenant global default.
// Returns 0 → variant is skipped as "no price". Prices are data-driven now
// (pricing_rules + template.priceOverrides); the hardcoded *_PRICES tables above
// are no longer used by sync.
type PriceLookup = (material: string, size: string, variant: string) => number;

interface SyncBody {
  handle: string;
}

// VariantInput / PlannedVariant / OptionAxis / PlannedGroup now live in the
// shared axis-agnostic module (_shared/pod/sync-plan.ts) so wall art and generic
// bases share one downstream. Wall-art plans below fill `optionValues` to mirror
// the old fixed [Storlek, <variantOptionName>] (+ Produkttyp) layout exactly.

const CANONICAL_POSTER_FRAMES = [
  "Ingen", "Vit", "Svart", "Ek", "Valnöt",
  "Hängare Vit", "Hängare Svart", "Hängare Ek", "Hängare Valnöt",
];

function mergedPosterFrames(saved: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of [...(saved ?? []), ...CANONICAL_POSTER_FRAMES]) {
    if (!seen.has(f)) { seen.add(f); out.push(f); }
  }
  return out;
}

function plan(template: any, priceOf: PriceLookup, presetUids: Record<string, string> = {}): PlannedGroup[] {
  const groups: PlannedGroup[] = [];
  const opts = template?.productOptions ?? {};

  const buildGroup = (
    kind: Kind,
    productType: string,
    variantOptionName: string,
    sizes: string[],
    variants: string[],
  ): PlannedGroup => {
    const g: PlannedGroup = {
      kind,
      productType,
      variantOptionName,
      optionAxes: [
        { name: "Storlek", values: sizes },
        { name: variantOptionName, values: variants },
      ],
      variants: [],
      skipped: [],
    };
    for (const size of sizes) {
      for (const v of variants) {
        const sku = getUid(kind, size, v, presetUids);
        const price = priceOf(kind, size, v);
        if (!sku) { g.skipped.push({ size, variant: v, reason: "no Gelato SKU" }); continue; }
        if (!price) { g.skipped.push({ size, variant: v, reason: "no price" }); continue; }
        g.variants.push({
          size,
          variant: v,
          sku,
          price,
          // Mirror the old fixed layout: [Storlek, <variantOptionName>].
          optionValues: [
            { optionName: "Storlek", value: size },
            { optionName: variantOptionName, value: v },
          ],
        });
      }
    }
    return g;
  };

  if (opts.poster?.enabled) {
    // Kanonisk ram-lista: säkerställer att alla hängar-värden alltid syncas
    // till Shopify, även för äldre mallar som sparades innan hängarna lades
    // till i defaults. plan() hoppar ändå över storlek/variant utan SKU/pris.
    groups.push(buildGroup("poster", "Poster", "Ram",
      opts.poster.allowedSizes ?? [], mergedPosterFrames(opts.poster.allowedFrames)));
  }
  if (opts.canvas?.enabled) {
    groups.push(buildGroup("canvas", "Canvas", "Djup",
      opts.canvas.allowedSizes ?? [], opts.canvas.allowedDepths ?? []));
  }
  if (opts.aluminum?.enabled) {
    groups.push(buildGroup("aluminum", "Aluminium", "Material",
      opts.aluminum.allowedSizes ?? [], opts.aluminum.allowedMaterials ?? []));
  }
  if (opts.acrylic?.enabled) {
    groups.push(buildGroup("acrylic", "Akryl", "Finish",
      opts.acrylic.allowedSizes ?? [], opts.acrylic.allowedFinishes ?? []));
  }
  return groups;
}

const PRODUCT_TYPE_LABELS: Record<Kind, string> = {
  poster: "Poster",
  canvas: "Canvas",
  aluminum: "Metallposter",
  acrylic: "Plexiglas",
};

const PRODUCT_TYPE_FROM_INTERNAL: Record<string, Kind> = {
  posters: "poster",
  poster: "poster",
  canvas: "canvas",
  aluminum: "aluminum",
  acrylic: "acrylic",
};

/** Konsoliderad: bygg EN PlannedGroup med 3 axlar (Produkttyp/Storlek/Utförande). */
function planConsolidated(template: any, enabledTypes: string[], priceOf: PriceLookup, presetUids: Record<string, string> = {}): PlannedGroup {
  const opts = template?.productOptions ?? {};
  const variants: PlannedVariant[] = [];
  const skipped: PlannedGroup["skipped"] = [];
  const productTypeValues: string[] = [];
  const sizesUnion = new Set<string>();
  const variantsUnion = new Set<string>();

  const planFor = (kind: Kind): { sizes: string[]; names: string[] } | null => {
    if (kind === "poster" && opts.poster?.enabled) return { sizes: opts.poster.allowedSizes ?? [], names: mergedPosterFrames(opts.poster.allowedFrames) };
    if (kind === "canvas" && opts.canvas?.enabled) return { sizes: opts.canvas.allowedSizes ?? [], names: opts.canvas.allowedDepths ?? [] };
    if (kind === "aluminum" && opts.aluminum?.enabled) return { sizes: opts.aluminum.allowedSizes ?? [], names: opts.aluminum.allowedMaterials ?? [] };
    if (kind === "acrylic" && opts.acrylic?.enabled) return { sizes: opts.acrylic.allowedSizes ?? [], names: opts.acrylic.allowedFinishes ?? [] };
    return null;
  };

  for (const t of enabledTypes) {
    const kind = PRODUCT_TYPE_FROM_INTERNAL[t];
    if (!kind) continue;
    const block = planFor(kind);
    if (!block) continue;
    const label = PRODUCT_TYPE_LABELS[kind];
    if (!productTypeValues.includes(label)) productTypeValues.push(label);
    for (const size of block.sizes) {
      sizesUnion.add(size);
      for (const v of block.names) {
        const sku = getUid(kind, size, v, presetUids);
        const price = priceOf(kind, size, v);
        if (!sku) { skipped.push({ size: `${label}/${size}`, variant: v, reason: "no Gelato SKU" }); continue; }
        if (!price) { skipped.push({ size: `${label}/${size}`, variant: v, reason: "no price" }); continue; }
        variantsUnion.add(v);
        variants.push({
          size,
          variant: v,
          sku,
          price,
          productTypeLabel: label,
          // Mirror the old fixed consolidated layout: [Produkttyp, Storlek, Utförande].
          optionValues: [
            { optionName: "Produkttyp", value: label },
            { optionName: "Storlek", value: size },
            { optionName: "Utförande", value: v },
          ],
        });
      }
    }
  }

  return {
    kind: "multi",
    productType: "Personlig poster",
    variantOptionName: "Utförande",
    optionAxes: [
      { name: "Produkttyp", values: productTypeValues },
      { name: "Storlek", values: [...sizesUnion] },
      { name: "Utförande", values: [...variantsUnion] },
    ],
    isConsolidated: true,
    variants,
    skipped,
  };
}

const GET_PRODUCT_BY_HANDLE = `
  query getProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      handle
      title
      options { id name position values optionValues { id name } }
      variants(first: 250) {
        nodes { id sku title selectedOptions { name value } }
      }
    }
  }`;

const PRODUCT_CREATE = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product { id handle title options { id name } }
      userErrors { field message }
    }
  }`;

const PRODUCT_UPDATE = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id handle }
      userErrors { field message }
    }
  }`;

const PRODUCT_OPTION_UPDATE = `
  mutation productOptionUpdate(
    $productId: ID!
    $option: OptionUpdateInput!
    $optionValuesToAdd: [OptionValueCreateInput!]
    $optionValuesToDelete: [ID!]
    $variantStrategy: ProductOptionUpdateVariantStrategy
  ) {
    productOptionUpdate(
      productId: $productId
      option: $option
      optionValuesToAdd: $optionValuesToAdd
      optionValuesToDelete: $optionValuesToDelete
      variantStrategy: $variantStrategy
    ) {
      userErrors { field message code }
    }
  }`;

const PRODUCT_VARIANTS_BULK_CREATE = `
  mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants { id sku title }
      userErrors { field message }
    }
  }`;

const PRODUCT_VARIANTS_BULK_UPDATE = `
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id sku title }
      userErrors { field message }
    }
  }`;

const PRODUCT_VARIANTS_BULK_DELETE = `
  mutation productVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
      product { id }
      userErrors { field message }
    }
  }`;

const METAFIELDS_SET = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message code }
    }
  }`;


const PUBLICATIONS_QUERY = `
  query publications {
    publications(first: 50) {
      nodes { id name }
    }
  }`;

const PUBLISHABLE_PUBLISH = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }`;

const GET_PRODUCT_FULL = `
  query getProductFull($id: ID!) {
    product(id: $id) {
      id
      title
      descriptionHtml
      tags
      status
      seo { title description }
      category { id }
    }
  }`;

// Shopify Standard Product Taxonomy GIDs.
// Branch: Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork
//   hg-3-4-2-1  Posters
//   hg-3-4-2-2  Prints
//   hg-3-4-2-4  Paintings
const DEFAULT_CATEGORY_GID: Record<Kind, string> = {
  poster:   "gid://shopify/TaxonomyCategory/hg-3-4-2-1",
  canvas:   "gid://shopify/TaxonomyCategory/hg-3-4-2-4",
  aluminum: "gid://shopify/TaxonomyCategory/hg-3-4-2-1",
  acrylic:  "gid://shopify/TaxonomyCategory/hg-3-4-2-2",
};


async function getAllPublications(
  admin: ShopifyAdminClient,
): Promise<{ id: string; name: string }[]> {
  try {
    const r = await admin<{
      publications: { nodes: { id: string; name: string }[] };
    }>(PUBLICATIONS_QUERY);
    const pubs = r.publications.nodes ?? [];
    console.log(`[publications] found ${pubs.length}: ${pubs.map((p) => p.name).join(", ")}`);
    return pubs;
  } catch (e) {
    console.warn("publications query failed", e);
    return [];
  }
}

/**
 * Publishes the product to ALL available publications (Online Store +
 * Headless/Storefront app channel + any extra sales channels). The
 * Storefront API token is bound to its own publication, so a product is
 * only readable via Storefront if it's published there — `status: ACTIVE`
 * alone is NOT enough. The previous implementation only published to the
 * first/Online-Store publication, which is why every template except the
 * legacy "personlig-karta" returned null from Storefront.
 */
async function publishToAllChannels(
  admin: ShopifyAdminClient,
  productId: string,
  pubs: { id: string; name: string }[],
): Promise<{ published: string[]; failed: string[] }> {
  if (!pubs.length) return { published: [], failed: [] };
  const published: string[] = [];
  const failed: string[] = [];
  for (const p of pubs) {
    try {
      const r = await admin<{
        publishablePublish: { userErrors: { message: string }[] };
      }>(PUBLISHABLE_PUBLISH, { id: productId, input: [{ publicationId: p.id }] });
      if (r.publishablePublish.userErrors.length) {
        console.warn(`publishablePublish errors for ${p.name}:`, r.publishablePublish.userErrors);
        failed.push(p.name);
      } else {
        published.push(p.name);
      }
    } catch (e) {
      console.warn(`publishablePublish failed for ${p.name}`, e);
      failed.push(p.name);
    }
  }
  return { published, failed };
}

/** Sync existing product's options so all desired sizes/frames exist as
 *  option-values BEFORE we try to bulk-create variants that reference them.
 *  Without this, productVariantsBulkCreate fails with "Option value 'Vit'
 *  is not allowed". */
async function syncProductOptions(
  admin: ShopifyAdminClient,
  productId: string,
  existing: {
    options: {
      id: string;
      name: string;
      values: string[];
      optionValues?: { id: string; name: string }[];
    }[];
  },
  group: PlannedGroup,
) {
  // Desired option values per axis, read from each variant's optionValues
  // (axis-agnostic — works for wall art's 2-3 named axes and generic bases alike).
  const desiredByOption = desiredOptionValuesByAxis(group);

  for (const optionName of Object.keys(desiredByOption)) {
    const existingOpt = existing.options.find((o) => o.name === optionName);
    if (!existingOpt) continue; // brand-new options would need productOptionsCreate; skip for now
    const desired = desiredByOption[optionName];
    const existingValues = existingOpt.values ?? [];
    const missing = desired.filter((v) => !existingValues.includes(v));
    // Only add — never auto-delete option-values here. Removing values
    // would orphan variants and is a destructive action better left to
    // the explicit variant-delete step below.
    if (missing.length === 0) continue;
    try {
      const r = await admin<{
        productOptionUpdate: { userErrors: { message: string; code?: string }[] };
      }>(PRODUCT_OPTION_UPDATE, {
        productId,
        option: { id: existingOpt.id },
        optionValuesToAdd: missing.map((name) => ({ name })),
        variantStrategy: "LEAVE_AS_IS",
      });
      const errs = r.productOptionUpdate.userErrors.filter(
        (e) => e.code !== "OPTION_VALUE_ALREADY_EXISTS",
      );
      if (errs.length) {
        console.warn(`productOptionUpdate(${optionName}) userErrors`, errs);
      }
    } catch (e) {
      console.warn(`productOptionUpdate(${optionName}) failed`, e);
    }
  }
}

// normalizeOptionValue / keyFromSelectedOptions / keyFromPlannedVariant /
// fullComboFingerprint now live in _shared/pod/sync-plan.ts. The old
// optionKeyFromSelected(selected, variantOptionName, isConsolidated) is replaced
// by keyFromSelectedOptions(selected, group.optionAxes): building the key from
// the group's ordered axes yields the SAME string (Produkttyp|Storlek|Utförande
// or Storlek|Ram) while also handling arbitrary base axes.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Verify the Shopify session token -> THIS shop's installation + Admin token.
  let ctx;
  try {
    ctx = await requireInstallation(req);
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { installationId, shop, accessToken, supabase } = ctx;
  const admin = makeShopifyAdmin(shop, accessToken);

  try {
    const body = (await req.json()) as SyncBody;
    if (!body?.handle) {
      return new Response(JSON.stringify({ error: "handle required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cfg, error } = await supabase
      .from("product_configs")
      .select(
        "id,title,shopify_handle,template_slug,template,tags,category_gid,status,sales_channels,description_html,seo_title,seo_description,is_consolidated,enabled_product_types",
      )
      .eq("installation_id", installationId)
      .eq("shopify_handle", body.handle)
      .maybeSingle();
    if (error || !cfg) {
      return new Response(JSON.stringify({ error: "config not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // template_slug = mall-id som binder ihop poster+canvas-varianter
    const templateSlug: string =
      (cfg as { template_slug?: string }).template_slug ??
      cfg.shopify_handle.replace(/-(poster|posters|canvas|aluminum|acrylic)$/i, "");

    const isConsolidated = !!(cfg as { is_consolidated?: boolean }).is_consolidated;
    const enabledTypes = ((cfg as { enabled_product_types?: string[] }).enabled_product_types ?? []);

    // Data-driven prices: this shop's global defaults + this template's overrides.
    const { data: priceRows } = await supabase
      .from("pricing_rules")
      .select("material,size,variant,price")
      .eq("installation_id", installationId);
    const globalPrices: Record<string, Record<string, Record<string, number>>> = {};
    for (const r of priceRows ?? []) {
      ((globalPrices[r.material] ??= {})[r.size] ??= {})[r.variant] = Number(r.price);
    }
    const overrides = ((cfg as { template?: { priceOverrides?: unknown } }).template?.priceOverrides
      ?? {}) as Record<string, Record<string, Record<string, number>>>;
    const priceOf: PriceLookup = (material, size, variant) => {
      const o = overrides?.[material]?.[size]?.[variant];
      if (typeof o === "number" && o > 0) return o;
      const g = globalPrices?.[material]?.[size]?.[variant];
      return typeof g === "number" ? g : 0;
    };

    // Resolve wall-art UIDs (poster/canvas/aluminum/acrylic) through their generic
    // presets once (live catalog), with the frozen sku-map as fallback in getUid.
    const presetUids = await resolveWallArtPresetUids(cfg.template, Deno.env.get("GELATO_API_KEY"));

    const groups: PlannedGroup[] = isConsolidated
      ? [planConsolidated(cfg.template, enabledTypes, priceOf, presetUids)]
      : plan(cfg.template, priceOf, presetUids);

    // Generic POD-catalog bases (mugs, apparel, …) — Phase 3b. Each enabled base
    // becomes its own Shopify product whose option axes are the base's own axes,
    // with SKUs resolved live from Gelato. `baseKinds` marks which groups are
    // bases so we can write their resolved UIDs to variant_map afterwards.
    const baseKinds = new Set<string>();
    const baseOpts = ((cfg.template as { productOptions?: { bases?: unknown } })?.productOptions?.bases
      ?? []) as Array<{ baseId?: string; provider?: string; enabled?: boolean; selectedAxes?: Record<string, string[]> }>;
    const gelatoKey = Deno.env.get("GELATO_API_KEY");
    for (const b of baseOpts) {
      if (!b?.enabled || !b?.baseId) continue;
      const provider = b.provider ?? "gelato";
      const { data: baseRow } = await supabase
        .from("product_bases")
        .select("provider_product_id, title, variant_axes")
        .eq("provider", provider)
        .eq("provider_product_id", b.baseId)
        .maybeSingle();
      if (!baseRow) { console.warn(`[plan] base "${b.baseId}" not in product_bases — skipped`); continue; }

      const axes = selectableAxesFromJson(baseRow.variant_axes);
      if (axes.length === 0 || axes.length > 3) {
        console.warn(`[plan] base "${b.baseId}" has ${axes.length} selectable axes (Shopify allows 1–3) — skipped`);
        continue;
      }

      const g = await planBaseGroup({
        baseId: baseRow.provider_product_id,
        title: baseRow.title || b.baseId,
        axes,
        selectedAxes: b.selectedAxes ?? {},
        baseFilters: { ProductStatus: ["activated"] },
        resolveUid: async (filters) => {
          if (!gelatoKey) return null;
          const r = await searchGelatoProductUids({
            apiKey: gelatoKey, catalogUid: b.baseId!, attributeFilters: filters, limit: 2,
          });
          // Fully-pinned filters should yield exactly one UID.
          return r.productUids[0] ?? null;
        },
        // Base pricing honours the "general price per material" model: an exact
        // per-combo rule wins, else a material-level default (a pricing_rules row
        // with size="*" variant="*"). Wall art has no "*" rows, so its lookup is
        // unchanged.
        priceOf: (size, variant) =>
          priceOf(b.baseId!, size, variant)
          || priceOf(b.baseId!, size, "*")
          || priceOf(b.baseId!, "*", "*"),
      });
      baseKinds.add(g.kind);
      groups.push(g);
    }

    const totalVariants = groups.reduce((n, g) => n + g.variants.length, 0);
    const allSkipped = groups.flatMap((g) =>
      g.skipped.map((s) => ({ kind: g.kind, ...s })),
    );
    for (const g of groups) {
      console.log(
        `[plan] ${g.kind} planned=${g.variants.length} skipped=${g.skipped.length}` +
        (g.skipped.length ? ` (${g.skipped.map((s) => `${s.size}/${s.variant}:${s.reason}`).join(", ")})` : ""),
      );
    }

    if (totalVariants === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Inga giltiga varianter — kontrollera SKU-mappning och priser",
          skipped: allSkipped,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cfgMeta = cfg as {
      id: string;
      tags?: string[];
      category_gid?: string | null;
      status?: string;
      sales_channels?: string[];
      description_html?: string | null;
      seo_title?: string | null;
      seo_description?: string | null;
    };

    // Load sync state (one row per product_config). Used for diff-protection
    // so we don't overwrite fields the merchant changed manually in Shopify.
    const { data: syncStateRow } = await supabase
      .from("shopify_sync_state")
      .select("id,last_synced_payload")
      .eq("installation_id", installationId)
      .eq("product_config_id", cfgMeta.id)
      .maybeSingle();
    const lastSynced = (syncStateRow?.last_synced_payload ?? {}) as Record<
      string,
      Record<string, unknown>
    >;

    const results: any[] = [];
    const nextSyncedPayload: Record<string, Record<string, unknown>> = {};
    // Fetch this shop's publications once (was a cross-shop module cache before).
    const pubs = await getAllPublications(admin);

    for (const group of groups) {
      const baseHandleHasNoSuffix = !/-(poster|posters|canvas|aluminum|acrylic)$/i.test(cfg.shopify_handle);
      // Konsoliderad: ALLTID base-handle och base-titel (mallnamn).
      const handleForKind = group.isConsolidated
        ? cfg.shopify_handle
        : (groups.length === 1 && baseHandleHasNoSuffix
          ? cfg.shopify_handle
          : `${templateSlug}-${group.kind}`);
      const titleForKind = group.isConsolidated
        ? cfg.title
        : (groups.length === 1 ? cfg.title : `${cfg.title} – ${group.productType}`);

      // Effective metadata (config values + sensible defaults).
      const tags = [
        ...new Set([
          templateSlug,
          group.isConsolidated ? "multi" : group.kind,
          "personalized",
          "print-on-demand",
          ...(cfgMeta.tags ?? []),
        ]),
      ];
      const categoryGid = cfgMeta.category_gid
        ?? (group.isConsolidated
          ? DEFAULT_CATEGORY_GID.poster
          // Base groups (kind = a baseId) have no wall-art taxonomy entry — fall
          // back to a generic category; refined per base category in a later slice.
          : DEFAULT_CATEGORY_GID[group.kind as Kind] ?? DEFAULT_CATEGORY_GID.poster);
      const status = (cfgMeta.status ?? "DRAFT").toUpperCase();
      const descriptionHtml =
        cfgMeta.description_html ?? "<p>Personlig design — skapas i editorn.</p>";
      const seoTitle = cfgMeta.seo_title ?? titleForKind;
      const seoDescription = cfgMeta.seo_description ?? null;

      const existing = (await admin<{
        productByHandle: null | {
          id: string;
          options: { id: string; name: string; values: string[] }[];
          variants: { nodes: { id: string; sku: string; selectedOptions: { name: string; value: string }[] }[] };
        };
      }>(GET_PRODUCT_BY_HANDLE, { handle: handleForKind })).productByHandle;

      let productId: string;
      let mode: "create" | "update" = "update";
      let variantsCreated = 0;
      let variantsUpdated = 0;
      let variantsDeleted = 0;
      const skippedFields: { field: string; reason: string }[] = [];

      let effectiveExisting = existing;

      if (!existing) {
        // CREATE — write product shell with options. Shopify auto-creates one
        // variant per option combination; we then refetch and fall through to
        // the update branch so price/SKU/etc. get set via bulkUpdate.
        const created = await admin<{
          productCreate: { product: { id: string }; userErrors: { message: string }[] };
        }>(PRODUCT_CREATE, {
          input: {
            title: titleForKind,
            handle: handleForKind,
            productType: group.productType,
            status,
            tags,
            descriptionHtml,
            category: categoryGid,
            seo: { title: seoTitle, description: seoDescription },
            productOptions: group.optionAxes.map((axis) => ({
              name: axis.name,
              values: axis.values.map((name) => ({ name })),
            })),
          },
        });
        if (created.productCreate.userErrors.length) {
          throw new Error(
            `productCreate userErrors: ${created.productCreate.userErrors
              .map((e) => e.message)
              .join("; ")}`,
          );
        }
        mode = "create";

        // Refetch to get option IDs + auto-created variant IDs.
        const refetched = (await admin<{
          productByHandle: null | {
            id: string;
            options: { id: string; name: string; values: string[] }[];
            variants: { nodes: { id: string; sku: string; selectedOptions: { name: string; value: string }[] }[] };
          };
        }>(GET_PRODUCT_BY_HANDLE, { handle: handleForKind })).productByHandle;
        if (!refetched) throw new Error("productCreate succeeded but refetch returned null");
        effectiveExisting = refetched;
      }

      {
        const existing = effectiveExisting!;
        productId = existing.id;

        // Diff-protect text fields. Pull current Shopify state and compare to
        // last_synced_payload; if Shopify diverged, the merchant edited the
        // field in Shopify Admin and we must not overwrite it.
        const currentResp = await admin<{
          product: {
            title: string;
            descriptionHtml: string;
            tags: string[];
            status: string;
            seo: { title: string | null; description: string | null };
            category: { id: string } | null;
          } | null;
        }>(GET_PRODUCT_FULL, { id: productId });
        const current = currentResp.product;
        const last = (lastSynced[group.kind] ?? {}) as Record<string, unknown>;
        const isFirstSync = Object.keys(last).length === 0;

        function protectedValue<T>(field: string, desired: T, currentVal: T): T {
          if (isFirstSync) {
            // Seed: keep whatever Shopify currently has, don't overwrite.
            skippedFields.push({ field, reason: "first sync — seeded from Shopify" });
            return currentVal;
          }
          const lastVal = last[field];
          // If Shopify's current value differs from what we last sent, merchant edited it.
          if (
            lastVal !== undefined &&
            JSON.stringify(currentVal) !== JSON.stringify(lastVal)
          ) {
            skippedFields.push({ field, reason: "modified in Shopify" });
            return currentVal;
          }
          return desired;
        }

        const safeTitle = protectedValue("title", titleForKind, current?.title ?? titleForKind);
        const safeDescription = protectedValue(
          "descriptionHtml",
          descriptionHtml,
          current?.descriptionHtml ?? descriptionHtml,
        );
        const safeTags = protectedValue("tags", tags, current?.tags ?? tags);
        const safeStatus = protectedValue("status", status, current?.status ?? status);
        const safeSeoTitle = protectedValue(
          "seo.title",
          seoTitle,
          current?.seo?.title ?? seoTitle,
        );
        const safeSeoDescription = protectedValue(
          "seo.description",
          seoDescription,
          current?.seo?.description ?? seoDescription,
        );
        const safeCategory = protectedValue(
          "category",
          categoryGid,
          current?.category?.id ?? categoryGid,
        );

        await admin(PRODUCT_UPDATE, {
          input: {
            id: productId,
            title: safeTitle,
            productType: group.productType,
            tags: safeTags,
            status: safeStatus,
            descriptionHtml: safeDescription,
            category: safeCategory,
            seo: { title: safeSeoTitle, description: safeSeoDescription },
          },
        });

        // Skriv custom.template_slug-metafält så theme-snippeten kan koppla
        // Shopify-produkten till rätt mall även om handle/titel byts manuellt
        // i Shopify Admin. Tyst miss-failed (loggas) — sync ska inte falla.
        try {
          const previewUrl = (body as { previewUrl?: string }).previewUrl;
          const metafields = [
            {
              ownerId: productId,
              namespace: "custom",
              key: "template_slug",
              type: "single_line_text_field",
              value: cfg.shopify_handle,
            },
          ];
          if (previewUrl) {
            metafields.push({
              ownerId: productId,
              namespace: "custom",
              key: "wallery_preview",
              type: "single_line_text_field",
              value: previewUrl,
            });
          }
          const metaRes = await admin<{
            metafieldsSet: { userErrors: { message: string; field?: string[] }[] };
          }>(METAFIELDS_SET, { metafields });
          if (metaRes.metafieldsSet.userErrors.length) {
            console.warn(
              "[sync] metafieldsSet warnings:",
              metaRes.metafieldsSet.userErrors.map((e) => e.message).join("; "),
            );
          }
        } catch (e) {
          console.warn("[sync] metafieldsSet failed:", (e as Error).message);
        }

        // Variants/options/SKU are ALWAYS source-of-truth from Lovable.
        await syncProductOptions(admin, productId, existing, group);

        const existingByKey = new Map<string, typeof existing.variants.nodes[number]>();
        const existingByCombo = new Map<string, typeof existing.variants.nodes[number]>();
        for (const n of existing.variants.nodes) {
          const k = keyFromSelectedOptions(n.selectedOptions, group.optionAxes);
          if (k) existingByKey.set(k, n);
          existingByCombo.set(fullComboFingerprint(n.selectedOptions), n);
        }
        const desiredKeys = new Set(
          group.variants
            .map((v) => keyFromPlannedVariant(v, group.optionAxes))
            .filter((k): k is string => k !== null),
        );

        const toCreate: VariantInput[] = [];
        const toUpdate: (VariantInput & { id: string })[] = [];
        const skippedDuplicates: string[] = [];
        for (const v of group.variants) {
          const key = keyFromPlannedVariant(v, group.optionAxes);
          const input = buildVariantInput(v);
          const ex = key ? existingByKey.get(key) : undefined;
          if (ex) {
            toUpdate.push({ ...input, id: ex.id });
            continue;
          }
          // Defensive fallback: maybe option-name matching drifted. Look up by
          // the unordered fingerprint of all option values.
          const fp = fullComboFingerprint(
            input.optionValues.map((o) => ({ name: o.optionName, value: o.name })),
          );
          const exByCombo = existingByCombo.get(fp);
          if (exByCombo) {
            toUpdate.push({ ...input, id: exByCombo.id });
            skippedDuplicates.push(`${v.size ?? ""}/${v.variant ?? ""} (matched by combo fingerprint)`);
            continue;
          }
          toCreate.push(input);
        }
        const toDelete = existing.variants.nodes
          .filter((n) => {
            const k = keyFromSelectedOptions(n.selectedOptions, group.optionAxes);
            return k !== null && !desiredKeys.has(k);
          })
          .map((n) => n.id);

        console.log(
          `[sync] ${group.kind} existing=${existing.variants.nodes.length} ` +
            `toCreate=${toCreate.length} toUpdate=${toUpdate.length} toDelete=${toDelete.length} ` +
            `dupRescued=${skippedDuplicates.length}`,
        );
        if (toCreate.length) {
          console.log(
            `[sync] ${group.kind} toCreate keys:`,
            toCreate.map((i) => i.optionValues.map((o) => o.name).join("/")).join(", "),
          );
        }
        if (skippedDuplicates.length) {
          console.log(`[sync] ${group.kind} duplicate-rescued:`, skippedDuplicates.join(", "));
        }


        if (toCreate.length) {
          const r = await admin<{
            productVariantsBulkCreate: {
              productVariants: { id: string }[];
              userErrors: { message: string; field?: string[] }[];
            };
          }>(PRODUCT_VARIANTS_BULK_CREATE, { productId, variants: toCreate });
          if (r.productVariantsBulkCreate.userErrors.length) {
            throw new Error(
              `bulkCreate(update) userErrors: ${r.productVariantsBulkCreate.userErrors
                .map((e) => `${(e.field ?? []).join(".")} ${e.message}`)
                .join("; ")}`,
            );
          }
          variantsCreated = r.productVariantsBulkCreate.productVariants.length;
        }
        if (toUpdate.length) {
          const r = await admin<{
            productVariantsBulkUpdate: {
              productVariants: { id: string }[];
              userErrors: { message: string; field?: string[] }[];
            };
          }>(PRODUCT_VARIANTS_BULK_UPDATE, { productId, variants: toUpdate });
          if (r.productVariantsBulkUpdate.userErrors.length) {
            console.error("bulkUpdate errors", r.productVariantsBulkUpdate.userErrors);
          }
          variantsUpdated = r.productVariantsBulkUpdate.productVariants.length;
        }
        if (toDelete.length) {
          const remaining = existing.variants.nodes.length - toDelete.length + toCreate.length;
          if (remaining >= 1) {
            await admin(PRODUCT_VARIANTS_BULK_DELETE, {
              productId,
              variantsIds: toDelete,
            });
            variantsDeleted = toDelete.length;
          }
        }
      }

      // Publish to ALL Shopify publications (Online Store + Storefront/Headless
      // app channel + any extras). Required so Storefront API can read the
      // product — `status: ACTIVE` alone does NOT make it visible.
      const wantsOnlineStore = (cfgMeta.sales_channels ?? ["online_store"]).includes(
        "online_store",
      );
      const publishResult = wantsOnlineStore
        ? await publishToAllChannels(admin, productId, pubs)
        : { published: [], failed: [] };

      // Snapshot what we just sent — this is what next sync will compare against.
      nextSyncedPayload[group.kind] = {
        title: titleForKind,
        descriptionHtml,
        tags,
        status,
        "seo.title": seoTitle,
        "seo.description": seoDescription,
        category: categoryGid,
      };

      results.push({
        kind: group.kind,
        handle: handleForKind,
        productId,
        mode,
        plannedVariants: group.variants.length,
        variantsCreated,
        variantsUpdated,
        variantsDeleted,
        publishedToOnlineStore: publishResult.published.length > 0,
        publishedTo: publishResult.published,
        publishFailed: publishResult.failed,
        skipped: group.skipped,
        skippedFields,
      });
    }

    // Persist resolved UIDs to variant_map so the order webhook resolves the
    // EXACT synced product — the webhook reads variant_map FIRST. Two keyings:
    //   * base groups  → `<baseId>|<size>` → { <variant>: uid }
    //   * POSTER       → `<size>` → { <frame>: uid }  (size-only path; poster
    //     frame values never collide with canvas/metal/acrylic variant values)
    // This is what makes the EXPANDED poster sizes/frames orderable — they are
    // not in the frozen sku-map. Canvas/metal/acrylic keep using the sku-map.
    const isPosterVariant = (groupKind: string, v: PlannedVariant) =>
      groupKind === "poster" || v.productTypeLabel === "Poster";
    const writesVariantMap =
      baseKinds.size > 0 ||
      groups.some((g) => g.variants.some((v) => isPosterVariant(g.kind, v)));
    if (writesVariantMap) {
      const { data: cfgRow } = await supabase
        .from("product_configs")
        .select("variant_map")
        .eq("installation_id", installationId)
        .eq("id", cfgMeta.id)
        .maybeSingle();
      const variantMap = { ...((cfgRow?.variant_map ?? {}) as Record<string, Record<string, string>>) };
      for (const group of groups) {
        for (const v of group.variants) {
          if (!v.size || !v.variant) continue;
          if (baseKinds.has(group.kind)) {
            (variantMap[`${group.kind}|${v.size}`] ??= {})[v.variant] = v.sku;
          } else if (isPosterVariant(group.kind, v)) {
            (variantMap[v.size] ??= {})[v.variant] = v.sku;
          }
        }
      }
      await supabase
        .from("product_configs")
        .update({ variant_map: variantMap })
        .eq("installation_id", installationId)
        .eq("id", cfgMeta.id);
    }

    // Persist sync state (upsert).
    if (syncStateRow) {
      await supabase
        .from("shopify_sync_state")
        .update({
          last_synced_at: new Date().toISOString(),
          last_synced_payload: nextSyncedPayload,
        })
        .eq("installation_id", installationId)
        .eq("id", syncStateRow.id);
    } else {
      await supabase.from("shopify_sync_state").insert({
        installation_id: installationId,
        product_config_id: cfgMeta.id,
        last_synced_at: new Date().toISOString(),
        last_synced_payload: nextSyncedPayload,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, templateSlug, results, skipped: allSkipped }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const code = (e as ShopifyAuthError | undefined)?.code;
    const source = (e as ShopifyAuthError | undefined)?.source;
    console.error("shopify-sync-template error:", code ?? "generic", msg);
    const status = code === "invalid_token" || code === "no_token" || code === "missing_scope"
      ? 401
      : 500;
    return new Response(
      JSON.stringify({ ok: false, error: msg, code, source }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
