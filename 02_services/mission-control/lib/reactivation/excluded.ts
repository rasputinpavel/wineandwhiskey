// Customers we never want to surface in the reactivation list.
// Match is case-insensitive on the trimmed Loyverse customer name.
//
// Yuri is the former owner of the store. He still has a customer card in
// Loyverse so his historical receipts (including ones he rang up on himself
// as a placeholder) inflate the "top customer" list with non-B2C activity.

export const EXCLUDED_CUSTOMER_NAMES = new Set<string>(['yuri'])

export function isExcludedCustomer(name: string | null | undefined): boolean {
  if (!name) return false
  return EXCLUDED_CUSTOMER_NAMES.has(name.trim().toLowerCase())
}
