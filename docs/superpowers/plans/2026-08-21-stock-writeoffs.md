# Stock Write-off Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Chip & Dale Telegram bot a third capability — remember bottles taken "себе", remind about them daily until closed, and close them via a manual button (source of truth is the human, who does the Stock Adjustment in Loyverse).

**Architecture:** Pure logic (trigger detection, parse, catalog scoring, card/keyboard builders, reminder formatting) lives in `writeoff-parse.ts` and is unit-tested with vitest (mirrors `po-parse.ts`). Side effects (Claude vision/text calls, Loyverse catalog fetch, Supabase reads/writes) live in `writeoff.ts` (mirrors `po.ts`). Wiring into message/callback routing goes in `index.ts`; the daily reminder into `briefing.ts`. A new Supabase table `public.stock_writeoffs` is the shared store, surfaced in mission-control at `/m/writeoffs`. The bot never writes to Loyverse.

**Tech Stack:** TypeScript, grammy (Telegram), `@anthropic-ai/sdk` (claude-sonnet-4-6), `@supabase/supabase-js`, Loyverse REST API, vitest. Portal: Next.js (App Router) + Supabase.

**Spec:** `docs/superpowers/specs/2026-08-21-stock-writeoffs-design.md`

---

## File Structure

**Bot (`01_agents/bot/`):**
- Create `src/writeoff-parse.ts` — pure: trigger detection, JSON parse, catalog scoring, card build/parse, keyboards, reminder/age formatting.
- Create `src/writeoff-parse.test.ts` — vitest unit tests for the above.
- Create `src/writeoff.ts` — side effects: Claude parse (text + photo), catalog fetch + match, Supabase insert/list/close.
- Modify `src/loyverse.ts` — add `getCatalogItems()` returning structured `{ variant_id, item_name, in_stock }[]` (DRY: reuse the cached fetch).
- Modify `src/index.ts` — routing (trigger before expense), `startWriteoffFlow`, `handleWriteoffCallback`, `/writeoffs` command.
- Modify `src/briefing.ts` — append the "не списано" block.

**Portal (`02_services/mission-control/`):**
- Create `supabase/migrations/038_stock_writeoffs.sql`.
- Modify `lib/registry.ts` — add the `writeoffs` item under Operations.
- Create `app/(portal)/m/writeoffs/page.tsx` — table + close button.
- Create `app/api/m/writeoffs/route.ts` — `GET` list, `POST` close.

**Data types (defined in Task 1, referenced throughout):**

```ts
// writeoff-parse.ts
export type WriteoffExtraction = { query: string; qty: number };
export type CatalogItem = { variant_id: string; item_name: string; in_stock: number };
export type Candidate = CatalogItem & { score: number };
export type WriteoffCard = { itemName: string; qty: number; date: string }; // date = DD.MM.YYYY
export type PendingRow = {
  id: string; item_name: string; qty: number; taken_date: string; // YYYY-MM-DD
  taken_by: string | null; status: string;
};
```

---

## Task 1: Trigger detection + JSON parse (pure)

**Files:**
- Create: `01_agents/bot/src/writeoff-parse.ts`
- Test: `01_agents/bot/src/writeoff-parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { hasWriteoffTrigger, parseWriteoffJSON } from "./writeoff-parse.js";

describe("hasWriteoffTrigger", () => {
  it("matches write-off phrases anywhere, case-insensitive", () => {
    expect(hasWriteoffTrigger("спиши просекко 2")).toBe(true);
    expect(hasWriteoffTrigger("Взяли себе бутылку Beluga")).toBe(true);
    expect(hasWriteoffTrigger("списание: 1 Whispering Angel")).toBe(true);
    expect(hasWriteoffTrigger("СПИСАЛ два просекко")).toBe(true);
  });
  it("does not match a plain expense or a normal question", () => {
    expect(hasWriteoffTrigger("856 интернет")).toBe(false);
    expect(hasWriteoffTrigger("сколько виски на складе?")).toBe(false);
  });
});

describe("parseWriteoffJSON", () => {
  it("parses query + qty", () => {
    expect(parseWriteoffJSON('{"query":"Prosecco Miravento","qty":2}')).toEqual({
      query: "Prosecco Miravento", qty: 2,
    });
  });
  it("defaults qty to 1 and strips markdown fences", () => {
    expect(parseWriteoffJSON('```json\n{"query":"Beluga"}\n```')).toEqual({
      query: "Beluga", qty: 1,
    });
  });
  it("returns null on empty query or invalid JSON", () => {
    expect(parseWriteoffJSON('{"query":"","qty":3}')).toBeNull();
    expect(parseWriteoffJSON("not json")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd 01_agents/bot && npm run test -- writeoff-parse`
Expected: FAIL — `writeoff-parse.js` has no such exports (module not found / undefined).

- [ ] **Step 3: Write minimal implementation**

Create `01_agents/bot/src/writeoff-parse.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd 01_agents/bot && npm run test -- writeoff-parse`
Expected: PASS (both describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add 01_agents/bot/src/writeoff-parse.ts 01_agents/bot/src/writeoff-parse.test.ts
git commit -m "feat(bot): write-off trigger detection + JSON parse"
```

---

## Task 2: Catalog scoring (pure)

**Files:**
- Modify: `01_agents/bot/src/writeoff-parse.ts`
- Test: `01_agents/bot/src/writeoff-parse.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `writeoff-parse.test.ts`:

```ts
import { scoreCandidates } from "./writeoff-parse.js";

const CATALOG = [
  { variant_id: "v1", item_name: "Prosecco Miravento DOC", in_stock: 12 },
  { variant_id: "v2", item_name: "Whispering Angel Rosé", in_stock: 4 },
  { variant_id: "v3", item_name: "Beluga Noble Vodka", in_stock: 7 },
  { variant_id: "v4", item_name: "Prosecco Valdobbiadene Superiore", in_stock: 3 },
];

describe("scoreCandidates", () => {
  it("ranks the closest name first", () => {
    const res = scoreCandidates("miravento", CATALOG);
    expect(res[0].variant_id).toBe("v1");
  });
  it("returns multiple candidates when the query is ambiguous (token match)", () => {
    const res = scoreCandidates("prosecco", CATALOG);
    const ids = res.map((c) => c.variant_id);
    expect(ids).toContain("v1");
    expect(ids).toContain("v4");
  });
  it("returns empty when nothing matches any token", () => {
    expect(scoreCandidates("tequila", CATALOG)).toEqual([]);
  });
  it("is case- and spacing-insensitive", () => {
    expect(scoreCandidates("  WHISPERING   angel ", CATALOG)[0].variant_id).toBe("v2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd 01_agents/bot && npm run test -- writeoff-parse`
Expected: FAIL — `scoreCandidates` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `writeoff-parse.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd 01_agents/bot && npm run test -- writeoff-parse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 01_agents/bot/src/writeoff-parse.ts 01_agents/bot/src/writeoff-parse.test.ts
git commit -m "feat(bot): fuzzy catalog scoring for write-offs"
```

---

## Task 3: Card + keyboards + round-trip parse (pure)

**Files:**
- Modify: `01_agents/bot/src/writeoff-parse.ts`
- Test: `01_agents/bot/src/writeoff-parse.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `writeoff-parse.test.ts`:

```ts
import {
  buildWriteoffMessage, parseWriteoffFromMessage,
  buildWriteoffKeyboard, buildCandidatesKeyboard,
} from "./writeoff-parse.js";

// Telegram delivers message.text without HTML bold tags — simulate that.
const asDelivered = (html: string) => html.replace(/<\/?b>/g, "");

describe("write-off card round-trip", () => {
  it("parses back the fields it renders", () => {
    const card = { itemName: "Prosecco Miravento DOC", qty: 2, date: "21.08.2026" };
    const text = asDelivered(buildWriteoffMessage(card));
    expect(parseWriteoffFromMessage(text)).toEqual(card);
  });
  it("returns null for a non-card message", () => {
    expect(parseWriteoffFromMessage("сколько виски?")).toBeNull();
  });
});

describe("keyboards", () => {
  it("confirm keyboard carries the variant_id in callback data", () => {
    const kb = buildWriteoffKeyboard("v1");
    const flat = kb.inline_keyboard.flat();
    expect(flat.some((b: any) => b.callback_data === "wo_confirm:v1")).toBe(true);
    expect(flat.some((b: any) => b.callback_data === "wo_cancel")).toBe(true);
  });
  it("candidate keyboard carries qty + variant_id per row", () => {
    const kb = buildCandidatesKeyboard(
      [{ variant_id: "v1", item_name: "Prosecco Miravento DOC", in_stock: 12, score: 5 },
       { variant_id: "v4", item_name: "Prosecco Valdobbiadene Superiore", in_stock: 3, score: 4 }],
      2,
    );
    const flat = kb.inline_keyboard.flat();
    expect(flat.some((b: any) => b.callback_data === "wo_pick:2:v1")).toBe(true);
    expect(flat.some((b: any) => b.callback_data === "wo_pick:2:v4")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd 01_agents/bot && npm run test -- writeoff-parse`
Expected: FAIL — builders/parser not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `writeoff-parse.ts`:

```ts
// ─── UI builders ─────────────────────────────────────────────────────────

// State is NOT held in memory: the card fields are reconstructed from the card
// text (Task: handleWriteoffCallback), and the variant_id rides in callback
// data — so confirming survives a bot restart (Railway redeploy) mid-flow.
export function buildWriteoffMessage(c: WriteoffCard): string {
  return [
    `🍷 <b>Списание «себе» — проверь:</b>`,
    ``,
    `📦 <b>Товар:</b> ${c.itemName}`,
    `🔢 <b>Кол-во:</b> ${c.qty}`,
    `📅 <b>Дата:</b> ${c.date}`,
  ].join("\n");
}

// Reconstruct the card from the confirmation message text (delivered without the
// HTML bold tags). Returns null when the text is not a write-off card.
export function parseWriteoffFromMessage(text: string): WriteoffCard | null {
  if (!/Списание «себе»/.test(text) || !/Товар:/.test(text)) return null;
  const grab = (re: RegExp) => text.match(re)?.[1]?.trim() ?? "";
  const itemName = grab(/Товар:\s*(.+)/);
  const qty = Number(grab(/Кол-во:\s*(\d+)/));
  const date = grab(/Дата:\s*([\d.]+)/);
  if (!itemName || !Number.isFinite(qty) || qty <= 0) return null;
  return { itemName, qty, date };
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd 01_agents/bot && npm run test -- writeoff-parse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 01_agents/bot/src/writeoff-parse.ts 01_agents/bot/src/writeoff-parse.test.ts
git commit -m "feat(bot): write-off card, keyboards, round-trip parse"
```

---

## Task 4: Reminder + age formatting (pure)

**Files:**
- Modify: `01_agents/bot/src/writeoff-parse.ts`
- Test: `01_agents/bot/src/writeoff-parse.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `writeoff-parse.test.ts`:

```ts
import { ageLabel, formatPendingReminder } from "./writeoff-parse.js";

describe("ageLabel", () => {
  it("labels today / yesterday / N days", () => {
    expect(ageLabel("2026-08-21", "2026-08-21")).toBe("сегодня");
    expect(ageLabel("2026-08-20", "2026-08-21")).toBe("со вчера");
    expect(ageLabel("2026-08-16", "2026-08-21")).toBe("5 дней");
  });
});

describe("formatPendingReminder", () => {
  const rows = [
    { id: "a", item_name: "Prosecco Miravento DOC", qty: 2, taken_date: "2026-08-20", taken_by: "Grace", status: "pending" },
    { id: "b", item_name: "Whispering Angel Rosé", qty: 1, taken_date: "2026-08-18", taken_by: "Som", status: "pending" },
  ];
  it("lists all pending, oldest first, with age labels", () => {
    const out = formatPendingReminder(rows, "2026-08-21");
    expect(out).toContain("🍷");
    expect(out).toContain("2× Prosecco Miravento DOC");
    expect(out).toContain("со вчера");
    expect(out).toContain("1× Whispering Angel Rosé");
    expect(out).toContain("3 дня");
    // oldest (18th) listed before newer (20th)
    expect(out.indexOf("Whispering")).toBeLessThan(out.indexOf("Prosecco"));
    expect(out).toContain("/writeoffs");
  });
  it("returns empty string when nothing is pending", () => {
    expect(formatPendingReminder([], "2026-08-21")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd 01_agents/bot && npm run test -- writeoff-parse`
Expected: FAIL — `ageLabel` / `formatPendingReminder` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `writeoff-parse.ts`:

```ts
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
    (r) => `• ${r.qty}× ${r.item_name} — ${ageLabel(r.taken_date, today)}`,
  );
  return [
    `🍷 <b>Не списано (${pending.length}):</b>`,
    ...lines,
    `Закрой через /writeoffs, когда сделаешь Stock Adjustment в Loyverse.`,
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd 01_agents/bot && npm run test -- writeoff-parse`
Expected: PASS (all four describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add 01_agents/bot/src/writeoff-parse.ts 01_agents/bot/src/writeoff-parse.test.ts
git commit -m "feat(bot): pending write-off reminder + age formatting"
```

---

## Task 5: Loyverse structured catalog fetch

**Files:**
- Modify: `01_agents/bot/src/loyverse.ts` (add export near `getStoreContext`)

No unit test — this hits the live Loyverse API. Verified by the integration smoke in Task 11.

- [ ] **Step 1: Add `getCatalogItems()` to `loyverse.ts`**

Append after `getStoreContext` (around line 82):

```ts
// Structured catalog for write-off matching — same data as getStoreContext but
// returned as rows instead of a formatted string. Not cached here (the caller
// fetches at most once per write-off); reuses the same paginated fetch.
export async function getCatalogItems(): Promise<
  { variant_id: string; item_name: string; in_stock: number }[]
> {
  const [items, inventory] = await Promise.all([
    loyverseFetch<Item>("/items", "items"),
    loyverseFetch<InventoryLevel>("/inventory", "inventory_levels"),
  ]);
  const inventoryMap = new Map(inventory.map((i) => [i.variant_id, i.in_stock]));
  return items
    .filter((item) => !item.deleted_at && item.variants.length > 0)
    .map((item) => {
      const v = item.variants[0];
      return {
        variant_id: v.variant_id,
        item_name: item.item_name,
        in_stock: inventoryMap.get(v.variant_id) ?? 0,
      };
    });
}
```

- [ ] **Step 2: Verify it compiles (imported by the test suite indirectly)**

Run: `cd 01_agents/bot && npm run test`
Expected: PASS — existing tests still green (no new failures introduced by the edit).

- [ ] **Step 3: Commit**

```bash
git add 01_agents/bot/src/loyverse.ts
git commit -m "feat(bot): structured Loyverse catalog fetch for write-off matching"
```

---

## Task 6: Write-off side-effects module (Claude + Supabase + match)

**Files:**
- Create: `01_agents/bot/src/writeoff.ts`

No unit test — this is the side-effect layer (Claude, Supabase, Loyverse). Its pure pieces are already tested in Tasks 1-4; the wiring is exercised by Task 11's smoke test.

- [ ] **Step 1: Create `writeoff.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./db.js";
import { getCatalogItems } from "./loyverse.js";
import {
  parseWriteoffJSON, scoreCandidates,
  type WriteoffExtraction, type Candidate, type PendingRow,
} from "./writeoff-parse.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const TEXT_PROMPT =
  `Пользователь хочет списать товар со склада винного магазина («взяли себе»). ` +
  `Из сообщения извлеки название товара для поиска и количество. ` +
  `query — очищенное название БЕЗ слов-триггеров (спиши, списать, списание, себе, взяли). ` +
  `qty — число штук (по умолчанию 1, если не указано). ` +
  `Ответь ТОЛЬКО валидным JSON без markdown. Пример: {"query":"Prosecco Miravento","qty":2}.`;

const PHOTO_PROMPT =
  `На фото — бутылка/этикетка алкоголя, которую сотрудник забрал себе и хочет списать. ` +
  `Прочитай бренд/название с этикетки и верни короткое название для поиска по каталогу. ` +
  `Количество (qty) возьми из подписи пользователя, если есть, иначе 1. ` +
  `query — название без лишних слов. Ответь ТОЛЬКО валидным JSON без markdown. ` +
  `Пример: {"query":"Beluga Noble Vodka","qty":1}.`;

// Parse a plain-text write-off request via Claude. Returns null when nothing
// usable was extracted (caller then asks the user to retype).
export async function parseWriteoffText(text: string): Promise<WriteoffExtraction | null> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    messages: [{ role: "user", content: `${TEXT_PROMPT}\n\nСообщение: ${text}` }],
  });
  const raw = response.content.find((b) => b.type === "text")?.text ?? "";
  return parseWriteoffJSON(raw);
}

// Parse a photo (bottle label) + optional caption via Claude vision.
export async function parseWriteoffPhoto(
  base64: string,
  mime: "image/jpeg" | "image/png",
  caption: string,
): Promise<WriteoffExtraction | null> {
  const source = { type: "base64" as const, media_type: mime, data: base64 };
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    messages: [{
      role: "user",
      content: [
        { type: "image", source },
        { type: "text", text: `${PHOTO_PROMPT}\n\nПодпись пользователя: ${caption || "(нет)"}` },
      ],
    }],
  });
  const raw = response.content.find((b) => b.type === "text")?.text ?? "";
  return parseWriteoffJSON(raw);
}

// Fetch the catalog and return the scored candidates for a query.
export async function matchCatalog(query: string): Promise<Candidate[]> {
  const catalog = await getCatalogItems();
  return scoreCandidates(query, catalog);
}

// Look up a single catalog item by variant_id (used when the user picks a
// candidate — we rebuild the card from the fresh catalog row).
export async function findVariant(
  variantId: string,
): Promise<{ variant_id: string; item_name: string; in_stock: number } | null> {
  const catalog = await getCatalogItems();
  return catalog.find((c) => c.variant_id === variantId) ?? null;
}

// ─── Supabase store ────────────────────────────────────────────────────────

export async function insertWriteoff(row: {
  variantId: string; itemName: string; qty: number; takenDate: string; takenBy: string;
}): Promise<void> {
  if (!supabase) throw new Error("Supabase не подключён (SUPABASE_URL/SUPABASE_SERVICE_KEY).");
  const ins = await supabase.from("stock_writeoffs").insert({
    variant_id: row.variantId || null,
    item_name: row.itemName,
    qty: row.qty,
    taken_date: row.takenDate, // YYYY-MM-DD
    taken_by: row.takenBy || null,
    status: "pending",
  });
  if (ins.error) throw new Error(`DB insert failed: ${ins.error.message}`);
}

export async function listPending(): Promise<PendingRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("stock_writeoffs")
    .select("id, item_name, qty, taken_date, taken_by, status")
    .eq("status", "pending")
    .order("taken_date", { ascending: true });
  if (error) { console.error("listPending failed:", error.message); return []; }
  return (data ?? []) as PendingRow[];
}

export async function closeWriteoff(id: string, closedBy: string): Promise<void> {
  if (!supabase) throw new Error("Supabase не подключён.");
  const upd = await supabase
    .from("stock_writeoffs")
    .update({ status: "done", closed_at: new Date().toISOString(), closed_by: closedBy || null })
    .eq("id", id);
  if (upd.error) throw new Error(`DB update failed: ${upd.error.message}`);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd 01_agents/bot && npm run test`
Expected: PASS — existing tests still green.

- [ ] **Step 3: Commit**

```bash
git add 01_agents/bot/src/writeoff.ts
git commit -m "feat(bot): write-off side-effects (Claude parse, catalog match, Supabase)"
```

---

## Task 7: Migration 038 — stock_writeoffs table

**Files:**
- Create: `02_services/mission-control/supabase/migrations/038_stock_writeoffs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 038_stock_writeoffs.sql
-- Bottles taken from stock "себе" that must be written off via a Loyverse Stock
-- Adjustment. The Chip & Dale Telegram bot records each as 'pending' and reminds
-- daily; a human does the actual adjustment in Loyverse and then closes the row
-- (status 'done') from the bot (/writeoffs) or the portal (/m/writeoffs).
--
-- The Loyverse public API does not expose adjustment history, so the human is
-- the source of truth. The bot NEVER writes to Loyverse.
--
-- Apply manually in the Supabase SQL Editor (same as all other migrations).

create table if not exists public.stock_writeoffs (
  id          uuid primary key default gen_random_uuid(),
  variant_id  text,                 -- Loyverse variant_id (for future reconciliation)
  item_name   text not null,        -- as in the Loyverse catalog at capture time
  qty         integer not null default 1,
  taken_date  date not null default (now() at time zone 'Asia/Bangkok')::date,
  taken_by    text,                 -- Telegram name of whoever logged it
  status      text not null default 'pending',  -- 'pending' | 'done'
  closed_at   timestamptz,
  closed_by   text,                 -- who pressed "Списано"
  created_at  timestamptz not null default now()
);

create index if not exists stock_writeoffs_status_idx
  on public.stock_writeoffs (status, taken_date);
```

- [ ] **Step 2: Commit** (the user applies it manually in Supabase — see `[[project_migrations_manual]]`)

```bash
git add 02_services/mission-control/supabase/migrations/038_stock_writeoffs.sql
git commit -m "feat(db): migration 038 stock_writeoffs table"
```

---

## Task 8: Wire write-off flow into the bot (`index.ts`)

**Files:**
- Modify: `01_agents/bot/src/index.ts`

No unit test (grammy handlers). Verified by Task 11 smoke test + code review.

- [ ] **Step 1: Add imports**

After the `po.js` import block (around line 24), add:

```ts
import {
  hasWriteoffTrigger, buildWriteoffMessage, parseWriteoffFromMessage,
  buildWriteoffKeyboard, buildCandidatesKeyboard, isConfident, ageLabel,
  type Candidate,
} from "./writeoff-parse.js";
import {
  parseWriteoffText, parseWriteoffPhoto, matchCatalog, findVariant,
  insertWriteoff, listPending, closeWriteoff,
} from "./writeoff.js";
```

- [ ] **Step 2: Add `startWriteoffFlow` helper**

After `startExpenseFlow` (around line 110), add:

```ts
// Show the write-off card (confident single match) or a candidate picker.
// No in-memory state — variant_id + qty travel in callback data, the card
// fields are read back from the message text on confirm.
async function startWriteoffFlow(
  chatId: number,
  extracted: { query: string; qty: number },
): Promise<void> {
  const candidates: Candidate[] = await matchCatalog(extracted.query);
  if (candidates.length === 0) {
    await bot.api.sendMessage(
      chatId,
      `🤔 Не нашёл «${extracted.query}» в каталоге. Напиши точнее название из Loyverse.`,
    );
    return;
  }
  if (isConfident(candidates)) {
    const c = candidates[0];
    await bot.api.sendMessage(
      chatId,
      buildWriteoffMessage({ itemName: c.item_name, qty: extracted.qty, date: bangkokDate() }),
      { parse_mode: "HTML", reply_markup: buildWriteoffKeyboard(c.variant_id) },
    );
    return;
  }
  await bot.api.sendMessage(chatId, `🍷 Что списываем (${extracted.qty} шт)? Выбери:`, {
    reply_markup: buildCandidatesKeyboard(candidates, extracted.qty),
  });
}
```

- [ ] **Step 3: Route photo captions with a write-off trigger**

In `bot.on("message:photo", ...)`, inside the `if (caption) { ... }` block, make the write-off check come FIRST. Replace the current captioned-photo body (lines ~387-396) with:

```ts
    if (caption) {
      // A write-off trigger in the caption ("спиши 2", "себе") routes to the
      // write-off flow; otherwise the long-standing convention holds: a
      // captioned photo is an expense entry.
      if (hasWriteoffTrigger(caption)) {
        const extracted = await parseWriteoffPhoto(
          photo.base64, photo.mimeType as "image/jpeg" | "image/png", caption,
        );
        await ctx.api.deleteMessage(chatId, waitMsg.message_id);
        if (extracted) await startWriteoffFlow(chatId, extracted);
        else await ctx.reply("Не понял, что списать. Напиши: «спиши 2 просекко».");
        return;
      }
      const extracted = await extractExpenseFromPhoto(photo.base64, photo.mimeType, caption);
      await ctx.api.deleteMessage(chatId, waitMsg.message_id);
      if (extracted) {
        await startExpenseFlow(chatId, extracted);
      } else {
        await ctx.reply("Не смог распознать сумму. Напиши расход текстом: «856 интернет»");
      }
      return;
    }
```

Note: `parseWriteoffPhoto` only handles images. A captioned PDF with a trigger is out of scope (PDFs are supplier POs); it falls through to the expense branch as today.

- [ ] **Step 4: Route text with a write-off trigger**

In `bot.on("message:text", ...)`, add the trigger check AFTER the `pendingPhoto` block and BEFORE the `looksLikeExpense` block (around line 474):

```ts
  // Write-off shortcut — works in groups without addressing the bot, same as
  // expenses. Checked before looksLikeExpense so "спиши ..." never lands as an
  // expense.
  if (hasWriteoffTrigger(text)) {
    const msg = await ctx.reply("Распознаю списание...");
    try {
      const extracted = await parseWriteoffText(text);
      await ctx.api.deleteMessage(chatId, msg.message_id);
      if (extracted) await startWriteoffFlow(chatId, extracted);
      else await ctx.reply("Не понял, что списать. Напиши: «спиши 2 просекко».");
    } catch (e) {
      console.error(e);
      await ctx.api.editMessageText(chatId, msg.message_id, "Ошибка при распознавании списания.");
    }
    return;
  }
```

- [ ] **Step 5: Add `/writeoffs` command**

After the `bot.command("sales", ...)` handler (around line 360), add:

```ts
bot.command("writeoffs", async (ctx) => {
  const pending = await listPending();
  if (pending.length === 0) {
    await ctx.reply("Всё списано, чисто 👍");
    return;
  }
  const today = todayInThailand();
  await ctx.reply(`🍷 Незакрытые списания (${pending.length}):`);
  for (const r of pending) {
    await ctx.reply(
      `📦 ${r.qty}× ${r.item_name}\n📅 ${r.taken_date} · ${ageLabel(r.taken_date, today)}` +
        (r.taken_by ? ` · ${r.taken_by}` : ""),
      { reply_markup: new (await import("grammy")).InlineKeyboard().text("✅ Списано", `wo_close:${r.id}`) },
    );
  }
});
```

- [ ] **Step 6: Add `handleWriteoffCallback` and route `wo_` callbacks**

Add the handler function after `handlePOCallback` (around line 593):

```ts
async function handleWriteoffCallback(ctx: any, chatId: number, data: string): Promise<void> {
  // wo_cancel | wo_pick:<qty>:<variant_id> | wo_confirm:<variant_id> | wo_close:<id>
  if (data === "wo_cancel") {
    await ctx.answerCallbackQuery("Отменено");
    await ctx.editMessageText("✖ Списание отменено.");
    return;
  }

  if (data.startsWith("wo_pick:")) {
    const [, qtyStr, variantId] = data.split(":");
    const qty = Number(qtyStr) || 1;
    const item = await findVariant(variantId);
    if (!item) {
      await ctx.answerCallbackQuery("Товар не найден — заведи заново.");
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      buildWriteoffMessage({ itemName: item.item_name, qty, date: bangkokDate() }),
      { parse_mode: "HTML", reply_markup: buildWriteoffKeyboard(item.variant_id) },
    );
    return;
  }

  if (data.startsWith("wo_confirm:")) {
    const variantId = data.slice("wo_confirm:".length);
    const card = parseWriteoffFromMessage(ctx.callbackQuery?.message?.text ?? "");
    if (!card) {
      await ctx.answerCallbackQuery("Не смог прочитать карточку — заведи заново.");
      return;
    }
    await ctx.answerCallbackQuery("Записываю...");
    const takenBy = ctx.from?.first_name ?? ctx.from?.username ?? "—";
    try {
      await insertWriteoff({
        variantId,
        itemName: card.itemName,
        qty: card.qty,
        takenDate: toISODateFromDDMMYYYY(card.date),
        takenBy,
      });
    } catch (e) {
      console.error("insertWriteoff failed:", e);
      try { await ctx.editMessageText("❌ Ошибка записи списания. Заведи заново."); } catch {}
      return;
    }
    try {
      await ctx.editMessageText(
        `✅ Записано в список на списание.\n\n📦 ${card.qty}× ${card.itemName}\n📅 ${card.date}\n\n` +
          `Когда сделаешь Stock Adjustment в Loyverse — жми «Списано» в /writeoffs.`,
      );
    } catch (e) { console.error("confirm edit failed:", e); }
    return;
  }

  if (data.startsWith("wo_close:")) {
    const id = data.slice("wo_close:".length);
    await ctx.answerCallbackQuery("Отмечаю...");
    const closedBy = ctx.from?.first_name ?? ctx.from?.username ?? "—";
    try {
      await closeWriteoff(id, closedBy);
    } catch (e) {
      console.error("closeWriteoff failed:", e);
      try { await ctx.editMessageText("❌ Не смог отметить. Попробуй ещё раз."); } catch {}
      return;
    }
    const base = (ctx.callbackQuery?.message?.text ?? "").split("\n")[0];
    try { await ctx.editMessageText(`✅ Списано: ${base.replace(/^📦\s*/, "")}`); } catch {}
    return;
  }

  await ctx.answerCallbackQuery();
}

// DD.MM.YYYY -> YYYY-MM-DD (card date is always well-formed; fall back to today).
function toISODateFromDDMMYYYY(d: string): string {
  const m = d.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : todayInThailand();
}
```

Then in `bot.on("callback_query:data", ...)`, add the route at the top of the body (right after `const data = ctx.callbackQuery.data;`, around line 599):

```ts
  if (data.startsWith("wo_")) { await handleWriteoffCallback(ctx, chatId, data); return; }
```

- [ ] **Step 7: Verify it compiles**

Run: `cd 01_agents/bot && npm run test`
Expected: PASS — no import/type errors surface through the test build; existing tests green.

- [ ] **Step 8: Commit**

```bash
git add 01_agents/bot/src/index.ts
git commit -m "feat(bot): wire write-off capture, picker, confirm, /writeoffs, close"
```

---

## Task 9: Append the reminder to the morning briefing

**Files:**
- Modify: `01_agents/bot/src/briefing.ts`

- [ ] **Step 1: Add imports + fetch pending**

At the top of `briefing.ts`, add:

```ts
import { listPending } from "./writeoff.js";
import { formatPendingReminder } from "./writeoff-parse.js";
```

In `generateMorningBriefing`, add `listPending()` to the `Promise.all` array and destructure it. Change the array (around lines 34-41) to include it:

```ts
  const [salesYesterday, salesLastWeek, salesTwoWeeksAgo, salesMonth, inventory, paymentAlerts, pendingWriteoffs] = await Promise.all([
    getSales(yesterday, yesterday),
    getSales(sameWeekdayLastWeek, sameWeekdayLastWeek),
    getSales(sameWeekdayTwoWeeksAgo, sameWeekdayTwoWeeksAgo),
    getSales(monthStart, yesterday),
    getInventorySummary(),
    getPaymentAlerts(3),
    listPending(),
  ]);
```

- [ ] **Step 2: Append the block to the returned message**

Change the final return (lines ~112-113) to:

```ts
  const paymentBlock = formatPaymentAlerts(paymentAlerts);
  const writeoffBlock = formatPendingReminder(pendingWriteoffs, today);
  const blocks = [briefing, paymentBlock, writeoffBlock].filter((b) => b && b.length > 0);
  return blocks.join("\n\n");
```

- [ ] **Step 3: Verify it compiles**

Run: `cd 01_agents/bot && npm run test`
Expected: PASS — existing tests green.

- [ ] **Step 4: Commit**

```bash
git add 01_agents/bot/src/briefing.ts
git commit -m "feat(bot): morning briefing reminds about open write-offs"
```

---

## Task 10: Portal — registry item, API route, page

**Files:**
- Modify: `02_services/mission-control/lib/registry.ts`
- Create: `02_services/mission-control/app/api/m/writeoffs/route.ts`
- Create: `02_services/mission-control/app/(portal)/m/writeoffs/page.tsx`

- [ ] **Step 1: Add the registry item under Operations**

In `lib/registry.ts`, immediately after the `purchase-orders` item (the block ending around line 150), add:

```ts
      {
        // Bottles taken "себе", pending a Loyverse Stock Adjustment. Filled by
        // the Chip & Dale bot (migration 038_stock_writeoffs); closed here or in
        // the bot once the adjustment is done. Bot never writes to Loyverse.
        slug: 'writeoffs', name: 'Write-offs', icon: '🍷', status: 'building',
        description: 'Списания «себе»: бутылки, ждущие Stock Adjustment в Loyverse. Заводит бот Chip & Dale, закрываем кнопкой когда сделали корректировку.',
        route: m('writeoffs'),
        embed: { kind: 'native' },
      },
```

- [ ] **Step 2: Create the API route**

Create `app/api/m/writeoffs/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { sbPublic } from '@/lib/supabase'

// GET /api/m/writeoffs?status=pending|all — list write-offs.
export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get('status') ?? 'pending'
  let q = sbPublic
    .from('stock_writeoffs')
    .select('id, variant_id, item_name, qty, taken_date, taken_by, status, closed_at, closed_by')
    .order('taken_date', { ascending: true })
  if (status !== 'all') q = q.eq('status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rows: data ?? [] })
}

// POST /api/m/writeoffs { id, closed_by? } — mark a write-off done.
export async function POST(req: Request) {
  const body = await req.json()
  const { id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await sbPublic
    .from('stock_writeoffs')
    .update({
      status: 'done',
      closed_at: new Date().toISOString(),
      closed_by: typeof body.closed_by === 'string' ? body.closed_by : 'portal',
    })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

If `sbPublic` is not the correct export name, mirror whatever `app/api/m/purchase-orders/route.ts` imports from `@/lib/supabase`.

- [ ] **Step 3: Create the page**

Create `app/(portal)/m/writeoffs/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

type Row = {
  id: string; item_name: string; qty: number; taken_date: string
  taken_by: string | null; status: string; closed_at: string | null; closed_by: string | null
}

function ageDays(takenDate: string): number {
  const a = new Date(takenDate + 'T12:00:00Z').getTime()
  const b = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z').getTime()
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

export default function WriteoffsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/m/writeoffs?status=${filter}`)
    const json = await res.json()
    setRows(json.rows ?? [])
    setLoading(false)
  }
  useEffect(() => { load() }, [filter])

  async function close(id: string) {
    await fetch('/api/m/writeoffs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    await load()
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>🍷 Write-offs — списания «себе»</h1>
      <p style={{ color: '#888', marginBottom: 16 }}>
        Bottles taken from stock, pending a Loyverse Stock Adjustment. Close a row once the adjustment is done.
      </p>

      <div style={{ marginBottom: 12 }}>
        <button onClick={() => setFilter('pending')} disabled={filter === 'pending'} style={{ marginRight: 8 }}>
          Pending
        </button>
        <button onClick={() => setFilter('all')} disabled={filter === 'all'}>All</button>
      </div>

      {loading ? <p>Loading…</p> : rows.length === 0 ? <p>Nothing here.</p> : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: 8 }}>Item</th>
              <th style={{ padding: 8 }}>Qty</th>
              <th style={{ padding: 8 }}>Date</th>
              <th style={{ padding: 8 }}>Age</th>
              <th style={{ padding: 8 }}>By</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: 8 }}>{r.item_name}</td>
                <td style={{ padding: 8 }}>{r.qty}</td>
                <td style={{ padding: 8 }}>{r.taken_date}</td>
                <td style={{ padding: 8 }}>{r.status === 'pending' ? `${ageDays(r.taken_date)}d` : '—'}</td>
                <td style={{ padding: 8 }}>{r.taken_by ?? '—'}</td>
                <td style={{ padding: 8 }}>{r.status === 'pending' ? '⏳ pending' : '✅ done'}</td>
                <td style={{ padding: 8 }}>
                  {r.status === 'pending' && <button onClick={() => close(r.id)}>✅ Списано</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Typecheck the portal**

Run: `cd 02_services/mission-control && npx tsc --noEmit`
Expected: PASS — no type errors. (If `sbPublic` was renamed in Step 2, fix and re-run.)

- [ ] **Step 5: Commit**

```bash
git add 02_services/mission-control/lib/registry.ts \
        02_services/mission-control/app/api/m/writeoffs/route.ts \
        "02_services/mission-control/app/(portal)/m/writeoffs/page.tsx"
git commit -m "feat(portal): /m/writeoffs — list and close stock write-offs"
```

---

## Task 11: Integration smoke test + full suite

**Files:** none (verification only)

- [ ] **Step 1: Run the full bot test suite**

Run: `cd 01_agents/bot && npm run test`
Expected: PASS — all `writeoff-parse` and `po-parse` tests green.

- [ ] **Step 2: Manual bot smoke (requires `.env.local` with live tokens)**

Run: `cd 01_agents/bot && npm run dev`

In the Telegram group, verify each path:
1. Text `спиши 2 <name of a real stock item>` → confident card OR candidate picker → pick → card → `✅ Записать` → "Записано".
2. `/writeoffs` → the item appears with a `✅ Списано` button → tap → "Списано".
3. `/writeoffs` again → item gone (or "Всё списано, чисто 👍").
4. Photo of a bottle + caption `спиши 1` → card appears (verify the label was matched).
5. Regression: a plain expense `856 интернет` still opens the expense card; a plain photo (no caption) still runs PO classification.
6. `/briefing` → the "🍷 Не списано" block appears while a pending row exists.

Expected: all six behave as described. Stop with Ctrl-C.

- [ ] **Step 3: Confirm the migration is applied**

Ask the user to run `038_stock_writeoffs.sql` in the Supabase SQL Editor (migrations are manual — `[[project_migrations_manual]]`). Without it, inserts fail with "relation stock_writeoffs does not exist".

- [ ] **Step 4: Final commit (if any smoke fixes were needed)**

```bash
git add -A 01_agents/bot 02_services/mission-control
git commit -m "fix(bot): write-off smoke-test corrections"
```

(Skip if no changes were needed.)

---

## Self-Review Notes

- **Spec coverage:** trigger/flexible input (Tasks 1,6,8), fuzzy match + picker (Tasks 2,6,8), card+confirm (Tasks 3,8), storage (Tasks 6,7), briefing reminder — all open, oldest first (Tasks 4,9), `/writeoffs` close (Task 8), portal (Task 10), manual-close-as-source-of-truth (Tasks 8,10). No auto-inference, no reasons, no Loyverse writes — all explicitly out of scope. ✅
- **Type consistency:** `WriteoffExtraction {query,qty}`, `Candidate`, `WriteoffCard {itemName,qty,date}`, `PendingRow` used identically across parse/side-effect/wiring tasks. Callback formats consistent: `wo_confirm:<variant_id>`, `wo_pick:<qty>:<variant_id>`, `wo_close:<id>`, `wo_cancel`. ✅
- **Deployment:** bot + portal both auto-deploy on push to `main` (Railway). This work is on branch `feat/po-scan-operator-workflow`; merge to `main` when ready.
