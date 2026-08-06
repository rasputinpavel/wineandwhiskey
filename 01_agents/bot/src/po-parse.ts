import { InlineKeyboard } from "grammy";

// ─── Types ───────────────────────────────────────────────────────────────

export type POExtraction = {
  supplier: string;
  docNumber: string;
  orderDate: string;   // DD.MM.YYYY or "" if unknown
  amount: string;      // digits only, or ""
};

// The fields shown on the confirmation card. State is NOT held in memory — it is
// reconstructed from the card text (which Telegram returns with the callback) +
// the scan path in the callback data, so confirming survives a bot restart
// (Railway redeploy) mid-flow.
export type POCard = {
  supplier: string;
  docNumber: string;
  orderDate: string;    // DD.MM.YYYY or ""
  receivedDate: string; // DD.MM.YYYY
  amount: string;       // digits only, or ""
  duplicate: boolean;
};

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

// Reconstruct the card fields from the confirmation message text. Telegram
// delivers message.text without the HTML bold tags, so we match the plain
// labels. Returns null when the text is not a PO card.
export function parsePOFromMessage(text: string): POCard | null {
  if (!/№ счёта\/PO:/.test(text) && !/Поставщик:/.test(text)) return null;
  const grab = (re: RegExp) => text.match(re)?.[1]?.trim() ?? "";
  const dash = (s: string) => (s === "—" ? "" : s);
  return {
    supplier:     dash(grab(/Поставщик:\s*(.+)/)),
    docNumber:    dash(grab(/№ счёта\/PO:\s*(.+)/)),
    orderDate:    dash(grab(/Дата документа:\s*(.+)/)),
    receivedDate: dash(grab(/Дата прихода:\s*(.+)/)),
    amount:       grab(/Сумма:\s*฿?\s*([\d.,]+)/).replace(/[^\d.]/g, ""),
    duplicate:    /уже есть в реестре/.test(text),
  };
}

// ─── UI builders ─────────────────────────────────────────────────────────

export function buildPOMessage(c: POCard): string {
  const lines = [
    `📄 <b>Purchase Order — проверь:</b>`,
    ``,
    `🏭 <b>Поставщик:</b> ${c.supplier || "—"}`,
    `🧾 <b>№ счёта/PO:</b> ${c.docNumber || "—"}`,
    `📅 <b>Дата документа:</b> ${c.orderDate || "—"}`,
    `📦 <b>Дата прихода:</b> ${c.receivedDate}`,
    `💰 <b>Сумма:</b> ฿${c.amount || "—"}`,
  ];
  if (c.duplicate) lines.push(``, `⚠️ <b>Такой № уже есть в реестре</b>`);
  return lines.join("\n");
}

// The scan is already uploaded when the card is shown; its object path rides in
// the callback data so the confirm/overwrite/cancel/expense actions work even
// after a bot restart (no in-memory state).
export function buildPOKeyboard(duplicate: boolean, scanPath: string): InlineKeyboard {
  const confirm = duplicate
    ? { label: "♻️ Перезаписать", action: "po_overwrite" }
    : { label: "✅ Записать", action: "po_confirm" };
  return new InlineKeyboard()
    .text(confirm.label, `${confirm.action}:${scanPath}`)
    .text("↔️ Это расход", `po_expense:${scanPath}`)
    .row()
    .text("✖ Отмена", `po_cancel:${scanPath}`);
}
