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
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import skuMap from "../_shared/gelato-sku-map.json" with { type: "json" };
import {
  ensureShopifyAuth,
  shopifyAdmin,
  type ShopifyAuthError,
} from "../_shared/shopify-admin.ts";

// Mirrors src/lib/pricing.ts — used by the live "Personlig Karta" products.
const POSTER_PRICES: Record<string, Record<string, number>> = {
  "13x18": { Ingen: 199, Vit: 349, Svart: 349, Ek: 369, "Valnöt": 369 },
  "21x30": { Ingen: 239, Vit: 399, Svart: 399, Ek: 429, "Valnöt": 429 },
  "30x40": { Ingen: 259, Vit: 559, Svart: 559, Ek: 589, "Valnöt": 589 },
  "40x50": { Ingen: 289, Vit: 749, Svart: 749, Ek: 789, "Valnöt": 789 },
  "50x70": { Ingen: 329, Vit: 919, Svart: 919, Ek: 969, "Valnöt": 969 },
  "70x100": { Ingen: 429, Vit: 1249, Svart: 1249, Ek: 1299, "Valnöt": 1299 },
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

type SkuMap = Record<string, Record<string, { portrait: string; landscape: string }>>;
const SKUS = skuMap as SkuMap;

function getUid(kind: "poster" | "canvas", size: string, variant: string): string | null {
  const block = SKUS[kind === "poster" ? "posters" : "canvas"] ?? {};
  return block[`${size}|${variant}`]?.portrait ?? null;
}

function getPrice(kind: "poster" | "canvas", size: string, variant: string): number {
  const table = kind === "poster" ? POSTER_PRICES : CANVAS_PRICES;
  return table[size]?.[variant] ?? 0;
}

interface SyncBody {
  handle: string;
}

interface VariantInput {
  optionValues: { optionName: string; name: string }[];
  price: string;
  inventoryItem: { sku: string; tracked: boolean };
  inventoryPolicy: "CONTINUE";
}

interface PlannedVariant {
  size: string;
  variant: string;
  sku: string;
  price: number;
}

interface PlannedGroup {
  kind: "poster" | "canvas";
  productType: string;
  variantOptionName: string; // "Ram" or "Djup"
  variants: PlannedVariant[];
  skipped: { size: string; variant: string; reason: string }[];
}

function plan(template: any): PlannedGroup[] {
  const groups: PlannedGroup[] = [];
  const opts = template?.productOptions ?? {};
  if (opts.poster?.enabled) {
    const g: PlannedGroup = {
      kind: "poster",
      productType: "Poster",
      variantOptionName: "Ram",
      variants: [],
      skipped: [],
    };
    for (const size of opts.poster.allowedSizes ?? []) {
      for (const frame of opts.poster.allowedFrames ?? []) {
        const sku = getUid("poster", size, frame);
        const price = getPrice("poster", size, frame);
        if (!sku) {
          g.skipped.push({ size, variant: frame, reason: "no Gelato SKU" });
          continue;
        }
        if (!price) {
          g.skipped.push({ size, variant: frame, reason: "no price" });
          continue;
        }
        g.variants.push({ size, variant: frame, sku, price });
      }
    }
    groups.push(g);
  }
  if (opts.canvas?.enabled) {
    const g: PlannedGroup = {
      kind: "canvas",
      productType: "Canvas",
      variantOptionName: "Djup",
      variants: [],
      skipped: [],
    };
    for (const size of opts.canvas.allowedSizes ?? []) {
      for (const depth of opts.canvas.allowedDepths ?? []) {
        const sku = getUid("canvas", size, depth);
        const price = getPrice("canvas", size, depth);
        if (!sku) {
          g.skipped.push({ size, variant: depth, reason: "no Gelato SKU" });
          continue;
        }
        if (!price) {
          g.skipped.push({ size, variant: depth, reason: "no price" });
          continue;
        }
        g.variants.push({ size, variant: depth, sku, price });
      }
    }
    groups.push(g);
  }
  return groups;
}

const GET_PRODUCT_BY_HANDLE = `
  query getProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      handle
      title
      options { id name position values optionValues { id name } }
      variants(first: 100) {
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

const PUBLICATIONS_QUERY = `
  query publications {
    publications(first: 25) {
      nodes { id name }
    }
  }`;

const PUBLISHABLE_PUBLISH = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }`;

function buildVariantInput(
  group: PlannedGroup,
  v: PlannedVariant,
): VariantInput {
  // Shopify Admin API 2025-07: sku/barcode/tracked all live inside inventoryItem.
  return {
    optionValues: [
      { optionName: "Storlek", name: v.size },
      { optionName: group.variantOptionName, name: v.variant },
    ],
    price: v.price.toFixed(2),
    inventoryItem: {
      sku: v.sku,
      tracked: false,
    },
    inventoryPolicy: "CONTINUE",
  };
}

let cachedOnlineStorePublicationId: string | null = null;

async function getOnlineStorePublicationId(): Promise<string | null> {
  if (cachedOnlineStorePublicationId) return cachedOnlineStorePublicationId;
  try {
    const r = await shopifyAdmin<{ publications: { nodes: { id: string; name: string }[] } }>(
      PUBLICATIONS_QUERY,
    );
    const onlineStore = r.publications.nodes.find((p) =>
      /online store/i.test(p.name)
    ) ?? r.publications.nodes[0];
    cachedOnlineStorePublicationId = onlineStore?.id ?? null;
    return cachedOnlineStorePublicationId;
  } catch (e) {
    console.warn("publications query failed", e);
    return null;
  }
}

async function publishToOnlineStore(productId: string): Promise<boolean> {
  const pubId = await getOnlineStorePublicationId();
  if (!pubId) return false;
  try {
    const r = await shopifyAdmin<{
      publishablePublish: { userErrors: { message: string }[] };
    }>(PUBLISHABLE_PUBLISH, { id: productId, input: [{ publicationId: pubId }] });
    if (r.publishablePublish.userErrors.length) {
      console.warn("publishablePublish errors", r.publishablePublish.userErrors);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("publishablePublish failed", e);
    return false;
  }
}

/** Sync existing product's options so all desired sizes/frames exist as
 *  option-values BEFORE we try to bulk-create variants that reference them.
 *  Without this, productVariantsBulkCreate fails with "Option value 'Vit'
 *  is not allowed". */
async function syncProductOptions(
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
  const desiredByOption: Record<string, string[]> = {
    Storlek: [...new Set(group.variants.map((v) => v.size))],
    [group.variantOptionName]: [
      ...new Set(group.variants.map((v) => v.variant)),
    ],
  };

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
      const r = await shopifyAdmin<{
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

/** Build a stable key from a variant's selectedOptions (Storlek + Ram/Djup),
 *  independent of order. */
function optionKeyFromSelected(
  selected: { name: string; value: string }[],
  variantOptionName: string,
): string | null {
  const size = selected.find((s) => s.name === "Storlek")?.value;
  const variant = selected.find((s) => s.name === variantOptionName)?.value;
  if (!size || !variant) return null;
  return `${size}|${variant}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as SyncBody;
    if (!body?.handle) {
      return new Response(JSON.stringify({ error: "handle required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await ensureShopifyAuth();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: cfg, error } = await supabase
      .from("product_configs")
      .select("title,shopify_handle,template_slug,template")
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
      cfg.shopify_handle.replace(/-(poster|posters|canvas)$/i, "");

    const groups = plan(cfg.template);
    const totalVariants = groups.reduce((n, g) => n + g.variants.length, 0);
    const allSkipped = groups.flatMap((g) =>
      g.skipped.map((s) => ({ kind: g.kind, ...s })),
    );

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

    const results: any[] = [];
    for (const group of groups) {
      // Always suffix the handle with the kind so poster + canvas stay
      // separate products (Shopify cannot host them under one product
      // because we'd hit the 3-option-axis limit when adding more axes
      // later). Backwards-compat: if there's only one group AND the
      // existing handle has no suffix, keep it unsuffixed.
      const baseHandleHasNoSuffix = !/-(poster|posters|canvas)$/i.test(cfg.shopify_handle);
      const handleForKind = groups.length === 1 && baseHandleHasNoSuffix
        ? cfg.shopify_handle
        : `${templateSlug}-${group.kind}`;
      const titleForKind =
        groups.length === 1 ? cfg.title : `${cfg.title} – ${group.productType}`;

      const tags = [templateSlug, group.kind, "personalized", "print-on-demand"];

      const existing = (await shopifyAdmin<{
        productByHandle: null | {
          id: string;
          options: { id: string; name: string; values: string[] }[];
          variants: { nodes: { id: string; sku: string; selectedOptions: { name: string; value: string }[] }[] };
        };
      }>(GET_PRODUCT_BY_HANDLE, { handle: handleForKind })).productByHandle;

      let productId: string;
      let mode: "create" | "update";
      let variantsCreated = 0;
      let variantsUpdated = 0;
      let variantsDeleted = 0;

      if (!existing) {
        const created = await shopifyAdmin<{
          productCreate: { product: { id: string }; userErrors: { message: string }[] };
        }>(PRODUCT_CREATE, {
          input: {
            title: titleForKind,
            handle: handleForKind,
            productType: group.productType,
            status: "DRAFT",
            tags,
            descriptionHtml: "<p>Personlig design — skapas i editorn.</p>",
            productOptions: [
              {
                name: "Storlek",
                values: [...new Set(group.variants.map((v) => v.size))].map((name) => ({ name })),
              },
              {
                name: group.variantOptionName,
                values: [...new Set(group.variants.map((v) => v.variant))].map((name) => ({ name })),
              },
            ],
          },
        });
        if (created.productCreate.userErrors.length) {
          throw new Error(
            `productCreate userErrors: ${created.productCreate.userErrors
              .map((e) => e.message)
              .join("; ")}`,
          );
        }
        productId = created.productCreate.product.id;
        mode = "create";

        const inputs = group.variants.map((v) => buildVariantInput(group, v));
        const bulk = await shopifyAdmin<{
          productVariantsBulkCreate: {
            productVariants: { id: string }[];
            userErrors: { message: string; field?: string[] }[];
          };
        }>(PRODUCT_VARIANTS_BULK_CREATE, { productId, variants: inputs });
        if (bulk.productVariantsBulkCreate.userErrors.length) {
          // Hard-fail: previously these errors were swallowed silently and the
          // product ended up with zero / a single default variant.
          throw new Error(
            `bulkCreate userErrors: ${bulk.productVariantsBulkCreate.userErrors
              .map((e) => `${(e.field ?? []).join(".")} ${e.message}`)
              .join("; ")}`,
          );
        }
        variantsCreated = bulk.productVariantsBulkCreate.productVariants.length;
      } else {
        productId = existing.id;
        mode = "update";

        await shopifyAdmin(PRODUCT_UPDATE, {
          input: {
            id: productId,
            title: titleForKind,
            productType: group.productType,
            tags,
          },
        });

        // Sync option-values FIRST so missing sizes/frames/depths exist before
        // we try to add variants that reference them.
        await syncProductOptions(productId, existing, group);

        // Reconcile variants by SKU.
        const existingBySku = new Map(
          existing.variants.nodes.map((n) => [n.sku, n] as const),
        );
        const desiredSkus = new Set(group.variants.map((v) => v.sku));

        const toCreate: VariantInput[] = [];
        const toUpdate: (VariantInput & { id: string })[] = [];
        for (const v of group.variants) {
          const ex = existingBySku.get(v.sku);
          const input = buildVariantInput(group, v);
          if (ex) {
            toUpdate.push({ ...input, id: ex.id });
          } else {
            toCreate.push(input);
          }
        }
        const toDelete = existing.variants.nodes
          .filter((n) => n.sku && !desiredSkus.has(n.sku))
          .map((n) => n.id);

        if (toCreate.length) {
          const r = await shopifyAdmin<{
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
          const r = await shopifyAdmin<{
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
            await shopifyAdmin(PRODUCT_VARIANTS_BULK_DELETE, {
              productId,
              variantsIds: toDelete,
            });
            variantsDeleted = toDelete.length;
          }
        }
      }

      // Publish to Online Store sales channel (idempotent).
      const published = await publishToOnlineStore(productId);

      results.push({
        kind: group.kind,
        handle: handleForKind,
        productId,
        mode,
        plannedVariants: group.variants.length,
        variantsCreated,
        variantsUpdated,
        variantsDeleted,
        publishedToOnlineStore: published,
        skipped: group.skipped,
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
