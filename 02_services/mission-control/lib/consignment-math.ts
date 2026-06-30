// Pure per-unit consignment cost math — no I/O, unit-tested in consignment-math.test.ts.
//
// Two settlement modes:
//   cost_plus    (Harvest)      → we pay the wholesale cost HC per unit.
//   retail_minus (Cigar Empire) → the supplier price list IS the VAT-inclusive shelf
//                                  price P; we pay P less a discount. The 7% VAT
//                                  (×1.07) is applied by the caller at the settlement
//                                  total, so this returns the PRE-VAT per-unit cost.
//
// Returns the per-unit pre-VAT cost, or null when the base price is unset (SKU not
// priced yet → shows "n/a" in the report).

export type SettlementMode = 'cost_plus' | 'retail_minus'

export function consignmentLineCost(args: {
  mode: SettlementMode
  basePrice: number | null   // cost_plus: HC; retail_minus: list/shelf price P
  discountPct: number        // retail_minus discount, e.g. 30; ignored for cost_plus
}): number | null {
  const { mode, basePrice, discountPct } = args
  if (basePrice == null) return null
  if (mode === 'retail_minus') return basePrice * (1 - discountPct / 100)
  return basePrice
}
