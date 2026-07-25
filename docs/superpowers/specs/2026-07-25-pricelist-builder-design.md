# Price List Builder — Marketing service

**Date:** 2026-07-25
**Status:** Design approved, ready for implementation plan
**Origin:** A hand-made price-list design (see `.inbox/WhatsApp Image 2026-07-25 at 10.49.05.jpeg`)
that we want to reproduce reliably and let the store generate on demand.

## 1. Goal

A native page in the mission-control portal, under **Marketing → Price Lists**, where a
user assembles a branded price list from store products and exports it as **PNG pages (A4)
plus a multi-page PDF** for WhatsApp / print. The visual language is fixed by a brand
guideline so every generated list looks like the approved reference.

Two deliverables:

1. **Brand guideline** `04_brand/price-list.md` — the canon: card anatomy, the colour-plaque
   zone system, the 2-up grid, typography, VAT footer. This is the source of truth the
   renderer implements.
2. **Portal service** — the builder page, its data model, and the render pipeline.

The earlier idea of a standalone Claude skill is **dropped** in favour of this portal
service.

## 2. Reference design (what we are reproducing)

From the approved image:

- **Header band:** QR + "PLACE AN ORDER / СДЕЛАТЬ ЗАКАЗ" + WhatsApp contact on the left;
  large **WINE & WHISKEY** wordmark on the right.
- **Two cards per row.** Left column white wines, right column red — but that pairing is a
  *consequence* of the grouping, not a hard rule (see §5, row layouts).
- **Card anatomy:** vertical colour **plaque** on the left edge (WHITE / RED) → bottle photo
  → wine name (1–2 lines, bold uppercase) → 🌍 country/region and 🍇 grape rows → large price
  on the right with a `.-` suffix.
- **Footer:** `7% VAT NOT INCLUDED`, centred.

## 3. Architecture

```
Marketing → Price Lists  (app/(portal)/m/pricelist/)
├── page.tsx                     server: auth gate, load saved lists + catalog
├── PricelistBuilderClient.tsx   client: 3-pane builder + live preview
│
├── sources
│   ├── inventory picker  ← GET  /api/m/pricelist/catalog     (inventory.v_sku_breakdown)
│   ├── CSV/Excel upload   → POST /api/m/pricelist/import      (xlsx parse → rows)
│   └── manual row         (client-only, no fetch)
│
├── persistence
│   ├── GET/POST/PUT /api/m/pricelist/lists    (marketing.price_lists)
│   └── enrichment      /api/m/pricelist/enrichment (marketing.sku_enrichment)
│
└── render
    └── POST /api/m/pricelist/render → PNG pages + PDF (Buffers → download)
        reuses the puppeteer machinery pattern from lib/promo/render.ts
        HTML built by new lib/pricelist/{template.ts, layout.ts}
```

**Registry / navigation:** add one `Item` to the `marketing` section in
`lib/registry.ts` (after the `storefront`/`trendwatch` items), `embed: { kind: 'native' }`,
`slug: 'pricelist'`. Access is granted to anyone whose `allowed` contains the section key
`marketing` — no permission-schema change (`lib/auth.ts` `hasAccess`).

## 4. Data model

### 4.1 Sources of a line item

A price-list line is a plain object; where each field comes from:

| Field | inventory picker | CSV/Excel | manual |
|---|---|---|---|
| `name` | `sku.name` | column | typed |
| `price` | `sku.default_price` | column | typed |
| `color` (plaque) | `wine_color` | column `type`/`color` | chosen |
| `grape` | `grape_variety` | column | typed |
| `country` | `wine_country` | column | typed |
| `region` | **enrichment** (not in DB) | column | typed |
| `producer` | **enrichment** | column | typed |
| `volume` | **enrichment** | column | typed |
| `image` | `04_brand/products/<code>.png` | optional URL/upload | optional |
| `code` | `loyverse_product_code` | — | — |

`wine_color` values in the DB: `red | white | rose | sparkling | orange`. `orange` maps to
the WHITE plaque family unless overridden (rare enough to not warrant its own plaque in v1).

### 4.2 Enrichment (fills the inventory gaps)

`inventory.v_sku_breakdown` has no `region`, `producer`, or `volume` — but the reference
design shows them. These are stored once and reused:

```sql
-- marketing.sku_enrichment
loyverse_product_code  text primary key
region                 text
producer               text
volume                 text          -- e.g. '750ml', '2000ml'
updated_at             timestamptz default now()
```

When a picked inventory item is edited, its region/producer/volume are upserted here.
Next time the same product is picked, the values prefill. Over time the gaps shrink.

### 4.3 Saved lists

```sql
-- marketing.price_lists
id           uuid primary key default gen_random_uuid()
title        text not null
grouping     text not null default 'manual'   -- producer|type|region|tier|grape|manual
items        jsonb not null                    -- ordered array of line objects (incl. row-layout overrides)
settings     jsonb not null default '{}'       -- header contact, VAT note, plaque overrides
created_at   timestamptz default now()
updated_at   timestamptz default now()
```

Migration **035** (`035_marketing_pricelist.sql`) creates schema `marketing` + both tables.
Applied manually in the Supabase SQL Editor (per repo convention — the service key is
PostgREST, not DDL). RLS on, service-role-only access (mirrors `portal.users`).

**Client access:** add a `sbMarketing` helper to `lib/supabase.ts` alongside the existing
`sbInventory`/`sbPublic`/`sbPortal` clients (same service-role key, `db: { schema: 'marketing' }`).
The `marketing` schema must be exposed to PostgREST in Supabase (Settings → API → Exposed
schemas) — a one-time manual step called out in the migration header comment.

## 5. Layout engine (`lib/pricelist/layout.ts`)

Base principle: **two cards per row.** A rendered page is a list of *rows*, each one of:

- `pair` — two cards (default)
- `solo-wide` — one full-width card (a lone item in a group, or a deliberate premium accent)
- `divider` — a group heading band (e.g. `RUSSIA · KUBAN`, `SPARKLING`)

**Grouping** (page setting): `producer | type | region | tier | grape | curated | manual`.
The engine takes the ordered item list + grouping and emits rows:

1. Partition items into groups by the grouping key (`manual`/`curated` = keep user order,
   no auto-partition).
2. Optionally emit a `divider` per group (toggle; off reproduces the reference, which has
   no dividers).
3. Within a group, pack items into `pair` rows; a trailing odd item becomes `solo-wide`
   (default) — or, if the user sets "tight", stays a half-width card alone on the left.
4. Any item may carry a manual `rowLayout` override that wins over the auto packing.

**Tier grouping** buckets by price thresholds (config: e.g. `< 600`, `600–1000`, `> 1000`);
thresholds live in `settings` so they are adjustable per list.

**Pagination:** ~14 cards per A4 page (matching the reference density). The engine flows rows
onto pages, never splitting a `divider` from the row that follows it.

## 6. Plaque system (brand tokens)

Extends the reference's white/red zones to the full range, using existing brand tokens where
possible:

| Zone | Colour | Token |
|---|---|---|
| WHITE | muted amber-gold | `amber-gold #C9A84C` |
| RED | wine red | `wine-red #8C1C1C` |
| SPARKLING | gold + bubble texture (distinct from WHITE) | `amber-gold` + pattern |
| ROSÉ | dusty rose (**new token** `rose-dust #C98C8C`) | new |
| SPIRITS | graphite / whisky-brown (echoes "& WHISKEY") | `graphite #3D3D3D` |

**Open sub-decision, resolved visually, not on paper:** SPARKLING risks blending into the
gold WHITE plaque in a warm palette. At first render, produce a small swatch comparison
(WHITE vs two SPARKLING candidates: "gold + bubbles" and a cool mint accent) and let the
user pick the live one. This does not block the spec.

The new `rose-dust` token is added to `04_brand/design-tokens.json` and the tailwind theme.

## 7. Typography (brand)

- Prices: **Bebas Neue** (`font-display`), the heavy condensed display face, with `.-` suffix.
- Wine names: **DM Sans** bold, uppercase (`font-heading`).
- Meta rows (country/region, grape) and footer: **Inter** (`font-sans`).

Google Fonts loaded in the render HTML; the renderer awaits `document.fonts.ready` before
screenshotting (same guard as `lib/promo/render.ts:114-116`).

## 8. Render pipeline (`lib/pricelist/` + `/api/m/pricelist/render`)

Reuses the promo pattern:

- `launchBrowser()` — system Chrome via `PUPPETEER_EXECUTABLE_PATH` on dev, `@sparticuz/chromium`
  on Railway (copy the helper shape from `lib/promo/render.ts:66-82`).
- Product images resolved to data URLs by scanning `public/brand/products/` and one level of
  subdirs, top-level slug wins (reuse the `buildProductPathMap`/`loadProductDataUrls` approach,
  `render.ts:29-63`). CSV/manual items with no matching slug render a bottle-silhouette
  placeholder.
- `lib/pricelist/template.ts` `buildHtml({ pages, settings })` → full HTML document
  (header band, rows of cards, VAT footer), A4 page dimensions.
- For each A4 page: `page.setViewport(A4)`, `setContent`, `fonts.ready`, `screenshot(png)`.
- Assemble the per-page PNGs into one PDF with **`pdf-lib`** (already a dependency) — one A4
  page per PNG. Return `{ pngs: Buffer[], pdf: Buffer }`.

**Output delivery:** the API returns the buffers; the client offers them as downloads
(`<title>.pdf` + numbered PNGs). Because Railway's filesystem is ephemeral and not the repo,
we do **not** write to `05_creative/output/` from production — archiving to the repo is a
manual step the user does locally if they want it. (Optional future: persist exports to a
Supabase storage bucket for a "recent exports" gallery, like trendwatch — not in v1.)

## 9. CSV/Excel import (`/api/m/pricelist/import`)

- Parse with `xlsx` (already a dependency).
- Expected headers (case-insensitive, fuzzy-matched): `name, price, type, country, region,
  grape, producer, volume, image`. `type` accepts `white/red/sparkling/rose/spirits` (and
  common synonyms → plaque zone).
- Return parsed rows + a mapping report (which columns matched, which rows are missing a
  price/name) shown as a preview before the user commits them into the working list.
- A downloadable template file documents the expected columns.

## 10. Component boundaries

Each unit has one job and a defined interface:

- `lib/pricelist/types.ts` — `LineItem`, `RowLayout`, `PageSettings`, `PriceListDoc`.
- `lib/pricelist/layout.ts` — pure: `(items, grouping, settings) → Page[]` (rows). Unit-testable
  with no DOM/DB. This is where the pairing/odd-item/divider/pagination logic lives.
- `lib/pricelist/template.ts` — pure: `(pages, settings) → html string`. No DB, no puppeteer.
- `lib/pricelist/render.ts` — impure: HTML → PNG/PDF buffers (puppeteer + pdf-lib).
- `lib/pricelist/catalog.ts` — reads `inventory.v_sku_breakdown` + joins `sku_enrichment`.
- API routes — thin: validate, call the lib, return.
- `PricelistBuilderClient.tsx` — UI state + live preview (renders the same `template.ts`
  output in an iframe/scaled div for WYSIWYG).

The layout engine and template being **pure and DB-free** is deliberate: they are the parts
most likely to need iteration to match the reference pixel-for-pixel, and they must be
testable and previewable without a browser or Supabase.

## 11. Testing

- **Unit (layout engine):** odd item → `solo-wide`; even → all `pair`; each grouping key
  partitions correctly; tier thresholds bucket correctly; manual `rowLayout` override wins;
  pagination never orphans a `divider` from its following row.
- **Unit (import):** header fuzzy-matching; missing-price/name rows flagged; type→plaque
  synonym mapping.
- **Snapshot (template):** `buildHtml` for a fixed 2-item and 3-item (odd) doc produces stable
  HTML.
- **Manual visual check:** first real render of the reference product set is eyeballed against
  the wife's image (including the SPARKLING swatch pick).

## 12. Explicitly out of scope (YAGNI)

- Fuzzy-joining to the supplier catalog (`public.wine_items`) for region/producer — enrichment
  table handles gaps instead.
- Auto-publishing anywhere (WhatsApp/Telegram/Meta). Export is manual download.
- A storefront-facing public price list. This is an internal marketing tool.
- The standalone Claude skill (superseded by this portal page).

## 13. Migration & rollout notes

- Migration `035_marketing_pricelist.sql` is applied manually by the user in the Supabase SQL
  Editor (repo convention — I only write the SQL).
- Deploys to Railway automatically on push to `main` (mission-control convention).
- New `rose-dust` brand token added to `04_brand/design-tokens.json`, `lib/brand-tokens.json`,
  and the tailwind theme so it is available both in the brand doc and the renderer.
