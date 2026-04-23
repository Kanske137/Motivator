// Creates or updates a Shopify product to match a template stored in
// product_configs. Uses the Shopify Admin GraphQL API.
//
// Input: { handle: string }
// - handle = product_configs.shopify_handle
// - We create/update a Shopify product with the same handle.
// - Variants are the cartesian product of allowedSizes × (allowedFrames | allowedDepths)
//   for each enabled product type. SKU = Gelato UID (portrait orientation).
// - Prices come from the same tables used by the published Personlig Karta products.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import skuMap from "../_shared/gelato-sku-map.json" with { type: "json" };

const SHOPIFY_API_VERSION = "2025-07";
const DOMAIN = "canvas-poster-creator-2wh5d.myshopify.com";

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

function getShopifyToken(): string {
  // Prefer the user-bound online token Lovable's Shopify integration installs
  // (env var name pattern: SHOPIFY_ONLINE_ACCESS_TOKEN:user:<uid>).
  for (const [k, v] of Object.entries(Deno.env.toObject())) {
    if (k.startsWith("SHOPIFY_ONLINE_ACCESS_TOKEN") && v) return v;
  }
  const fallback = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (fallback) return fallback;
  throw new Error("No Shopify access token configured");
}

async function shopifyAdmin<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const TOKEN = getShopifyToken();
  const r = await fetch(`https://${DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await r.json();
  if (!r.ok || json.errors) {
    throw new Error(
      `Shopify API ${r.status}: ${JSON.stringify(json.errors ?? json).slice(0, 500)}`,
    );
  }
  return json.data as T;
}

interface VariantInput {
  optionValues: { optionName: string; name: string }[];
  price: string;
  sku: string;
  barcode: string;
  inventoryItem: { tracked: boolean };
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
      options { id name position values }
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

function buildVariantInput(
  group: PlannedGroup,
  v: PlannedVariant,
): VariantInput {
  return {
    optionValues: [
      { optionName: "Storlek", name: v.size },
      { optionName: group.variantOptionName, name: v.variant },
    ],
    price: v.price.toFixed(2),
    sku: v.sku,
    barcode: v.sku,
    inventoryItem: { tracked: false },
    inventoryPolicy: "CONTINUE",
  };
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: cfg, error } = await supabase
      .from("product_configs")
      .select("title,shopify_handle,template")
      .eq("shopify_handle", body.handle)
      .maybeSingle();
    if (error || !cfg) {
      return new Response(JSON.stringify({ error: "config not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Multi-product-type templates: we create one Shopify product per kind so
    // option-axes stay clean (Storlek+Ram for poster, Storlek+Djup for canvas).
    const results: any[] = [];
    for (const group of groups) {
      const handleForKind =
        groups.length === 1 ? cfg.shopify_handle : `${cfg.shopify_handle}-${group.kind}`;
      const titleForKind =
        groups.length === 1 ? cfg.title : `${cfg.title} – ${group.productType}`;

      const existing = (await shopifyAdmin<{
        productByHandle: null | {
          id: string;
          options: { id: string; name: string; values: string[] }[];
          variants: { nodes: { id: string; sku: string; selectedOptions: { name: string; value: string }[] }[] };
        };
      }>(GET_PRODUCT_BY_HANDLE, { handle: handleForKind })).productByHandle;

      let productId: string;
      let mode: "create" | "update";

      if (!existing) {
        const created = await shopifyAdmin<{
          productCreate: { product: { id: string }; userErrors: { message: string }[] };
        }>(PRODUCT_CREATE, {
          input: {
            title: titleForKind,
            handle: handleForKind,
            productType: group.productType,
            status: "DRAFT",
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

        // Bulk-create the variants.
        const inputs = group.variants.map((v) => buildVariantInput(group, v));
        const bulk = await shopifyAdmin<{
          productVariantsBulkCreate: {
            productVariants: { id: string }[];
            userErrors: { message: string }[];
          };
        }>(PRODUCT_VARIANTS_BULK_CREATE, { productId, variants: inputs });
        if (bulk.productVariantsBulkCreate.userErrors.length) {
          throw new Error(
            `bulkCreate userErrors: ${bulk.productVariantsBulkCreate.userErrors
              .map((e) => e.message)
              .join("; ")}`,
          );
        }
      } else {
        productId = existing.id;
        mode = "update";

        // Update title in case it changed.
        await shopifyAdmin(PRODUCT_UPDATE, {
          input: { id: productId, title: titleForKind, productType: group.productType },
        });

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
            productVariantsBulkCreate: { userErrors: { message: string }[] };
          }>(PRODUCT_VARIANTS_BULK_CREATE, { productId, variants: toCreate });
          if (r.productVariantsBulkCreate.userErrors.length) {
            console.error("bulkCreate errors", r.productVariantsBulkCreate.userErrors);
          }
        }
        if (toUpdate.length) {
          const r = await shopifyAdmin<{
            productVariantsBulkUpdate: { userErrors: { message: string }[] };
          }>(PRODUCT_VARIANTS_BULK_UPDATE, { productId, variants: toUpdate });
          if (r.productVariantsBulkUpdate.userErrors.length) {
            console.error("bulkUpdate errors", r.productVariantsBulkUpdate.userErrors);
          }
        }
        if (toDelete.length) {
          // Avoid deleting the last remaining variant (Shopify requires ≥1).
          const remaining = existing.variants.nodes.length - toDelete.length + toCreate.length;
          if (remaining >= 1) {
            await shopifyAdmin(PRODUCT_VARIANTS_BULK_DELETE, {
              productId,
              variantsIds: toDelete,
            });
          }
        }
      }

      results.push({
        kind: group.kind,
        handle: handleForKind,
        productId,
        mode,
        variants: group.variants.length,
        skipped: group.skipped,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, results, skipped: allSkipped }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("shopify-sync-template error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
