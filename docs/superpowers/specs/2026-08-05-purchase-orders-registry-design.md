# Purchase Orders Registry — Design

**Date:** 2026-08-05
**Status:** Approved design, pending spec review → implementation plan

## Problem

When a supplier delivers goods, a paper purchase order (PO) arrives with the shipment.
The store needs a searchable archive of scanned POs so that when a supplier later asks
"which invoice was this payment against?" or raises a dispute, the scan can be retrieved
in seconds. The **paper original goes to bookkeeping**; the scan is the store's own copy.

Previously a manager (Som) scanned each PO and logged it into a Google Sheet by hand.
Som has left. Managers still scan but no longer log anything. We are replacing the manual
logging with an automated pipeline driven by the Chip & Dale Telegram bot.

## Goal

- Manager sends a photo of a PO into the Chip & Dale Telegram chat.
- Bot recognizes it is a supplier PO (not an expense receipt), extracts the key fields,
  shows a confirmation card, and on confirmation:
  - stores the scan in Supabase Storage,
  - writes a row into a `purchase_orders` table,
- A portal page lets anyone find a PO by supplier / number / date and open its scan.

## Non-goals

- No payment status / payment-calendar linkage. This is a **document archive**, not a ledger.
- No connection to existing PO cost data (X/P codes, purchase prices). Kept separate.
- Not full e-commerce or accounting — retrieval of scanned documents only.

## Storage decision

Registry rows **and** scans live in the **same Supabase** the portal (mission-control)
and Alan already share. Rationale:

- The bot already has a Supabase client (`tools.ts`, gated on `SUPABASE_URL` +
  `SUPABASE_SERVICE_KEY`) used for stock queries — the write path already exists.
- The project is deliberately migrating **off** Google Sheets into the portal/Supabase.
- Row + scan + "find this PO" all live in one place; no Google Drive service-account
  wiring needed for the bot on Railway.

(Note: the bot also already has a Google service account — it writes expenses to a Google
Sheet via JWT — so a Drive variant was feasible, but Supabase is cleaner and chosen.)

## Data model

Column mapping from Som's original Google Sheet:

| Som's column     | Our field         | Notes |
|------------------|-------------------|-------|
| Purchase No.     | `doc_number`      | № PO / invoice — dedup + search key |
| Date of order    | `order_date`      | Date printed on the document |
| Supplier         | `supplier`        | Normalized name |
| Date received    | `received_date`   | Delivery date; defaults to **today**, editable |
| Total            | `amount_total`    | Amount incl. VAT (฿) |
| Original receipt | *(scan itself)*   | Was a link to the scan → replaced by `scan_path` |
| Remark           | `note`            | Free text |

Table `purchase_orders` (schema TBD in plan — `public` or `finance`), migration applied
manually by the user in the Supabase SQL Editor (per project convention):

| field          | type        | notes |
|----------------|-------------|-------|
| `id`           | uuid pk     | |
| `supplier`     | text        | normalized (Harvest, Cigar Empire, …) |
| `supplier_raw` | text        | as written on the document (for new/unknown suppliers) |
| `doc_number`   | text        | Purchase No.; dedup key |
| `order_date`   | date        | Date of order |
| `received_date`| date        | defaults to today, editable |
| `amount_total` | numeric     | Total (฿) |
| `scan_path`    | text        | path in Supabase Storage bucket |
| `note`         | text null   | Remark |
| `uploaded_by`  | text        | Telegram name of the manager |
| `created_at`   | timestamptz | upload time |

Scans go in a **private** Storage bucket `po-scans`; the portal serves them via signed URL.

## Bot logic

New module `01_agents/bot/src/po.ts`:

- `classifyPhoto(image)` — Claude vision decides: supplier PO vs expense receipt.
- `extractPO(image)` — returns `{ supplier, order_date, doc_number, amount_total }`.
- Write path: upload scan to Storage + insert row.

Flow & safeguards:

1. Photo arrives → bot classifies. **Auto-detection**, but every result is confirmed by
   the user, never written blind.
2. Confirmation card shows the recognized type and fields, with buttons:
   `[✅ Записать] [✏️ Исправить] [↔️ Это расход]`. If misclassified, `↔️ Это расход`
   hands the photo to the existing expense flow — this covers the classification-error risk.
3. Supplier normalization: match `supplier_raw` against the known suppliers list (from the
   `suppliers` table) so "Harvest" / "harvest co ltd" / "харвест" collapse to one name.
4. Dedup: if `doc_number` already exists → "Такой PO уже в реестре от <date>, перезаписать?".

Integration point: the existing `message:photo` handler in `index.ts` currently routes all
photos to the expense flow. It will first run PO classification and branch.

## Portal page

**Finance ▸ Purchase Orders** in mission-control:

- Table: supplier, doc number, order date, received date, total, scan link.
- Search by supplier and by doc number; date-range filter.
- Click a row / scan link → opens the scan (signed URL).

Serves the core scenario: supplier asks → retrieve scan in seconds.

## Manual setup (outside code)

- Apply migration `NNN_purchase_orders.sql` in Supabase SQL Editor.
- Create private Storage bucket `po-scans`.
- Confirm the bot on Railway has `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (add if missing).

## Open items

- None blocking. Field set finalized against Som's sheet.
