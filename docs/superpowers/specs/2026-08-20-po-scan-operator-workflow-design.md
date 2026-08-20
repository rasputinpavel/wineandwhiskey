# PO Scan — Operator Workflow (status + Loyverse PO link)

**Date:** 2026-08-20
**Area:** `02_services/mission-control` portal — `/m/purchase-orders` (Operations), backed by `public.po_scans`.
**Status:** Approved design, ready for implementation plan.

## Problem

Today the Chip&Dale bot recognizes a supplier PO/invoice photo and writes a header-only
row into `public.po_scans` (supplier, doc number, order date, total). The portal page
`/m/purchase-orders` lists these rows with sorting, month grouping, inline header edit,
and a free-text note. There is no notion of an operator review pass: every scan is just
archived. The operator has no way to mark which scans are still draft, which are waiting
on a corrected invoice from the supplier, and which are approved and already entered as a
Purchase Order in Loyverse.

This iteration turns `/m/purchase-orders` into the operator's working desk: a review
workflow with statuses plus a place to record the link/number of the Loyverse PO created
by hand from the approved document.

## Scope

**In scope**

- Add `status` and `loyverse_po` columns to `public.po_scans` (migration 038).
- Portal: status badge + inline status switcher, inline Loyverse-PO field, status filter
  (with a quick "Drafts" preset).
- Extend the existing `PATCH /api/m/purchase-orders` whitelist.

**Explicitly out of scope (deferred)**

- Line-item extraction by the bot and structured per-line storage.
- Expandable rows / copy-line-items UX.
- Any "Create Purchase Order" button that materializes a PO in Loyverse.
  Rationale: the Loyverse public REST API does not expose Purchase Orders (they are part
  of the paid Advanced Inventory module). The operator creates the PO by hand in Loyverse
  and pastes back the link/number. This is a deliberate convenience-first design, not an
  automated integration.

## Data model — migration 038

Add two columns to `public.po_scans`:

| Column        | Type                                                                 | Meaning                                              |
|---------------|----------------------------------------------------------------------|------------------------------------------------------|
| `status`      | `text` NOT NULL DEFAULT `'draft'`, CHECK IN (`draft`,`needs_corrections`,`approved`) | Manual-review stage.                                 |
| `loyverse_po` | `text` (nullable)                                                    | Link **or** number of the PO created in Loyverse.    |

- **Values:** `draft` (bot default, unreviewed), `needs_corrections` (waiting on a
  corrected invoice from the supplier), `approved` (reviewed; PO created in Loyverse).
- **Default for new rows:** `draft`, applied by the DB default (bot inserts do not set it).
- **Backfill of existing rows:** the migration one-time UPDATEs all existing rows to
  `approved`. Existing rows are the historical processed archive; leaving them `draft`
  would flood the operator's review queue with hundreds of already-handled documents.
- **Index:** add `create index on public.po_scans (status)` to keep the status filter cheap.

The migration is applied manually by the user in the Supabase SQL Editor (project
convention — the service key is PostgREST, not DDL). This spec only authors the SQL.

## Bot — no change required

`commitPO()` in `01_agents/bot/src/po.ts` needs no modification:

- **Insert path:** the record object never lists `status`, so the DB default `'draft'`
  applies to every new scan.
- **Overwrite path (same `doc_number`):** the update object already excludes `status`
  (same as it excludes `note`), so an operator-set status is preserved when the supplier
  sends a corrected scan.

This settles the "Need corrections" flow: **same row for the document's lifetime.** A
corrected invoice with the same `doc_number` overwrites the header fields and scan file
while preserving the operator's status; the operator re-reviews and flips the status.
(A corrected invoice that arrives under a *new* doc number naturally creates a new draft
row — the operator archives the stale one; no special handling needed.)

## Portal `/m/purchase-orders`

### Status column

- New sortable **Status** column rendering a colored badge:
  `draft` = grey, `needs_corrections` ("Need corrections") = amber, `approved` = green.
- Inline status switcher: a self-contained cell component (modeled on the existing
  independent `NoteCell` at `components/modules/po/NoteCell.tsx`) with a 3-value dropdown.
  Changing status does **not** require entering full row-edit mode; it PATCHes on select.

### Loyverse PO column

- New **Loyverse PO** column: a self-contained inline text editor (also modeled on
  `NoteCell`).
- Rendering: if the value starts with `http`, render as a clickable link (opens in a new
  tab); otherwise render the raw text (a PO number).

### Filter

- Add a **status filter** dropdown to the existing search + month filter bar
  (`All` / `Drafts` / `Need corrections` / `Approved`). Default `All`.
- A quick **"Drafts"** preset so the operator sees their review queue in one click.
- The status filter composes with the existing `q` search and month filter.

### Interaction with existing UI

- The existing ✎ full-row editor (supplier / doc_number / order_date / amount) is
  unchanged. Status and Loyverse-PO are edited through their own independent cells so a
  full-row edit never clobbers them and vice versa — the same pattern already used for the
  note.

## API — `PATCH /api/m/purchase-orders`

Extend the existing PATCH handler (`app/api/m/purchase-orders/route.ts`); no new routes.

- Add `status` to the accepted fields, validated against the enum
  `{draft, needs_corrections, approved}` — reject anything else with 400.
- Add `loyverse_po` to the text fields (empty string coerces to `null`, as the other text
  fields do).
- All existing whitelisted fields and behavior are unchanged.

## Types & registry

- Extend the `PoScan` type in `lib/supabase.ts` with `status` and `loyverse_po`.
- Registry entry (`lib/registry.ts`) may flip `status: 'building'` → `'live'` once shipped
  (cosmetic; optional).

## Testing

- **API validation (logic worth a test):** PATCH accepts each of the three valid status
  values; PATCH rejects an unknown status with 400; `loyverse_po` empty string → `null`.
- **Migration:** verify default `draft` on a fresh insert and the one-time backfill sets
  existing rows to `approved` (checked manually in Supabase after applying).
- **UI:** manual smoke — status badge colors, dropdown PATCHes, Loyverse-PO link renders
  for `http…` values, status filter + "Drafts" preset compose with search/month.

## Rollout

1. Author migration 038; user applies it manually in Supabase.
2. Ship portal + API changes; deploy is automatic on push to `main` (Railway).
3. Existing rows are already `approved`; new bot scans arrive as `draft` into the queue.
