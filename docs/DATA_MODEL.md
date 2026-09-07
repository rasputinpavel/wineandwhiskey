# Wine & Whiskey — Data Model

This document audits the **persistent data model** of the Store OS: every Supabase
table and view, how migrations are tracked and applied, which file-based JSON
stores exist alongside the database, how type-safe the DB↔code boundary is, and
the structural issues that will bite as the store grows.

> The two systems of record are **Loyverse** (POS) and **Flow Account**
> (accounting). Everything in the database below is either a **cache** of those
> two or **derived/operational** data. See `DATA_SOURCES.md` for the
> source-of-truth rules and `ARCHITECTURE.md` for how the services fit together.

There is **one shared Supabase project** for the internal services (mission-control,
price-service, trendwatch), accessed per-schema. The **storefront** (Lovable) and
its Loyverse-sync run on a *separate* Supabase project (`fqpnhcsidaxlclmvcawj`) and
are out of scope here except where the boundary matters.

---

## 1. Schemas overview

The internal Supabase project is split into custom Postgres schemas. Each must be
added to PostgREST "Exposed schemas" in Supabase settings or reads return 404
(noted inline in `mission-control/lib/supabase.ts`).

| Schema | Owner service | Purpose |
|--------|---------------|---------|
| `inventory` | mission-control | Core: SKU master, Loyverse stock/receipt mirrors, Flow invoice mirror, B2B customers, suppliers, consignment, sync log |
| `sales` | mission-control | Sales CRM — leads, scrape runs, activity log |
| `promo` | mission-control | Weekly promo campaigns (Promo Pulse) |
| `public` | shared / ad-hoc | `purchase_orders` + `purchase_order_items` (Loyverse-scraped), price-service tables (`suppliers`, `price_lists`, `wine_items`, `vivino_cache`…), and the dead `receipts`/`receipt_items` cache |
| (separate project) | barrymore bot | `tasks`, `daily_logs`, `chronicle`, `conversation_messages` — bot state, not store data |
| (separate project) | trendwatch | `trend_accounts`, `trend_reels`, `trend_frames`, `trend_analysis`, `trend_briefs`, `trend_our_reels` |

---

## 2. Tables & views — `inventory` schema (core)

Defined in `02_services/mission-control/supabase/migrations/`. "Written-by" /
"read-by" list the concrete producers/consumers.

| Object | Type | Purpose | Key columns | Written by | Read by |
|--------|------|---------|-------------|-----------|---------|
| `inventory.sku` | table | SKU master, one row per Loyverse variant; bridge key to Flow item codes | `loyverse_variant_id` (uniq), `loyverse_product_code`, `category`, `wine_color`/`grape_variety`/`wine_country` (mig 019) | `sync_inventory_loyverse.ts`, `lib/sync/loyverse.ts`; wine attrs by `seed_sku_wine_attrs` | `v_sku_breakdown`, inventory pages, wine-matrix |
| `inventory.loyverse_stock` | table | Latest qty per (sku, store); overwritten each sync | PK `(sku_id, store_id)`, `qty` | `sync_inventory_loyverse.ts`, `lib/sync/loyverse.ts` | `v_sku_breakdown` |
| `inventory.loyverse_customer` | table | Loyverse customer directory (UI picker) | PK `id` (Loyverse id text), `name`, `total_spent` | receipt sync | receipt FK, customer pickers |
| `inventory.loyverse_receipt` | table | **Canonical cached receipt mirror** (SALE+REFUND) with `is_b2b` precomputed; `b2b_manual` marks a row whose classification a person set by hand (sync carries it over instead of re-deriving) | `receipt_number` (uniq), `receipt_type`, `is_b2b`, `is_bank_transfer`, `total`, `cost_total`, `b2b_manual`, `b2b_customer_id` → `b2b_customer` | `sync_loyverse_receipts.ts` (`npm run inv:receipts`); `b2b_manual`/`b2b_customer_id` from the portal | `lib/dashboard.ts`, `pulse/page.tsx`, `m/customers/[id]` |
| `inventory.loyverse_receipt_line` | table | Per-SKU receipt detail | `receipt_id` (FK), `sku` (**text**, not FK), `qty`, `line_total`, `cost` | receipt sync | margin / SKU drill-downs |
| `inventory.b2b_customer` | table | B2B credit-terms registry; `group_id` (mig 010/011) | `flowaccount_name` (uniq), `payment_terms_days`, `credit_limit`, `is_consignment`, `group_id` | portal customer CRUD | customers pages, AR aging |
| `inventory.b2b_customer_group` | table | Parent grouping for B2B customers | `name` | portal | customers pages |
| `inventory.flowaccount_invoice` | table | Flow invoice mirror (AR/tax); `excluded` (mig 009) | `number` (uniq), `customer_id` (FK), `status`, `total`, `excluded` | `sync_accounting.ts` via `lib/flow.ts` | AR aging, `v_b2b_in_transit` |
| `inventory.flowaccount_invoice_line` | table | Invoice line detail; `sku_id` nullable = unmapped | `invoice_id` (FK), `sku_id` (FK, nullable), `qty`, `amount` | Flow sync | in-transit view, mapping admin |
| `inventory.flowaccount_receipt` | table | Flow payment-receipt mirror | `number` (uniq), `paid_at`, `loyverse_payment_id` | Flow sync | reconciliation |
| `inventory.flowaccount_receipt_invoice` | table | Receipt↔invoice M:N link | PK `(receipt_id, invoice_id)` | Flow sync | reconciliation |
| `inventory.supplier` | table | Supplier registry (promoted from `purchase_orders.supplier` free text) | `name` (uniq), `type` (regular/consignment/mix, mig 003), `payment_terms_days`, `monthly_cycle_start_day` (mig 020) | mig 002 seed + portal CRUD | Pulse cashflow, supplier reports |
| `inventory.consignment_location` | table | Consignment sites (e.g. Golden Brewery) | `customer_id` (uniq FK) | portal | consignment pages |
| `inventory.consignment_balance` | table | Qty on consignment per (location, sku) | PK `(location_id, sku_id)`, `qty` | portal / delivery notes | `v_sku_breakdown` |
| `inventory.consignment_price` | table | Per-(supplier, sku) wholesale cost for monthly true-up | `supplier_id` (FK), `sku_id` (FK), `price_hc`, uniq `(supplier_id, sku_id)` | portal | Pulse consignment liability |
| `inventory.delivery_note` | table | Consignment delivery notes | `number` (uniq), `status`, `location_id` (FK) | portal | Deliveries tab |
| `inventory.delivery_note_line` | table | Delivery-note line items | `note_id` (FK), `sku_id` (FK), `qty` | portal | Deliveries tab |
| `inventory.fixed_cost` | table | Fixed-cost model; `amount_thb` OR `percent_revenue` (mig 014/018) | `category`, `amount_thb`, `percent_revenue`, `active` | portal | Pulse, dashboard |
| `inventory.pulse_settings` | table | Single-row settings (`fixed_buffer_pct`, mig 018) | `id` (int), `fixed_buffer_pct` | portal | Pulse |
| `inventory.sync_log` | table | One row per sync attempt; UI shows MAX(finished_at) WHERE ok | `source`, `ok`, `finished_at`, `rows_in/out` | all sync scripts | `lastSync()` / DataFreshness bar |
| `inventory.v_b2b_in_transit` | view | Unpaid Flow invoice lines (status ∉ Paid/Cancelled) by sku/customer | — | (view) | `v_sku_breakdown`, in-transit reports |
| `inventory.v_sku_breakdown` | view | **Main inventory read path**: on_hand − b2b_in_transit − on_consignment = in_store | — | (view) | inventory pages |

### Tables & views — `sales` and `promo`

| Object | Purpose | Key columns |
|--------|---------|-------------|
| `sales.scrape_run` | B2B lead-scrape job runs | timestamps, status |
| `sales.lead` | Sales leads | name / contact fields |
| `sales.lead_activity` | Activity log per lead | `lead_id` FK |
| `promo.campaign` | Weekly promo campaigns (+ NBP prompt, mig 015) | campaign fields, `nbp_prompt` |

### Tables — `public` schema (shared / ad-hoc)

| Object | Purpose | Notes |
|--------|---------|-------|
| `public.purchase_orders` | Loyverse PO dashboard mirror (payables) | **No `create table` migration in the repo** — created ad-hoc; only `alter` migrations 007/008/009 add `exclude_from_cashflow`, `cashflow_override`, `paid_at`, `docs_url`. `supplier` is **free text**, no FK. |
| `public.purchase_order_items` | PO line items | Same — schema lives only in `lib/supabase.ts` types. `sku` is text. |
| `public.suppliers` | price-service supplier registry | **Separate table** from `inventory.supplier`; `slug`-keyed. Two unrelated "supplier" tables exist. |
| `public.price_lists`, `public.wine_items` | price-service PDF extraction + storefront Vivino feed | `wine_items` read by kiosk & storefront via name-normalization bridge to SKUs |
| `public.vivino_cache`, `vivino_jobs`, `vivino_job_items` | Vivino enrichment cache + job queue | served by price-service public API |
| `public.receipts`, `public.receipt_items` | **Dead** second receipt cache (written by `sync_receipts.ts`) | **No readers** — retire; `inventory.loyverse_receipt` is the single receipt cache |

---

## 3. Migrations

**Tooling:** none. There is **no Supabase CLI config** (`config.toml` absent), **no
migration runner**, and **no `schema_migrations` tracking table**. Every migration
file's header literally says *"Run in Supabase SQL editor."* Migrations are
hand-pasted into the dashboard. There is no programmatic record of which migrations
have been applied to the live database — applied state is tracked only in the
operator's head.

**Ordering:** files are numbered `001`–`020`, but the numbering is **not
monotonic and has collisions**:

- `014_fixed_cost.sql` and `014_promo_campaigns.sql` — duplicate `014`
- `015_consignment_price.sql` and `015_promo_nbp_prompt.sql` — duplicate `015`
- `016_consignment_report.sql` and `016_delivery_note_vat.sql` — duplicate `016`
- File mtimes are also out of order (e.g. `014_promo_campaigns` predates
  `014_fixed_cost`), so the numeric prefix does not reliably encode apply order.

Because the files are mostly idempotent (`create table if not exists`,
`add column if not exists`), the collisions are unlikely to corrupt state — but
they make "what's the next number" ambiguous and defeat any future automated
runner that keys on the prefix.

### Migration 020 status (the flagged item)

`020_supplier_billing_cycle.sql` adds
`inventory.supplier.monthly_cycle_start_day smallint not null default 1
check (… between 1 and 28)` and back-fills Harvest to `5`.

**Finding — the column IS used in code, contradicting the "not applied" memory
note as a code fact, but apply-state in the live DB cannot be verified from the
repo:**

- The column is read by:
  - `app/(portal)/m/suppliers/[id]/report/page.tsx:49,57`
  - `app/(portal)/m/suppliers/[id]/report/sales/page.tsx:39,47`
  - typed in `lib/supabase.ts:74` (`Supplier.monthly_cycle_start_day`)
- Both readers use `?? 1` (`Number(… ?? 1)`), so **if the migration were not
  applied, the Harvest Monthly Report would silently fall back to a calendar-month
  (day-1) window** instead of the correct 5th-to-5th cycle — no error, just wrong
  billing windows for the consignment supplier whose entire reason for existing
  is the 5th-to-5th cycle. PostgREST selecting a non-existent column would
  actually 400, but the `?? 1` shows the code was written defensively for the
  not-yet-applied case.
- The memory note ("migration 020 not applied") is plausibly stale relative to
  the most recent commits (`57f7b94 feat(harvest): Monthly Report on per-supplier
  billing cycle`), which ship the consuming UI. **Action: confirm in the live
  Supabase that `monthly_cycle_start_day` exists and Harvest = 5.** This is exactly
  the failure mode the lack of a migration-tracking table creates: nobody can
  answer "is it applied?" from the codebase.

---

## 4. File-based data stores (`09_data` / `08_config`)

### `09_data/`

| File | Content | Verdict |
|------|---------|---------|
| `sku_wine_match_report.json` | One-off **output report** of `seed_sku_wine_attrs` (counts by color, unmatched grape names) | Harmless artifact, not authoritative. The actual data lives in `inventory.sku.wine_*` (mig 019). Could move to `05_creative/output/` per folder rules; not a data-model risk. |

Note: despite `CLAUDE.md` describing `09_data/` as "Local data store: inventory,
sales, products, suppliers," **no operational inventory/sales/products/suppliers
JSON lives here** — that data is all in Supabase. The folder is effectively just
this report file.

### `08_config/`

| File | Content | Verdict |
|------|---------|---------|
| `b2b_overrides.json` | Per-receipt accounting overrides: `force_b2c_receipts`, `exclude_flow_receipts` | **Authoritative business data living in a file**, read by `sync_accounting.ts` (lines 297–495) and `lib/b2b_overrides.ts`. Correctly scoped to *accounting* (management tools keep the default classifier), but it is hand-edited override truth that affects the books and is not in the DB. |
| `po_exclude.json` | POs excluded from the Expenses tab | Same pattern — authoritative override read by `sync_accounting.ts:736`. Overlaps conceptually with the DB-native `purchase_orders.exclude_from_cashflow`/`cashflow_override` (mig 007/008): **two mechanisms for "exclude this PO,"** one file-based (accounting) and one DB-based (Pulse cashflow). |
| `manager_schedules/2026-04.json`, `2026-05.json` | Per-month manager roster, commission %, fixed pay, advances paid + `paid_log` | Authoritative payroll inputs, auto-generated by `build_manager_schedule.ts`, consumed by `sync_accounting.ts:862`. Month-partitioned files; reasonable as config, but the `paid`/`paid_log` is operational ledger data that arguably belongs in a table. |

**Hardcoded business constants that should live in `08_config`:** `DATA_SOURCES.md`
and `CROSS_CUTTING.md` already flag the biggest one — `B2B_PATTERNS` and
`BANK_TRANSFER_TYPE_ID` are hardcoded in `03_automation/lib/b2b.ts` (and drifted
copies in `mc/lib/customer_match.ts`), and the Google Sheet ID / tab schema are
hardcoded across the bot and ~10 automation scripts. These are cross-cutting
constants, not per-run config, and are the prime candidates for a single
`08_config` source (or a `settings` table) feeding all consumers.

---

## 5. Type-safety (DB ↔ code)

- **No generated types.** There is no `database.types.ts` from
  `supabase gen types`. All DB types are **hand-maintained** in
  `02_services/mission-control/lib/supabase.ts` as a parallel mirror of the SQL
  (the file's own comment: *"Mirror of inventory/supabase/migrations/001_inventory.sql"*).
  When a migration changes a column, the type must be updated by hand or it
  silently drifts.
- **Per-schema clients, no row typing.** `sbInventory`, `sbSales`, `sbPromo`,
  `sbPublic` are plain `createClient(...)` without the `Database` generic, so
  `.from('…').select()` returns `any` rows. Every consumer manually casts
  (`as Supplier`, `as PurchaseOrder[]`, `as SupRow[]`). There are ~39
  `as any` / `: any` annotations across `mission-control/app` + `lib`. A typo'd
  column name or a stale type compiles fine and fails at runtime (or silently
  reads `undefined`).
- **`public.purchase_orders` types exist only in `lib/supabase.ts`** — the table
  has no `create table` migration, so the TS type *is* the only written schema
  definition for it. If the scraped DDL and the type disagree, nothing catches it.
- The bots and automation scripts have their own local Supabase clients
  (`01_agents/*/`, `03_automation/`) with no shared types at all — consistent with
  the repo-wide "no shared internal package" finding.

---

## 6. Scalability assessment

What scales fine:
- The **receipt cache design** (`loyverse_receipt` + `_line`, `is_b2b` computed
  once at ingest, indexed on `customer_id`, `receipt_date desc`, partial index on
  `is_b2b`) is sound. Precomputing `is_b2b` once and reading it everywhere is the
  right call and will hold up with more receipts. The only scaling caveat is that
  `loyverse_stock` is overwrite-only (no history) — acceptable today, but trend
  analysis will eventually want snapshots (the schema comment anticipates this).
- `v_sku_breakdown` is a simple 3-way `LEFT JOIN` over grouped sums; fine at
  current SKU counts (~2,900). At much larger catalogs it may warrant a
  materialized view, but it is not a near-term concern.
- UUID PKs and proper FKs throughout the `inventory` schema (sku→stock,
  invoice→lines, location→balance) are clean and normalized.

Weak links that **will** bite as channels/SKUs/customers grow:

1. **PO → supplier join is a normalized-name string, not a FK** (the known weak
   link). `purchase_orders.supplier` is free text; `pulse/page.tsx:188` builds
   `supByName = Map(s.name.trim().toLowerCase())` and `termsFor()`/`includedInCashflow()`
   default to `payment_terms_days = 0` and `type = 'regular'` on any miss
   (`pulse/page.tsx:192–194, 205`). A rename or typo in Loyverse silently
   mis-dates a payment or **fails to exclude a consignment supplier**, double-counting
   cash with **no error surfaced**. The same fragile match identifies the Harvest
   consignment supplier for settlement (`pulse/page.tsx:248`). More suppliers →
   more name variants → more silent misses.

2. **Two unrelated "supplier" tables.** `inventory.supplier` (mission-control,
   `name`-keyed, has terms/type/cycle) and `public.suppliers` (price-service,
   `slug`-keyed) model the same real-world entity with no link. Anything that
   needs both price-list data and payment terms for one supplier has to bridge by
   name again.

3. **SKU bridge is text, not a key.** `loyverse_receipt_line.sku` and
   `purchase_order_items.sku` are plain text expected to match
   `inventory.sku.loyverse_product_code` (itself nullable, with only a non-unique
   index). The inventory↔`wine_items` (Vivino) bridge is hand-rolled name
   normalization duplicated in `kiosk/lib/wines.ts` and `wine-matrix/queries.ts`.
   No referential integrity guarantees the joins resolve.

4. **`flowaccount_invoice.customer_id` and `b2b_customer` matching** rely on
   `flowaccount_name` text matching, with `customer_id` nullable — unmatched
   invoices fall out of customer-scoped aggregates silently.

5. **No migration tracking / hand-maintained types** (sections 3 & 5) is a
   process-scalability risk: more migrations and more developers without an
   `applied` ledger or generated types increases the odds of "is it applied?"
   ambiguity and type drift.

---

## 7. Data-model issues

| # | Severity | Issue | Detail | Files | Recommendation |
|---|----------|-------|--------|-------|----------------|
| 1 | **Critical** | PO→supplier join by name string, not FK | Miss silently defaults `payment_terms_days=0` / `type='regular'`; an unmatched **consignment** supplier is not excluded → cash double-counted in Pulse P&L with no error | `app/(portal)/m/pulse/page.tsx:188,192-194,205,248`; `purchase_orders.supplier` (free text, no `create table` migration) | Add `purchase_orders.supplier_id` FK (or a name→id resolution table); surface unmatched POs in the UI instead of defaulting silently |
| 2 | **High** | No migration tracking / runner | No `schema_migrations` table, no Supabase CLI config, "run in SQL editor" by hand → cannot verify from code whether any migration (incl. **020**) is applied; mig 020's `?? 1` fallback means a missing column silently gives wrong Harvest billing windows | all `supabase/migrations/*.sql`; `020_supplier_billing_cycle.sql`; `suppliers/[id]/report/page.tsx:57` | Adopt Supabase CLI migrations (tracking table) or a tiny runner; **verify 020 applied in prod** (`monthly_cycle_start_day` exists, Harvest=5) |
| 3 | **High** | No generated DB types; hand-mirrored, untyped reads | `lib/supabase.ts` is a hand-maintained mirror; clients lack the `Database` generic so rows are `any` with ~39 manual casts → column drift compiles clean, fails at runtime | `lib/supabase.ts`; ~39 `as any`/cast sites across `mission-control/app`+`lib` | Run `supabase gen types typescript`, type the clients with `Database`, delete the hand-mirror |
| 4 | **High** | `purchase_orders`/`purchase_order_items` have no schema migration | The Loyverse-payables tables (central to Pulse) exist only as ad-hoc DDL + a TS type; no `create table` is version-controlled, so prod schema is undocumented and unreproducible | only `alter` migs 007/008/009; type in `lib/supabase.ts:30-62` | Add a `create table` migration capturing the real columns; bring these into the `inventory` (or a dedicated) schema |
| 5 | **Medium** | Duplicate migration numbers | `014/015/016` each appear twice; file mtimes out of order → ambiguous "next number," breaks any prefix-keyed runner | `014_*`, `015_*`, `016_*` in `mission-control/supabase/migrations/` | Renumber to a strict monotonic sequence as part of adopting a runner |
| 6 | **Medium** | Two unrelated "supplier" tables | `inventory.supplier` (terms/type/cycle, name-keyed) vs `public.suppliers` (price-service, slug-keyed) model one entity with no link | `migrations/002_supplier.sql`; `price-service/supabase/001_price_service.sql` | Pick one canonical supplier table or add a cross-reference key |
| 7 | **Medium** | Override truth split across file + DB | "Exclude this PO" exists as both `08_config/po_exclude.json` (accounting) and `purchase_orders.exclude_from_cashflow`/`cashflow_override` (Pulse) → two mechanisms, easy to set one and not the other | `08_config/po_exclude.json`; `migrations/007/008`; `sync_accounting.ts:736` | Consolidate onto the DB columns; have accounting read them too |
| 8 | **Medium** | Authoritative accounting data in hand-edited JSON | `b2b_overrides.json` (force_b2c / exclude_flow) and `manager_schedules/*.json` (advances, `paid_log`) are books-affecting truth living in files, not the DB | `08_config/b2b_overrides.json`, `08_config/manager_schedules/*.json`; `sync_accounting.ts:297-495,862` | Acceptable as config short-term; long-term move ledger-like data (advances, overrides) into tables with an audit trail |
| 9 | **Medium** | SKU joins are loose text, not keys | receipt/PO line `sku` (text) → nullable `sku.loyverse_product_code` (non-unique index); Vivino bridge is duplicated name-normalization | `migrations/012` (`receipt_line.sku`); `lib/supabase.ts` (`PurchaseOrderItem.sku`); `kiosk/lib/wines.ts`, `wine-matrix/queries.ts` | Make `loyverse_product_code` unique-keyed; add a persistent SKU↔wine_items join view |
| 10 | **Low** | Dead duplicate receipt cache | `public.receipts`/`receipt_items` (written by `sync_receipts.ts`) has no readers — stale duplicate that still costs an API pull | `03_automation/sync_receipts.ts`; `public.receipts` | Drop the tables and retire the script |
| 11 | **Low** | `09_data/` misfiled output artifact | `sku_wine_match_report.json` is a run report, not a data store; folder is otherwise empty of the inventory/sales data `CLAUDE.md` describes | `09_data/sku_wine_match_report.json` | Move to `05_creative/output/` (dated) or `.gitignore` it |

---

## Maintaining this document

When you add or change a table/view: add the row to section 2/3, state who writes
and reads it, and confirm it traces to Loyverse or Flow per `DATA_SOURCES.md`.
When you add a migration: keep the number strictly monotonic, and if you change a
column, update both the SQL and the hand-mirror in `lib/supabase.ts` (until
generated types replace it).
