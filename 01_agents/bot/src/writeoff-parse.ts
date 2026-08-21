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

// Whole-word triggers that route a message (text or photo caption) to the
// write-off flow instead of the expense flow. Matched as whole words (Unicode
// boundaries) so common Russian words never collide: "списание" must not fire
// on "расписание" (schedule), and "себе" must not fire on "себестоимость"
// (cost price). Explicit inflection list beats stemming, which trips on
// "список"/"расписание". A form we miss just makes the user retype.
const TRIGGERS = [
  "спиши", "спишите", "списать", "списал", "списала", "списание", "списываю", "себе",
];

// True when any trigger appears as a whole word (not embedded in a longer word).
export function hasWriteoffTrigger(text: string): boolean {
  return TRIGGERS.some((t) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${t}(?![\\p{L}\\p{N}])`, "iu").test(text),
  );
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
    const qty = Number.isFinite(qtyNum) && qtyNum > 0 ? Math.max(1, Math.round(qtyNum)) : 1;
    return { query, qty };
  } catch {
    return null;
  }
}
