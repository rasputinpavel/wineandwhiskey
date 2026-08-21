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
      let score = 0;
      for (const qt of qTokens) {
        if (nameTokens.some((nt) => nt === qt)) score += 2;        // exact token
        else if (name.includes(qt)) score += 1;                    // substring
      }
      if (name.includes(qJoined)) score += 3;                      // whole-query bonus
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
