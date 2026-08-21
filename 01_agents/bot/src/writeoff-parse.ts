import { InlineKeyboard } from "grammy";

// ─── Types ───────────────────────────────────────────────────────────────

export type WriteoffExtraction = { query: string; qty: number };
export type CatalogItem = { variant_id: string; item_name: string; in_stock: number };
export type Candidate = CatalogItem & { score: number };
export type WriteoffCard = { itemName: string; qty: number; date: string }; // date = DD.MM.YYYY
export type PendingRow = {
  id: string; item_name: string; qty: number; taken_date: string; // YYYY-MM-DD
  taken_by: string | null; status: string;
};

// ─── Trigger detection ─────────────────────────────────────────────────────

// Words that route a message (text or photo caption) to the write-off flow
// instead of the expense flow. Kept deliberately narrow so a normal expense
// ("856 интернет") never collides. Matched case-insensitively, anywhere.
const TRIGGERS = ["спиши", "списать", "списание", "списал", "взяли себе", "себе"];

export function hasWriteoffTrigger(text: string): boolean {
  const lower = text.toLowerCase();
  return TRIGGERS.some((t) => lower.includes(t));
}

// ─── Parsing ─────────────────────────────────────────────────────────────

// Parse the model's JSON for a write-off request. Returns null when the query
// is empty or the text is not valid JSON. qty defaults to 1.
export function parseWriteoffJSON(raw: string): WriteoffExtraction | null {
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const j = JSON.parse(clean);
    const query = j?.query ? String(j.query).trim() : "";
    if (!query) return null;
    const qtyNum = Number(j?.qty);
    const qty = Number.isFinite(qtyNum) && qtyNum > 0 ? Math.round(qtyNum) : 1;
    return { query, qty };
  } catch {
    return null;
  }
}
