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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "build-mapping";

  try {
    if (action === "raw-search") {
      // Debug: see raw structure of one search to confirm productUid shape
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

    if (action === "build-mapping") {
      const result: any = { posters: [], framed: [], canvas: [], errors: [] };

      // POSTERS
      for (const [paperFormat, sizeLabel] of POSTER_SIZES_MM) {
        for (const [orientGelato, orientLabel] of ORIENTATIONS) {
          try {
            const hits = await searchProducts("posters", {
              PaperType: ["200-gsm-uncoated"],
              PaperFormat: [paperFormat],
              Orientation: [orientGelato],
              ProductStatus: ["activated"],
            });
            const uid = pickFirstUid(hits);
            result.posters.push({
              size: sizeLabel,
              frame: "Ingen",
              orientation: orientLabel,
              paperFormat,
              gelatoUid: uid,
              count: hits.length,
            });
          } catch (e) {
            result.errors.push({ kind: "poster", sizeLabel, orientLabel, err: String(e) });
          }
        }
      }

      // FRAMED
      for (const [frameSize, paperFormat, sizeLabel] of FRAMED_SIZES) {
        for (const [colorGelato, colorLabel] of FRAME_COLORS) {
          for (const [orientGelato, orientLabel] of ORIENTATIONS) {
            try {
              const hits = await searchProducts("mounted-framed-posters", {
                PaperType: ["200-gsm-uncoated"],
                PaperFormat: [paperFormat],
                FrameSize: [frameSize],
                FrameMaterial: ["wood"],
                FrameColor: [colorGelato],
                Orientation: [orientGelato],
                ProductStatus: ["activated"],
              });
              const uid = pickFirstUid(hits);
              result.framed.push({
                size: sizeLabel,
                frame: colorLabel,
                orientation: orientLabel,
                frameSize,
                paperFormat,
                gelatoUid: uid,
                count: hits.length,
              });
            } catch (e) {
              result.errors.push({ kind: "framed", sizeLabel, colorLabel, orientLabel, err: String(e) });
            }
          }
        }
      }

      // CANVAS
      for (const [canvasFormat, sizeLabel] of CANVAS_SIZES) {
        for (const [depthGelato, depthLabel] of CANVAS_DEPTHS) {
          for (const [orientGelato, orientLabel] of ORIENTATIONS) {
            try {
              const hits = await searchProducts("canvas", {
                CanvasFormat: [canvasFormat],
                CanvasFrame: [depthGelato],
                Orientation: [orientGelato],
              });
              const uid = pickFirstUid(hits);
              result.canvas.push({
                size: sizeLabel,
                depth: depthLabel,
                orientation: orientLabel,
                canvasFormat,
                gelatoUid: uid,
                count: hits.length,
              });
            } catch (e) {
              result.errors.push({ kind: "canvas", sizeLabel, depthLabel, orientLabel, err: String(e) });
            }
          }
        }
      }

      // Summary
      result.summary = {
        posters: result.posters.length,
        postersWithUid: result.posters.filter((p: any) => p.gelatoUid).length,
        framed: result.framed.length,
        framedWithUid: result.framed.filter((p: any) => p.gelatoUid).length,
        canvas: result.canvas.length,
        canvasWithUid: result.canvas.filter((p: any) => p.gelatoUid).length,
        errors: result.errors.length,
      };

      return new Response(JSON.stringify(result), {
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
