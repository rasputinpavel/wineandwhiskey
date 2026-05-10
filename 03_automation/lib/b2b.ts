// Single source of truth for B2B classification.
// Used by monthly_b2c_margin, sync_b2b, identify_bestsellers, build_purchase_matrix.
//
// A receipt is B2B if EITHER condition holds:
//   1. Any payment is of type Bank Transfer (BANK_TRANSFER_TYPE_ID).
//   2. Receipt is linked to a customer whose name matches one of B2B_PATTERNS.
//
// Patterns are case-insensitive substrings. Verified against the actual
// Loyverse customer table. Do not add a pattern that would also match
// individual people (e.g. "isak" alone would catch "Isakov", "Isakova" —
// hence the explicit "isak(" to only match "Isak(Head office)").

export const BANK_TRANSFER_TYPE_ID = "6bafa324-92d9-45c9-80d8-0539a65de4cc";

export const B2B_PATTERNS: string[] = [
  // Confirmed against Loyverse customers (verified May 2026):
  "arthouse",          // Arthouse Hotelmanagement Co.,Ltd
  "bella chao",        // Bella Chao Trade Co., Ltd. (added May 2026 from manual tagging)
  "crepes",            // crepes factory co.ltd
  "fifth element",     // fifth element co.ltd
  "fine cusine",       // Fine Cusine Co,.LTD
  "french home",       // French Home co., ltd
  "golden brew",       // golden brewere
  "great glory",       // Great glory co., ltd
  "isak(",             // Isak(Head office) — narrow to avoid Isakov/Yulia Isakova
  "jetradar",          // JETRADAR
  "karon par",         // Karon paragon co.ltd
  "kusnakafe",         // kusnakafe (note: spelled with 'k', not 'c')
  "layan paradise",    // Layan Paradise Villa Co.ltd
  "lazy avocado",      // lazy avocado co.ltd
  "milimon",           // Milimon Co., Ltd.
  "next real",         // The next real Co., Ltd
  "pinzerai",          // pinzerai co ltd
  "q-squad",           // Q-Squad Co.,Ltd (added May 2026 from manual tagging)
  "secret spot",       // Secret Spot Co., Ltd.
  "shaman phuket",     // Shaman Phuket co.,Ltd
  "tbilisi",           // Tbilisi CO.,LTD (Head Office)
  "seaview",           // The Seaview Destination
];

// Known B2B clients that are NOT registered as Loyverse customers
// (they pay without customer_id, so they fall through to B2C unless we
// catch them another way — flagged here for awareness):
//   - Bella Chao Trade Co., Ltd.
//   - Kusnacafe Co., Ltd.
//   - Titov

export function isB2BCustomerName(name: string): boolean {
  const n = name.toLowerCase();
  return B2B_PATTERNS.some(p => n.includes(p));
}

export function classifyReceipt(args: { payments?: any[]; customerName?: string }): { isB2B: boolean; reasonBankTransfer: boolean; reasonCustomerName: boolean } {
  const reasonBankTransfer = (args.payments ?? []).some(p => p.payment_type_id === BANK_TRANSFER_TYPE_ID);
  const reasonCustomerName = !!args.customerName && isB2BCustomerName(args.customerName);
  return { isB2B: reasonBankTransfer || reasonCustomerName, reasonBankTransfer, reasonCustomerName };
}
