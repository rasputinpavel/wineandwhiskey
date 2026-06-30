# Cigar Empire — retail-minus consignment

**Date:** 2026-06-30
**Status:** Approved (design), pending implementation plan
**Author:** Pavel + Claude

## Problem

A new consignment supplier — **Cigar Empire Company Limited** (cigars) — settles on
economics that the current consignment engine does not support.

The existing engine (built for Harvest) computes the monthly settlement as a
**cost-plus** number: `sold × HC + 7% VAT`, where `HC` is the supplier's wholesale
cost per unit. Cigar Empire works the other way around: their price list gives the
**net retail price** per cigar, and we pay them that price **less a discount**, with
VAT added. We need a second settlement mode without disturbing Harvest.

### The Cigar Empire economics (verified against their delivery note TDN-20260600009)

For a cigar listed at net price `P`:

- **Customer pays (retail):** `P × 1.07`
- **We pay Cigar Empire (per sold unit):** `P × (1 − 0.30) × 1.07`
- **Our income (per sold unit):** `P × 1.07 × 0.30`

The 30% discount and the 7% VAT commute, so the order does not change the result.
We store it the way their official document presents it: **discount applied to the
net price first, then 7% VAT on top** (`Pre-VAT` column = `qty × P × (1 − disc)`,
VAT applied to the summed total).

Worked example from the delivery note (qty 5 each, discount 30%):

| Cigar | Code | Net price P | Pre-VAT (qty×P×0.70) |
|-------|------|-------------|----------------------|
| Lauk Daun | BR-LDE | 690 | 2,415 |
| My Lockdown | BR-MYLO | 560 | 1,960 |
| Airlangga Grand Corona | BR-ALGC | 480 | 1,680 |
| Joker Robusto | DNT-JRO | 490 | 1,715 |
| Joker Connecticut | DNT-JCNT | 490 | 1,715 |
| Ernesto S4 | TM-ERS4 | 400 | 1,400 |

Net subtotal 10,885 → VAT 7% = 761.95 → total 11,646.95. (Delivery note is page
1/2; remaining SKUs to be added when page 2 is supplied. This total is the **value
of the consignment stock handed over**, NOT a settlement amount — we pay only for
units sold during a billing cycle.)

- **Billing cycle:** 5th-to-5th (same as Harvest), so costs land in the right month.
- **Discount:** uniform 30% for Cigar Empire, but the model must allow a per-SKU
  override for future suppliers who price differently per line.

## Approach

Add a per-supplier **`settlement_mode`** with two values:

- `cost_plus` (default, = current Harvest behaviour): `amount = sold × price × 1.07`
- `retail_minus` (Cigar Empire): `amount = sold × price × (1 − disc) × 1.07`

The base price column (`consignment_price.price_hc`) is reused as "per-unit base
price": it holds the wholesale `HC` in `cost_plus` mode and the **net list price** in
`retail_minus` mode. The discount lives on the supplier as a default, overridable per
SKU. The settlement engine already applies the 7% VAT globally at the total level, so
the only math change is a discount factor on each line's pre-VAT `amount`.

This was chosen over two rejected alternatives:

- **Derive settlement from POS revenue** (`revenue × (1 − disc)`, no stored prices) —
  rejected: any manual/promo discount at the till would silently reduce the supplier
  payment and diverge from how Harvest works. Settlement must be anchored to the
  agreed list price, not the actual sell price.
- **Reuse `price_hc` as `P × 0.70`** (store the post-discount cost, zero code change) —
  rejected: loses the original list price and the visible discount, requires manual
  recomputation when the price list changes, and makes the report misleading.

## Data model changes (migration 030, applied manually in Supabase SQL Editor)

`inventory.supplier`:
- `settlement_mode TEXT NOT NULL DEFAULT 'cost_plus'`, `CHECK (settlement_mode IN ('cost_plus','retail_minus'))`
- `consignment_discount_pct NUMERIC NOT NULL DEFAULT 0` — percentage (e.g. `30`), used in `retail_minus` mode.

`inventory.consignment_price`:
- `discount_pct NUMERIC NULL` — optional per-SKU discount override. `NULL` → fall back
  to the supplier default. (Unused by Cigar Empire; present for future suppliers.)

Seed Cigar Empire in the same migration (consignment suppliers are not
auto-registered from POs, so insert explicitly; the name must match the Loyverse
supplier name for future settlement-PO matching):

```sql
insert into inventory.supplier (name, type, settlement_mode, consignment_discount_pct, monthly_cycle_start_day, notes)
values ('Cigar Empire Company Limited', 'consignment', 'retail_minus', 30, 5,
        'Cigars on consignment. Net price list; pay P×0.70×1.07 per sold unit. 5th-to-5th cycle.')
on conflict (name) do update
  set type = excluded.type,
      settlement_mode = excluded.settlement_mode,
      consignment_discount_pct = excluded.consignment_discount_pct,
      monthly_cycle_start_day = excluded.monthly_cycle_start_day;
```

## Settlement engine — `lib/consignment-settlement.ts`

Single change point, the per-line `amount` (currently line 181 `amount = sold * hc`).

1. Extend the supplier select (line 56) to fetch `settlement_mode, consignment_discount_pct`.
2. Extend the `consignment_price` select (line 57) to fetch `discount_pct`.
3. Per row, compute the discount factor:
   - `cost_plus` → factor `1`
   - `retail_minus` → factor `1 − (skuDiscountPct ?? supplierDiscountPct) / 100`
4. `amount = hc == null ? null : sold * hc * factor` (pre-VAT).

The existing global VAT step (`vat = subtotal × 0.07`, `grandTotal = subtotal + vat`,
lines 204–206) already produces the `× 1.07` for both modes — **do not touch it**.
Harvest (`cost_plus`, factor 1) is byte-for-byte unchanged.

Expose `settlement_mode` (and effective discount) on the returned object so the report
UI can label columns correctly.

## Portal UI

- **Price editor** `/m/suppliers/[id]/consignment`: for `retail_minus` suppliers,
  label the base-price column **"List price"** and show derived read-only columns
  **"Customer (×1.07)"** and **"Payable/unit"** (`P × (1 − disc) × 1.07`), so the
  screen reconciles visually with the supplier's invoice. For `cost_plus`, keep the
  current "HC" labelling.
- **Monthly report** `/m/suppliers/[id]/report`: logic unchanged (it consumes the
  settlement engine). Adjust labels to reflect the active mode; show the effective
  discount in `retail_minus` mode.
- **Pulse / Rolling:** no change. Both already pick up any `type='consignment'`
  supplier; the accrual they read comes from the same engine.

## Tastings

Free sample cigars are excluded from the settlement, identical to Harvest — the
report's `tastings` column already does this (`sold` excludes tastings; tastings are
free). `retail_minus` inherits the behaviour with no extra work.

## Partner profile

`07_contacts/partners/cigar-empire/profile.md` — from the delivery note:

- Cigar Empire Company Limited · Tax No. 0835566046251 (Head Office)
- 33 Hongyok Uthit Road, Mueang, Talat Yai, Phuket 83000
- Ibrahim Tuncel · 0928653180 · access@cigar-empire.com · cigar-empire.com
- Type: consignment, `retail_minus`, 30% discount, 5th-to-5th cycle.
- First delivery: TDN-20260600009 (29/06/2026).

## Out of scope (explicitly not doing)

- **No Harvest changes** — `cost_plus` path is the unchanged default.
- **No PDF parser** for Cigar Empire price lists/delivery notes — ~12 SKUs entered by
  hand; revisit if delivery volume grows.
- **No automatic Loyverse writes** — the user creates the supplier and the stock
  adjustment (opening balance) in Loyverse and the portal manually.
- **No POS-revenue-based settlement** — anchored to the list price, see Approach.

## User-owned steps (not code)

- Create the supplier in Loyverse with the matching name.
- Stock adjustment in Loyverse for the opening balance (already done).
- Enter the per-SKU list prices in the portal price editor.
- Record opening stock / this delivery via the portal (deliveries / opening cells).
- Apply migration 030 in the Supabase SQL Editor.
