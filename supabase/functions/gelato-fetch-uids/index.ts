// Edge function: builds the FULL Gelato UID mapping for our 3 product types.
// Returns a clean JSON ready to use as Shopify variant SKUs.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GELATO_BASE = "https://product.gelatoapis.com/v3";

async function gelato(path: string, init?: RequestInit) {
  const key = Deno.env.get("GELATO_API_KEY");
  if (!key) throw new Error("GELATO_API_KEY missing");
  const res = await fetch(`${GELATO_BASE}${path}`, {
    ...init,
    headers: {
      "X-API-KEY": key,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch {}
  if (!res.ok) {
    throw new Error(`Gelato ${path} ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body as any;
}

async function searchProducts(catalogUid: string, attributeFilters: Record<string, string[]>) {
  // Gelato returns product UIDs in `hits.products` (or `products`) — collect them paginated.
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const data = await gelato(`/catalogs/${catalogUid}/products:search`, {
      method: "POST",
      body: JSON.stringify({ attributeFilters, limit: 100, offset }),
    });
    const products = data?.products ?? data?.hits?.products ?? [];
    all.push(...products);
    const total = data?.pagination?.total ?? products.length;
    offset += products.length;
    if (products.length === 0 || offset >= total) break;
    if (offset > 1000) break; // safety
  }
  return all;
}

// ---- Plan ----
// POSTERS (no frame): catalog "posters", paper 200-gsm-uncoated
//   sizes: 130x180, 210x300, 300x400, 400x500, 500x700, 700x1000  (mm)
//   = 6 sizes × 2 orientations = 12 UID
// MOUNTED FRAMED POSTERS: catalog "mounted-framed-posters", paper 200-gsm-uncoated, wood
//   FrameSize/PaperFormat:
//     130x180  (PaperFormat=130x180-mm)
//     210x297  (PaperFormat=A4)        <-- special!
//     300x400  (PaperFormat=300x400-mm)
//     400x500  (PaperFormat=400x500-mm)
//     500x700  (PaperFormat=500x700-mm)
//     700x1000 (PaperFormat=700x1000-mm)
//   colors: black, white, natural-wood, dark-wood
//   = 6 × 4 × 2 = 48 UID
// CANVAS: catalog "canvas", wood-fsc-2-cm + wood-fsc-4-cm
//   sizes: 200x250, 200x300, 300x400, 400x500, 400x600, 500x700, 600x800, 700x1000
//   = 8 × 2 × 2 = 32 UID
// TOTAL: 92 UID

const POSTER_SIZES_MM = [
  ["130x180-mm", "13x18"],
  ["210x300-mm", "21x30"],
  ["300x400-mm", "30x40"],
  ["400x500-mm", "40x50"],
  ["500x700-mm", "50x70"],
  ["700x1000-mm", "70x100"],
];

const FRAMED_SIZES = [
  // [FrameSize, PaperFormat, our-label]
  ["130x180-mm", "130x180-mm", "13x18"],
  ["210x297mm", "A4", "21x30"],
  ["300x400-mm", "300x400-mm", "30x40"],
  ["400x500-mm", "400x500-mm", "40x50"],
  ["500x700-mm", "500x700-mm", "50x70"],
  ["700x1000-mm", "700x1000-mm", "70x100"],
];

const FRAME_COLORS = [
  ["black", "Svart"],
  ["white", "Vit"],
  ["natural-wood", "Ek"],
  ["dark-wood", "Valnöt"],
];

const CANVAS_SIZES = [
  ["200x250-mm", "20x25"],
  ["200x300-mm", "20x30"],
  ["300x400-mm", "30x40"],
  ["400x500-mm", "40x50"],
  ["400x600-mm", "40x60"],
  ["500x700-mm", "50x70"],
  ["600x800-mm", "60x80"],
  ["700x1000-mm", "70x100"],
];

const CANVAS_DEPTHS = [
  ["wood-fsc-2-cm", "2cm"],
  ["wood-fsc-4-cm", "4cm"],
];

const ORIENTATIONS = [
  ["ver", "Portrait"],
  ["hor", "Landscape"],
];

function pickFirstUid(products: any[]): string | null {
  if (products.length === 0) return null;
  // each product has `productUid` in v3 search response
  return products[0].productUid ?? products[0].uid ?? null;
}

async function buildPosters() {
  const out: any[] = [];
  await Promise.all(
    POSTER_SIZES_MM.flatMap(([paperFormat, sizeLabel]) =>
      ORIENTATIONS.map(async ([orientGelato, orientLabel]) => {
        const hits = await searchProducts("posters", {
          PaperType: ["200-gsm-uncoated"],
          PaperFormat: [paperFormat],
          Orientation: [orientGelato],
          ProductStatus: ["activated"],
        });
        out.push({
          size: sizeLabel,
          frame: "Ingen",
          orientation: orientLabel,
          paperFormat,
          gelatoUid: pickFirstUid(hits),
          count: hits.length,
        });
      })
    )
  );
  return out;
}

async function buildFramed() {
  const out: any[] = [];
  await Promise.all(
    FRAMED_SIZES.flatMap(([frameSize, paperFormat, sizeLabel]) =>
      FRAME_COLORS.flatMap(([colorGelato, colorLabel]) =>
        ORIENTATIONS.map(async ([orientGelato, orientLabel]) => {
          const hits = await searchProducts("mounted-framed-posters", {
            PaperType: ["200-gsm-uncoated"],
            PaperFormat: [paperFormat],
            FrameSize: [frameSize],
            FrameMaterial: ["wood"],
            FrameColor: [colorGelato],
            Orientation: [orientGelato],
            ProductStatus: ["activated"],
          });
          out.push({
            size: sizeLabel,
            frame: colorLabel,
            orientation: orientLabel,
            frameSize,
            paperFormat,
            gelatoUid: pickFirstUid(hits),
            count: hits.length,
          });
        })
      )
    )
  );
  return out;
}

async function buildCanvas() {
  const out: any[] = [];
  await Promise.all(
    CANVAS_SIZES.flatMap(([canvasFormat, sizeLabel]) =>
      CANVAS_DEPTHS.flatMap(([depthGelato, depthLabel]) =>
        ORIENTATIONS.map(async ([orientGelato, orientLabel]) => {
          const hits = await searchProducts("canvas", {
            CanvasFormat: [canvasFormat],
            CanvasFrame: [depthGelato],
            Orientation: [orientGelato],
          });
          out.push({
            size: sizeLabel,
            depth: depthLabel,
            orientation: orientLabel,
            canvasFormat,
            gelatoUid: pickFirstUid(hits),
            count: hits.length,
          });
        })
      )
    )
  );
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "posters";

  try {
    if (action === "raw-search") {
      const data = await gelato(`/catalogs/posters/products:search`, {
        method: "POST",
        body: JSON.stringify({
          attributeFilters: {
            PaperType: ["200-gsm-uncoated"],
            PaperFormat: ["210x300-mm"],
            Orientation: ["ver"],
            ProductStatus: ["activated"],
          },
          limit: 5,
          offset: 0,
        }),
      });
      return new Response(JSON.stringify(data, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "posters") {
      const data = await buildPosters();
      return new Response(JSON.stringify({ posters: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (action === "framed") {
      const data = await buildFramed();
      return new Response(JSON.stringify({ framed: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (action === "canvas") {
      const data = await buildCanvas();
      return new Response(JSON.stringify({ canvas: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// rev-1776707278-5141
