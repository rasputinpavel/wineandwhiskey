import { InlineKeyboard } from "grammy";

// ─── Types ───────────────────────────────────────────────────────────────

export type POExtraction = {
  supplier: string;
  docNumber: string;
  orderDate: string;   // DD.MM.YYYY or "" if unknown
  amount: string;      // digits only, or ""
};

export interface PendingPO {
  supplier: string;
  docNumber: string;
  orderDate: string;    // DD.MM.YYYY or ""
  receivedDate: string; // DD.MM.YYYY (defaults to today)
  amount: string;       // digits only, or ""
  note: string;
  scanBase64: string;
  scanMime: "image/jpeg" | "image/png" | "application/pdf";
  uploadedBy: string;
  duplicate: boolean;   // doc_number already in the registry
}

// ─── Parsing ─────────────────────────────────────────────────────────────

// Parse the vision model's JSON. Returns null when the image is NOT a supplier
// PO (is_po false/absent) or the text isn't valid JSON.
export function parsePOJSON(raw: string): POExtraction | null {
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const j = JSON.parse(clean);
    if (!j || j.is_po !== true) return null;
    return {
      supplier: j.supplier ? String(j.supplier).trim() : "",
      docNumber: j.doc_number ? String(j.doc_number).trim() : "",
      orderDate: j.order_date ? String(j.order_date).trim() : "",
      amount: j.amount ? String(j.amount).replace(/[^\d.]/g, "") : "",
    };
  } catch {
    return null;
  }
}

// DD.MM.YYYY -> YYYY-MM-DD for date columns. null if not a clean DD.MM.YYYY.
export function toISODate(ddmmyyyy: string): string | null {
  const m = ddmmyyyy.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// ─── UI builders ─────────────────────────────────────────────────────────

export function buildPOMessage(p: PendingPO): string {
  const lines = [
    `📄 <b>Purchase Order — проверь:</b>`,
    ``,
    `🏭 <b>Поставщик:</b> ${p.supplier || "—"}`,
    `🧾 <b>№ счёта/PO:</b> ${p.docNumber || "—"}`,
    `📅 <b>Дата документа:</b> ${p.orderDate || "—"}`,
    `📦 <b>Дата прихода:</b> ${p.receivedDate}`,
    `💰 <b>Сумма:</b> ฿${p.amount || "—"}`,
  ];
  if (p.duplicate) lines.push(``, `⚠️ <b>Такой № уже есть в реестре</b>`);
  return lines.join("\n");
}

export function buildPOKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Записать", "po_confirm")
    .text("↔️ Это расход", "po_expense")
    .row()
    .text("✖ Отмена", "po_cancel");
}
