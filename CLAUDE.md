# CLAUDE.md — Motiv(ator)

Project context for Claude Code. Read this at the start of every session.

## What this project is

Motiv is a **multi-tenant Shopify app** — an AI-driven product customizer that any
merchant can install to let their customers personalize products (photo, AI photo,
text, map, shape layers) with a live preview, generate print-ready files, and
auto-fulfill through a print-on-demand provider.

This repo was **imported from the single-tenant "Arthena" app** (`artful-create-studio`).
Roughly 70–80% of the machinery already exists here (template system, layer + locks
model, drag-drop designer, customer editor, Shopify OAuth + template sync + order
webhooks, Gelato POD, Replicate AI, i18n). The work is to **generalize it for many
merchants**, not to rebuild it.

## Hard isolation rule (do not break)

Arthena is a **separate, live** app with its own repo, Supabase project, Shopify
Partner app, and Lovable project. All of that must stay untouched.

- This repo must point at **its own** new Supabase project — never Arthena's.
- Motiv gets its **own** Shopify Partner app with its own OAuth credentials — never
  Arthena's app keys.
- Never commit secrets. `.env` must be in `.gitignore` (add it if missing).

## Stack

- Vite + React 18 + TypeScript, Tailwind + Radix (shadcn/ui)
- Supabase: Postgres + RLS, Edge Functions (Deno), Storage
- State: Zustand (`src/stores`), data: TanStack React Query
- Editor: dnd-kit + react-rnd; 3D preview: three / react-three-fiber
- Maps: mapbox-gl + leaflet; i18n: react-i18next (SV/EN)
- Package manager: **bun**

## Commands

- `bun install` — install deps
- `bun run dev` — local dev server (Vite)
- `bun run build` — production build
- `bun test` — unit tests (vitest)
- Migrations via Supabase CLI: `supabase link` (to the new project), then
  `supabase db push` to apply local migrations in `supabase/migrations/`.

## Current data model (single-tenant today)

- `product_configs` — the template. Key column `template` (JSONB) already holds
  `orientations`, per-orientation `defaultLayout` (aspect, background, `layers[]`),
  `productOptions` (allowedSizes / allowedFrames / allowedDepths), `sizeOverrides`.
  Layer types: `map`, `text`, `photo`, `aiPhoto`, `shape`, plus admin-only `line` /
  `margin`. Each layer carries a `locks` object (position, size, …) = the
  customer-permission model. Also holds Shopify metadata (status, tags, seo, etc.),
  `template_slug`, `enabled_product_types`.
- `gelato_orders` — POD order + fulfillment/tracking state.
- `shopify_app_installations` — per-shop `access_token` + `scopes` (already
  multi-shop at the OAuth layer). Server-only (service_role).
- `shopify_sync_state` — links a `product_config` to its synced Shopify product.
- Storage buckets: `print-files`, `cart-previews`, `mockup-cache`, `ai-references`.

Edge functions: `gelato-*` (POD), `replicate-style` / `replicate-face-swap` /
`multi-face-swap` (AI), `shopify-oauth-*` / `shopify-sync-template` /
`shopify-storefront` / `shopify-order-webhook` / `shopify-delete-template`,
`generate-print-file`, `get-mapbox-token`.

## Security / tenancy model (decided — implement this way)

The single most important refactor. Today content tables have no tenant column and
RLS is wide open (policies literally say "TODO admin auth"). Fix:

1. **Tenant scoping.** Add `installation_id uuid` (FK → `shopify_app_installations`)
   to every content table: `product_configs`, `shopify_sync_state`, `gelato_orders`.
   Change `product_configs.shopify_handle` from globally unique to
   `UNIQUE (installation_id, shopify_handle)`.
2. **RLS locked down.** No direct client writes to content tables. Allow only the
   public reads the storefront genuinely needs (published templates). Deny the rest.
3. **Auth via Shopify session tokens.** Admin/designer never writes to the DB from
   the browser. It calls an edge function passing the Shopify **session token** (App
   Bridge). The function verifies the token signature with the app secret, derives
   the shop / `installation_id`, and only then writes using **service_role**, scoped
   to that `installation_id` — so it can never touch another shop's rows.
4. **Key hygiene.** `service_role` lives only server-side (edge functions). The
   browser holds only the Supabase **publishable/anon** key. Sensitive tables
   (`shopify_app_installations`, `gelato_orders`) stay service-role-only.

## Provider abstraction (POD)

Today POD is Gelato-only (`gelato_sku_map`, `gelato_orders`, `gelato-*`,
`generate-print-file`). Generalize to a `PodProvider` interface with Gelato as the
first adapter, then Printful / Printify:

- `getProductCatalog()` / import product bases (sizes, print area).
- `getPrintSpec(sku)` → `{ format, dpiTarget, bleedMm, safeAreaMm, colorProfile,
  widthPx, heightPx }`. `generate-print-file` reads this — it must produce the right
  file per provider, not assume Gelato.
- `submitOrder(design, address)` and `parseFulfillmentWebhook()`.
- **Mockup/frame fidelity per provider + variant.** Current frames are
  Lovable-generated approximations that don't match the real products (esp. Oak).
  Prefer provider mockup-generator APIs (Printful/Printify) where available; else a
  curated library of accurate frame overlays from real product photos. Keyed to
  `provider + SKU`.

## AI key + cost model

AI currently uses Arthena's own Replicate key server-side, unmetered. For SaaS:

- **BYO key (default):** merchant supplies their AI provider key → their cost, zero
  risk to us.
- **Managed (optional):** we hold the key, base fee includes a free generation quota,
  overage metered. Count generations and emit to Shopify App Events API.
- Keep pre-purchase cost down: watermarked/low-res previews, generate high-res
  print file only on order, rate-limit per session, cache (already have client caches).

## Billing

Not built yet. Use **Shopify App Pricing** (App Events API), combined model:
per-order core fee + AI generation metering. Merchant sees charges in Shopify admin.

## Generalization guardrails

- Preserve existing behavior and feature breadth while generalizing; don't strip
  features, don't add many new providers at once (launch Gelato + one).
- Map / Mapbox and curated-AI face-swap are Arthena-specific — treat as optional
  "advanced" layers behind sensible defaults + starter templates. Clarify whether
  `get-mapbox-token` is shared or must be per-tenant.
- Setup simplicity is the core wedge — every admin flow should aim to be self-serve
  without a support call.

## Phase plan

1. **Fork/import + new env** — (done: repo imported, new Supabase project created).
   Finish: swap `.env` to the new Supabase project, add `.env` to `.gitignore`, apply
   existing migrations to the new project, verify the app boots.
2. **Tenant scoping + RLS** — the migration in the security section above, plus the
   edge-function session-token auth guard. Decide what to do with the two seed
   `product_configs` (map poster/canvas): attach to a demo installation or remove.
3. **Provider abstraction** — `PodProvider` interface; refactor Gelato behind it;
   print spec per SKU; mockup fidelity; add a second provider.
4. **AI key + metering** — provider-key abstraction (BYO + managed), generation
   counting.
5. **App Pricing** — plans + usage meters (per-order + AI).
6. **Onboarding** — connect POD, connect/choose AI, import product bases, starter
   templates.

## Immediate next task

Phase 1 finish → Phase 2 start. Begin with the `.env` swap and applying existing
migrations to the new Supabase, confirm boot, then write and apply the Phase 2
migration (`installation_id` + `UNIQUE(installation_id, shopify_handle)` + RLS
lockdown) and the edge-function auth guard.
