# Cigar Empire Company Limited

**Type:** Supplier — cigars, **consignment**
**Settlement:** `retail_minus` — pay `list × (1 − 30%) × 1.07` per sold unit
**Billing cycle:** monthly, 5th-to-5th (same as Harvest)
**Tax No.:** 0835566046251 (Head Office)
**Address:** 33 Hongyok Uthit Road, Mueang, Talat Yai, Phuket 83000
**Contact:** Ibrahim Tuncel · +66 92 865 3180 · access@cigar-empire.com · cigar-empire.com

## How settlement works

Their price list gives one number per cigar, `P` — the **VAT-inclusive shelf price**
the customer pays. We pay them 30% off, with 7% VAT on the discounted base:

> per sold unit = `P × 0.70 × 1.07`

Example (Lauk Daun, P = 690): customer pays 690; we pay `690 × 0.70 × 1.07 = 516.81`;
our margin ≈ 25.1%. The nominal discount is 30%, but because VAT lands on the cost
side after the discount, the realised margin against the shelf price is ~25%.

We only pay for units **sold** in the cycle, not for stock on hand. The delivery note
total is the value of consignment stock handed over (the opening balance), not a bill.

## First delivery (opening balance)

Temporary Delivery Note **TDN-20260600009**, 29/06/2026 — 6 SKUs × 5 units:

| Cigar | Code | List price ฿ | Payable/unit ฿ |
|-------|------|-------------|----------------|
| Lauk Daun | BR-LDE | 690 | 516.81 |
| My Lockdown | BR-MYLO | 560 | 419.44 |
| Airlangga Grand Corona | BR-ALGC | 480 | 359.52 |
| Joker Robusto | DNT-JRO | 490 | 367.01 |
| Joker Connecticut | DNT-JCNT | 490 | 367.01 |
| Ernesto S4 | TM-ERS4 | 400 | 299.60 |

Stock value handed over: net 10,885 + VAT 761.95 = **11,646.95**.

## In the portal

Mission Control → Suppliers → Cigar Empire Company Limited:
- **Consignment prices** — enter each cigar's list price (`P`); Payable/unit shown.
- **Deliveries** — log stock arrivals (this first batch = opening balance).
- **Monthly report** — 5th-to-5th settlement, auto-priced at `P × 0.70 × 1.07`.
