// B2B classification — MIRROR of 03_automation/lib/b2b.ts.
//
// ⚠️ The monorepo has no shared internal package and matrix-runner builds from
// its own directory on Railway, so this cannot be imported across the package
// boundary and must be kept byte-identical to the canonical copy by hand.
// Drift is guarded by `npm run check:b2b` from repo root. Edit all copies together.
//
// A receipt is B2B if EITHER a payment is Bank Transfer (BANK_TRANSFER_TYPE_ID)
// or its customer name matches one of B2B_PATTERNS (case-insensitive substrings).

export const BANK_TRANSFER_TYPE_ID = "6bafa324-92d9-45c9-80d8-0539a65de4cc";

export const B2B_PATTERNS: string[] = [
  "arthouse",          // Arthouse Hotelmanagement Co.,Ltd
  "bella chao",        // Bella Chao Trade Co., Ltd.
  "crepes",            // crepes factory co.ltd
  "fifth element",     // fifth element co.ltd
  "fine cusine",       // Fine Cusine Co,.LTD
  "french home",       // French Home co., ltd
  "golden brew",       // golden brewere
  "great glory",       // Great glory co., ltd
  "isak(",             // Isak(Head office) — narrow to avoid Isakov/Yulia Isakova
  "jetradar",          // JETRADAR
  "karon par",         // Karon paragon co.ltd
  "kusnakafe",         // kusnakafe
  "layan paradise",    // Layan Paradise Villa Co.ltd
  "lazy avocado",      // lazy avocado co.ltd
  "milimon",           // Milimon Co., Ltd.
  "next real",         // The next real Co., Ltd
  "pinzerai",          // pinzerai co ltd
  "q-squad",           // Q-Squad Co.,Ltd
  "secret spot",       // Secret Spot Co., Ltd.
  "shaman phuket",     // Shaman Phuket co.,Ltd
  "tbilisi",           // Tbilisi CO.,LTD (Head Office)
  "seaview",           // The Seaview Destination
];

export function isB2BCustomerName(name: string): boolean {
  const n = name.toLowerCase();
  return B2B_PATTERNS.some((p) => n.includes(p));
}

export function classifyReceipt(args: { payments?: { payment_type_id?: string }[]; customerName?: string | null }): {
  isB2B: boolean;
  reasonBankTransfer: boolean;
  reasonCustomerName: boolean;
} {
  const reasonBankTransfer = (args.payments ?? []).some((p) => p.payment_type_id === BANK_TRANSFER_TYPE_ID);
  const reasonCustomerName = !!args.customerName && isB2BCustomerName(args.customerName);
  return { isB2B: reasonBankTransfer || reasonCustomerName, reasonBankTransfer, reasonCustomerName };
}
