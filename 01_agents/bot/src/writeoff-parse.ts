import { InlineKeyboard } from "grammy";

// ─── Types ───────────────────────────────────────────────────────────────

export type WriteoffExtraction = { query: string; qty: number; weightGrams: number | null };
export type CatalogItem = { variant_id: string; item_name: string; in_stock: number; sold_by_weight: boolean };
export type Candidate = CatalogItem & { score: number };
export type WriteoffCard = { itemName: string; qty: number; weightGrams: number | null; date: string }; // date = DD.MM.YYYY
export type PendingRow = {
  id: string; item_name: string; qty: number; weight_grams: number | null;
  taken_date: string; // YYYY-MM-DD
  taken_by: string | null; status: string;
};

// ─── Trigger detection ─────────────────────────────────────────────────────

// Whole-word triggers that route a message (text or photo caption) to the
// write-off flow instead of the expense flow. Matched as whole words (Unicode
// boundaries) so common Russian words never collide: "списание" must not fire
// on "расписание" (schedule). Bare "себе" is deliberately excluded — it's an
// ordinary word ("купил себе обед") and would false-positive on plain expense
// messages; only the owner's actual take-phrases ("взяли/берём/беру себе")
// trigger, covering both ё and е spellings. The whole-word matcher treats the
// space inside a multi-word entry as a literal character, so these still only
// match as exact phrases. Explicit inflection list beats stemming, which trips
// on "список"/"расписание". A form we miss just makes the user retype.
const TRIGGERS = [
  "спиши", "спишите", "списать", "списал", "списала", "списание", "списываю",
  "взяли себе", "взял себе", "берём себе", "берем себе", "беру себе",
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
    const wNum = Number(j?.weight_grams);
    const weightGrams = Number.isFinite(wNum) && wNum > 0 ? Math.round(wNum) : null;
    return { query, qty, weightGrams };
  } catch {
    return null;
  }
}

// ─── Catalog matching ──────────────────────────────────────────────────────

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

// Cheap local fuzzy scoring: how many query tokens appear (as substrings) in the
// item name, with a bonus for the whole query being a substring of the name.
// Items with zero matching tokens are dropped. Sorted best-first, max 5.
export function scoreCandidates(query: string, catalog: CatalogItem[]): Candidate[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const qJoined = qTokens.join(" ");

  const scored = catalog
    .map((item): Candidate => {
      const name = item.item_name.toLowerCase();
      const nameTokens = tokenize(item.item_name);
      const nameJoined = nameTokens.join(" ");
      let score = 0;
      for (const qt of qTokens) {
        if (nameTokens.some((nt) => nt === qt)) score += 2;        // exact token
        else if (name.includes(qt)) score += 1;                    // substring
      }
      if (nameJoined.includes(qJoined)) score += 3;                // whole-query bonus
      return { ...item, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.item_name.localeCompare(b.item_name));

  return scored.slice(0, 5);
}

// A match is "confident" (skip the picker) when there is exactly one candidate,
// or the top candidate's score is clearly ahead of the second.
export function isConfident(candidates: Candidate[]): boolean {
  if (candidates.length === 0) return false;
  if (candidates.length === 1) return true;
  return candidates[0].score >= candidates[1].score + 3;
}

// ─── UI builders ─────────────────────────────────────────────────────────

// Escape the three characters Telegram's HTML parse_mode treats as markup, so an
// item name like "Moët & Chandon" doesn't break sendMessage with "can't parse
// entities". Only user/catalog-derived text needs this; our own labels are safe.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// State is NOT held in memory: the card fields are reconstructed from the card
// text (see the callback handler), and the variant_id rides in callback data —
// so confirming survives a bot restart (Railway redeploy) mid-flow.
export function buildWriteoffMessage(c: WriteoffCard): string {
  const amountLine =
    c.weightGrams != null
      ? `⚖️ <b>Вес:</b> ${c.weightGrams} г`
      : `🔢 <b>Кол-во:</b> ${c.qty}`;
  return [
    `🍷 <b>Списание «себе» — проверь:</b>`,
    ``,
    `📦 <b>Товар:</b> ${escapeHtml(c.itemName)}`,
    amountLine,
    `📅 <b>Дата:</b> ${c.date}`,
  ].join("\n");
}

// Reconstruct the card from the confirmation message text (delivered without the
// HTML bold tags). Returns null when the text is not a write-off card.
export function parseWriteoffFromMessage(text: string): WriteoffCard | null {
  if (!/Списание «себе»/.test(text) || !/Товар:/.test(text)) return null;
  const grab = (re: RegExp) => text.match(re)?.[1]?.trim() ?? "";
  const itemName = grab(/Товар:\s*(.+)/);
  const date = grab(/Дата:\s*([\d.]+)/);
  const weightM = text.match(/Вес:\s*(\d+)\s*г/);
  const weightGrams = weightM ? Number(weightM[1]) : null;
  const qtyM = text.match(/Кол-во:\s*(\d+)/);
  const qty = qtyM ? Number(qtyM[1]) : 1;
  if (!itemName) return null;
  if (weightGrams == null && (!Number.isFinite(qty) || qty <= 0)) return null;
  return { itemName, qty, weightGrams, date };
}

export function buildWriteoffKeyboard(variantId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Записать", `wo_confirm:${variantId}`)
    .text("✖ Отмена", "wo_cancel");
}

// One button per candidate; qty rides alongside the variant_id so the picked
// card can be rebuilt without any in-memory state.
export function buildCandidatesKeyboard(candidates: Candidate[], qty: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const c of candidates) {
    const label = `${c.item_name} (${c.in_stock} шт)`.slice(0, 60);
    kb.text(label, `wo_pick:${qty}:${c.variant_id}`).row();
  }
  kb.text("✖ Отмена", "wo_cancel");
  return kb;
}

// ─── Reminder formatting ───────────────────────────────────────────────────

// Whole-day difference between two YYYY-MM-DD dates (parsed at noon UTC so a
// timezone shift never moves the day). Returns a human age label in Russian.
function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T12:00:00Z").getTime();
  const b = new Date(to + "T12:00:00Z").getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

// Russian plural for "день/дня/дней".
function pluralDays(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} дня`;
  return `${n} дней`;
}

export function ageLabel(takenDate: string, today: string): string {
  const d = daysBetween(takenDate, today);
  if (d <= 0) return "сегодня";
  if (d === 1) return "со вчера";
  return pluralDays(d);
}

// The briefing block listing every open write-off, oldest first. Empty string
// when nothing is pending (caller then omits the block).
export function formatPendingReminder(rows: PendingRow[], today: string): string {
  const pending = rows
    .filter((r) => r.status === "pending")
    .sort((a, b) => a.taken_date.localeCompare(b.taken_date));
  if (pending.length === 0) return "";

  const lines = pending.map(
    (r) => `• ${r.qty}× ${escapeHtml(r.item_name)} — ${ageLabel(r.taken_date, today)}`,
  );
  return [
    `🍷 <b>Не списано (${pending.length}):</b>`,
    ...lines,
    `Закрой через /writeoffs, когда сделаешь Stock Adjustment в Loyverse.`,
  ].join("\n");
}
