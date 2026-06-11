# Wine Insights — design

**Date:** 2026-06-11
**Service:** `02_services/mission-control`
**Route:** `/m/wine` (portal menu item: **Wine Insights**)
**Status:** approved design, ready for implementation plan

## Goal

A native portal section that turns the one-off Google-Sheets wine analysis
(`03_automation/identify_bestsellers.ts`, `inventory_segmentation.ts`) into a
live, always-fresh section with two equally important jobs:

1. **Popularity** — what people actually buy: top sellers, month-over-month
   movers, breakdown by grape variety and by country.
2. **Reorder** — what to order now: popular wines whose stock is running out,
   surfaced *before* they hit zero, with a suggested order quantity.

Scope is **wine only** (`inventory.sku.wine_color is not null`). Spirits/whisky
are out of scope for this section.

## Decisions (from brainstorm)

- **Both tabs equal weight** — two tabs under one route: Popularity | Reorder.
- **Comparison basis** — velocity from a rolling ~90-day window; trend =
  current month vs the same month one year ago (YoY removes seasonality;
  15+ months of Loyverse receipts make this possible).
- **Coverage** — wine only.
- **Metadata gap** — backfill `grape_variety` / `wine_country` on
  `inventory.sku` as a prerequisite step before launch.
- **Data architecture (Approach A)** — live SQL views over
  `loyverse_receipt_line` + `sku`, read from server components. No snapshot
  tables; trends computed on the fly from 15 months of receipts. Matches the
  existing `wine-matrix` / `dashboard` pattern, zero new pipeline, always fresh.
- **Movers/trend noise floor** — minimum 3 bottles per period to count.
- **Reorder horizon** — `target_weeks_of_stock = 4`.
- **Menu label** — "Wine Insights" (distinct from "Wine Matrix").
- **Out of v1 (YAGNI):** monthly Telegram auto-digest, price tiers, writing
  "order N" into real POs, Vivino rating as a popularity axis.

## Architecture

Approach A — live views + server components, mirroring `wine-matrix`/`dashboard`.

```
/m/wine/page.tsx  (server component, ?tab=popularity|reorder)
   └─ lib/wine.ts   (pure helpers over view rows: velocity, days_of_cover,
                     segmentation, "order N", YoY delta — unit-tested)
        └─ Supabase client → inventory.v_wine_sales, inventory.v_wine_reorder
```

No client-side fetching. Thresholds live as constants in `lib/wine.ts` with the
same defaults as the existing automation scripts; not exposed as UI settings.

## Prerequisite: metadata backfill

Script `03_automation/backfill_wine_attrs.ts`:

- Select SKUs where `wine_color is not null` and (`grape_variety` or
  `wine_country` is empty).
- Match to `price-service.wine_items` (which has `country`, `region`,
  `grape_variety`, plus Vivino) by `loyverse_product_code` (primary key),
  falling back to name match.
- Write matches with `wine_attrs_source = 'auto'`. **Auto never overwrites
  `manual`.**
- Unmatched rows export to `09_data/wine_attrs_gaps.csv` for manual fill; a
  second pass loads the filled file as `source = 'manual'`.
- Target: close coverage for wine that is in stock; the no-stock/no-sales tail
  does not matter.

## Data model — views (new migration, next number 030)

### `inventory.v_wine_sales`

Receipt-line sales for wine, enriched with SKU attributes.

- **Source:** `loyverse_receipt_line` ⋈ `loyverse_receipt` (date, type, b2b) ⋈
  `sku`. Only `receipt_type = 'SALE'`; refunds subtracted.
- **Grain:** `sku_id, period (YYYY-MM), wine_color, grape_variety, wine_country`.
- **Aggregates:** `qty, revenue, cost, margin, b2c_qty, b2b_qty, checks`.
- Filter: `wine_color is not null`.

### `inventory.v_wine_reorder`

Current per-SKU reorder state.

- **Source:** `v_sku_breakdown` (for `in_store` stock) + a 90-day velocity
  computed from `loyverse_receipt_line`.
- **Columns:** `sku_id, name, wine_color, grape_variety, wine_country,
  in_store, velocity_per_week (90d), days_of_cover, last_sale_date,
  is_bestseller, segment`.
- `days_of_cover = in_store / daily_velocity`.
- `segment` per existing A–E thresholds (see Reorder tab).

No snapshot tables. Monthly series and YoY come from `v_wine_sales`.

## Tab 1 — Popularity

Default tab. Period picker (30 / 90 / 180 days, default 90). All from
`v_wine_sales`. Branded portal cards; English UI.

- **Top sellers** — table: wine, bottles/period, revenue, margin %, B2B share,
  YoY trend arrow (%). Sort by bottles or revenue. Top 20 + "show all".
- **Movers** — two columns: Rising ↑ and Falling ↓ by YoY bottle delta, with a
  noise floor of **≥ 3 bottles** in both windows.
- **By grape** — horizontal bars: grape → bottles + revenue for the period, with
  a trend arrow. Click a grape → filters Top sellers below. **Unclassified**
  bucket always shown + a "coverage 87%" badge.
- **By country** — same as By grape, keyed on `wine_country`.

Price tiers are intentionally excluded from v1.

## Tab 2 — Reorder

Same route, second tab. Source `v_wine_reorder`. Ports
`inventory_segmentation.ts` logic into a live UI plus "days to zero".

Main table, sorted by urgency (`days_of_cover` ascending):

| Wine | Stock (in_store) | Velocity (btl/wk, 90d) | Days to zero | Last sale | Segment | Order |

- **Segments (existing A–E thresholds):** 🔴 **A** — demand exists, cover
  < 2 weeks → urgent; 🟡 **C** — medium demand, hold ~4 weeks; ⚪ **D/E** —
  tail/stale, sell down (shown as a separate collapsed group, not mixed with
  alerts).
- **Order N** suggestion: `ceil(target_weeks_of_stock (4) × velocity − in_store)`.
  A hint number only; no PO write.
- **Top KPI tiles:** "🔴 N positions urgent", "total bottles to reorder",
  "🟡 M approaching".
- **Default focus = bestsellers** (velocity ≥ 3 btl/month, sold in ≥ 50% of
  weeks, a sale within 30 days). Toggle "show all wines" removes the filter.
- Velocity window fixed at 90 days (more stable than the popularity picker).

## Navigation & UI

- New portal menu item **Wine Insights** alongside Dashboard / Wine Matrix /
  Pulse. Route `/m/wine`, two tabs via `?tab=` (default `popularity`).
- Server components calling `lib/wine.ts` helpers (`getWineSales()`,
  `getMovers()`, `getReorder()`) over the shared Supabase client.
- Branded portal cards, English UI. Reuse Vivino bottle images from
  `wine-matrix` where available.
- Kept separate from `wine-matrix` (which is *stock on shelves*): Wine Insights
  is *what sells / what to reorder*. Each Reorder row links to the same SKU in
  Wine Matrix.

## Components & boundaries

| Unit | Purpose | Depends on |
|---|---|---|
| `03_automation/backfill_wine_attrs.ts` | Fill grape/country on `sku` | `price-service.wine_items`, Loyverse |
| migration `030_wine_views.sql` | `v_wine_sales`, `v_wine_reorder` | `loyverse_receipt*`, `sku`, `v_sku_breakdown` |
| `lib/wine.ts` | Pure helpers: velocity, days_of_cover, segment, order N, YoY | view rows only |
| `app/(portal)/m/wine/page.tsx` | Server-rendered tabs | `lib/wine.ts`, Supabase client |

## Testing

- `lib/wine.ts` is pure functions over plain rows — unit-test velocity,
  `days_of_cover`, segmentation boundaries (A/C/D/E), "order N" rounding, and
  YoY delta with the ≥3-bottle noise floor, including empty/edge inputs.
- Backfill script: dry-run mode that reports match/unmatched counts without
  writing.

## Migrations

Manual — user applies `030_wine_views.sql` in the Supabase SQL Editor (next
number after 029). See memory: migrations are manual.

## Explicitly out of scope (v1)

Monthly Telegram/Barrymore auto-digest, price tiers, writing "Order N" into real
POs, Vivino rating as a popularity axis. Each is an additive later step that
does not require reworking this section.
