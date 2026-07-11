# Catalog Update / Reconciliation — Design

**Date:** 2026-07-11
**Status:** Approved design, pre-implementation
**Trigger:** Harvest sent a new price-list PDF (`HC NEW CATALOG JULY 2026 Ph.pdf`). We need to update the existing parsed catalog instead of creating duplicate entries. No catalog-update function exists yet.

## Problem

The price-list subsystem can only **insert**: each uploaded PDF creates a new `price_lists` row and a fresh batch of `wine_items`. Re-uploading a supplier's updated price list produces a second, near-duplicate set of items with no reconciliation. There is no way to detect price changes, new products, or discontinued products across two catalogs of the same supplier.

This design adds a **reconciliation layer** between "parsed new PDF" and "the supplier's current `wine_items`", with a human-reviewed diff before any mutation.

## Scope & decisions (locked)

- **Target store:** `public.wine_items` in the price-service Supabase project (`arbturzdpqvulsqwqpbd`) — the browsable price-list catalog. **Not** `inventory.consignment_price` (settlement costs) and **not** the hardcoded `/russian-wine` landing page (`app/russian-wine/data.ts`).
- **Flow:** parse → compute diff → **human review (approve/skip per change)** → apply. Not auto-apply.
- **Discontinued items** (present in old catalog, absent from new PDF): **mark `status='discontinued'`, keep the row.** Not deleted.
- **Generic:** works for any supplier's price-list re-upload, not Harvest-specific. The PDF parser is already generic (~18 suppliers).

## Non-goals (YAGNI)

- No full price-history table / per-import snapshots (approach C rejected). The stored `catalog_updates.diff` is the permanent changelog.
- No changes to the `/russian-wine` festival landing (separate hardcoded curation) or to consignment settlement.
- No new parser work — reuse the existing extraction pipeline.

## Architecture

Reconciliation lives in **mission-control** (where the portal API routes and `lib/price/*` already live), reading/writing the price-service Supabase via `lib/price/supabase.ts`. New module: `lib/price/reconcile.ts` (pure diff logic, no I/O — testable in isolation).

### Trigger

On PDF upload, if the resolved supplier **already has active `wine_items`** → reconciliation path. Otherwise → existing direct-insert path (unchanged behavior for first-time suppliers and the other ~18 suppliers' normal uploads).

## Data model (migration `010` in `02_services/price-service/supabase/`)

Applied manually by the user in the Supabase SQL Editor of the **price-service** project (`arbturzdpqvulsqwqpbd`), per the repo's manual-migration convention.

**`wine_items` — new columns:**
- `status text not null default 'active' check (status in ('active','discontinued'))`
- `match_key text` — normalized `name|volume` (year stripped); reconciliation key. Indexed `(supplier_id, match_key)` for active rows.
- `discontinued_at timestamptz null`

Existing `price_list_id` is reused: on apply, a matched row's `price_list_id` is repointed to the new price list ("which upload last confirmed this item's price"). New rows get the new list's id.

**`price_lists` — status:** extend the CHECK to include `'review'`:
`check (status in ('pending','processing','review','done','error'))`.

**New table `catalog_updates`** — one row per reconciliation run; the diff record and permanent changelog:

```sql
create table if not exists catalog_updates (
  id                 uuid default gen_random_uuid() primary key,
  supplier_id        uuid references suppliers(id) on delete set null,
  new_price_list_id  uuid references price_lists(id) on delete cascade,
  status             text not null default 'pending_review'
                       check (status in ('pending_review','applied','discarded')),
  diff               jsonb not null,   -- full computed diff incl. new-item payloads
  created_at         timestamptz default now(),
  applied_at         timestamptz
);
```

No staging table for parsed items: the parsed "new" payloads are embedded in `diff`, so apply is self-contained and deterministic.

## Data flow

1. **Upload** — same entry as today (`POST /api/m/price/price-lists` with `{ path, filename, mimeType, kind }`). A `price_lists` row is created.
2. **Detect** — resolve supplier; if it has active `wine_items`, take the reconciliation path.
3. **Parse** — run the existing extractor. **Nothing is written to `wine_items`.**
4. **Diff** — `reconcile.ts` compares parsed items against the supplier's active `wine_items`. Persist to `catalog_updates` (`pending_review`); set `price_lists.status='review'`.
5. **Review** — portal screen; user approves/skips each change and resolves ambiguous matches.
6. **Apply** — `POST /api/m/price/updates/[id]/apply` mutates `wine_items`, sets `catalog_updates.status='applied'` + `applied_at`, `price_lists.status='done'`.

First-time supplier (no active items) keeps the current direct-insert path untouched.

## Matching & diff

**Normalization** (shared helper, used both when writing `match_key` and when diffing):
- lowercase; strip punctuation & diacritics; collapse whitespace
- **drop year tokens** (a vintage change 2016→2020 is an update of the same product line, not discontinue+add)
- canonicalize volume: `750ml` / `0.75L` / `750 ml` → `750`; `187ml` → `187`; `200ml` → `200`
- `match_key = normalizedName + '|' + canonicalVolume`

**Matching:**
1. Exact `match_key` equality against active items → matched 1:1.
2. Unmatched new items → trigram fuzzy match against remaining unmatched active items above a threshold → surfaced as **ambiguous** (not auto-applied).
3. Still unmatched new → **added**.
4. Active items with no match → **discontinued** candidates.
5. A currently-`discontinued` item that reappears in the new PDF → **reactivation**.

**Diff categories** (per item, in `diff.jsonb`):
- `added` — new item (full payload)
- `price_changed` — matched, price differs (old → new)
- `updated` — matched, non-price attrs changed (ABV, description/notes, grape, region, year, wine_type)
- `unchanged` — matched, identical (collapsed in UI, not shown by default)
- `discontinued` — active item absent from new PDF
- `reactivated` — discontinued item present again in new PDF
- `ambiguous` — fuzzy-only match; needs a human pick

## Review screen

New section under the price-list module: `/m/price/updates/[id]`.
- Groups by category with counts; `unchanged` collapsed.
- Each row: accept/skip toggle.
- `ambiguous` rows: dropdown to bind to a specific existing item **or** mark as new.
- Actions: **Apply** (with the user's per-row decisions) / **Discard** (sets `catalog_updates.status='discarded'`, `price_lists.status='error'` or a terminal state; no mutation).

The price-list list view shows lists in `review` status with a badge linking to their update screen.

## Apply semantics

`POST /api/m/price/updates/[id]/apply` receives the (possibly edited) decisions and, for each accepted change:
- **matched (price_changed/updated) accepted** → `UPDATE wine_items` row: price, ABV, description, volume, grape, region, year, wine_type; set `price_list_id` = new list. **`id` and Vivino enrichment fields are preserved.**
- **added accepted** → `INSERT wine_items` (`status='active'`, `price_list_id` = new list, `match_key` computed).
- **discontinued accepted** → `UPDATE status='discontinued'`, `discontinued_at=now()`.
- **reactivated accepted** → `UPDATE status='active'`, `discontinued_at=null`, plus any changed fields.
- **skipped** → no-op.

**Vivino staleness:** if a matched row's name or year changed, reset its `vivino_status` (and related enrichment-gating field) so the existing Vivino tick job re-enriches it.

## Error handling & edge cases

- **Parse failure** → no mutation; `price_lists.status='error'` with `error_message`; no `catalog_updates` apply.
- **Concurrency** → at most one `pending_review` `catalog_updates` per supplier; a second upload for the same supplier while one is open is blocked with a clear message.
- **Apply idempotency** → mark changes applied as they succeed so a partial failure (no cross-row transaction under PostgREST) can be safely re-run to completion. Optionally wrap in a Postgres function later for atomicity; not required for v1.
- **Ambiguous left unresolved** → cannot Apply until every ambiguous row is resolved (bind or mark-new).

## Testing

- **Unit** (`reconcile.ts`, pure):
  - normalization / `match_key` (year stripping, volume canonicalization, diacritics)
  - matcher: exact + fuzzy thresholds, year-agnostic vintage change stays a single match
  - diff computation: every category incl. reactivation and ambiguous
- **Integration:** given an "old" active set + a parsed "new" set → expected diff; then apply the decisions → expected `wine_items` end state (updated / inserted / discontinued / reactivated), Vivino fields preserved on matched rows.
- **Golden fixture:** the real previously-parsed Harvest catalog vs. the new `HC NEW CATALOG JULY 2026 Ph.pdf` parse — asserts realistic added/price_changed/discontinued counts.

## Open questions

None blocking. The Postgres-function atomic-apply is an optional later hardening.
