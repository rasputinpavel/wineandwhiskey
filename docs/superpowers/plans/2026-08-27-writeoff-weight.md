# Weight-based Write-offs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let write-offs handle weight-based food — record grams for Loyverse `sold_by_weight=true` items (sausages), and pick the correct weight-variant SKU for per-pack cheeses whose weight is in the item name.

**Architecture:** Thread two new values through the existing write-off pipeline: `sold_by_weight` (from Loyverse, decides grams-vs-pieces) and `weightGrams` (from the price-label photo via vision, or asked). Pure logic + tests live in `writeoff-parse.ts`; side-effects in `writeoff.ts`; wiring in `index.ts`; storage adds a nullable `weight_grams` column (migration 041) surfaced on the portal.

**Tech Stack:** TypeScript, grammy, `@anthropic-ai/sdk` (claude-sonnet-4-6), `@supabase/supabase-js`, Loyverse REST, vitest; Next.js portal.

**Spec:** `docs/superpowers/specs/2026-08-27-writeoff-weight-design.md`

**Branch/deploy:** Work directly on `main` (user's choice); each task commits locally, push at the end. Do NOT push mid-plan unless the final task says so. Migration `041` is applied manually by the user.

---

## Final type shapes (defined in Task 2, referenced everywhere)

```ts
// writeoff-parse.ts
export type WriteoffExtraction = { query: string; qty: number; weightGrams: number | null };
export type CatalogItem = { variant_id: string; item_name: string; in_stock: number; sold_by_weight: boolean };
export type Candidate = CatalogItem & { score: number };
export type WriteoffCard = { itemName: string; qty: number; weightGrams: number | null; date: string };
export type PendingRow = {
  id: string; item_name: string; qty: number; weight_grams: number | null;
  taken_date: string; taken_by: string | null; status: string;
};
```

Callback formats: `wo_confirm:<variant_id>`, `wo_pick:<qty>:<grams|->:<variant_id>`, `wo_close:<id>`, `wo_cancel`.

---

## Task 1: Loyverse `sold_by_weight` in the catalog

**Files:** Modify `01_agents/bot/src/loyverse.ts`

The `Item` interface at the top of the file has `item_name`, `category_id`, `deleted_at`, `variants`. Loyverse `/items` also returns a top-level boolean `sold_by_weight`. Add it to the `Item` interface and to `getCatalogItems`.

- [ ] **Step 1: Read the file**, confirm the `Item` interface and the `CatalogRow` type added earlier for `getCatalogItems`.

- [ ] **Step 2: Add `sold_by_weight` to the `Item` interface**

In the `interface Item { ... }` block add:
```ts
  sold_by_weight: boolean;
```

- [ ] **Step 3: Extend `CatalogRow` and the mapped row**

Change the `CatalogRow` type and the `.map(...)` in `getCatalogItems`:
```ts
type CatalogRow = { variant_id: string; item_name: string; in_stock: number; sold_by_weight: boolean };
```
and in the returned object add:
```ts
        sold_by_weight: item.sold_by_weight === true,
```

- [ ] **Step 4: Verify compile**

Run: `cd 01_agents/bot && npm run test`
Expected: existing tests still pass (this file isn't unit-tested, but the suite transpiles the import graph).

- [ ] **Step 5: Commit**

```bash
git add 01_agents/bot/src/loyverse.ts
git commit -m "feat(bot): expose sold_by_weight in Loyverse catalog"
```

---

## Task 2: Types + `parseWriteoffJSON` weight, fixtures green

**Files:** Modify `01_agents/bot/src/writeoff-parse.ts` + `01_agents/bot/src/writeoff-parse.test.ts`

This task adds the four new type fields and makes `parseWriteoffJSON` read `weight_grams`. Because the types gain required fields, several existing test fixtures must be updated so the suite stays green.

- [ ] **Step 1: Update the type declarations** in `writeoff-parse.ts` to exactly the shapes in "Final type shapes" above (`WriteoffExtraction`, `CatalogItem`, `Candidate`, `WriteoffCard`, `PendingRow`).

- [ ] **Step 2: Update `parseWriteoffJSON`** to read `weight_grams`:
```ts
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
```

- [ ] **Step 3: Update existing test fixtures** in `writeoff-parse.test.ts` so they compile and pass with the new shapes:
  - Every `parseWriteoffJSON(...)` `.toEqual({ query, qty })` assertion → add `weightGrams: null`. E.g. `toEqual({ query: "Prosecco Miravento", qty: 2, weightGrams: null })`, `toEqual({ query: "Beluga", qty: 1, weightGrams: null })`.
  - The `CATALOG` array used by `scoreCandidates` tests → add `sold_by_weight: false` to each object.
  - The candidate objects passed to `buildCandidatesKeyboard` and `isConfident` tests → add `sold_by_weight: false`.

- [ ] **Step 4: Add a new test** for weight parsing (append to the `parseWriteoffJSON` describe):
```ts
  it("reads weight_grams when present", () => {
    expect(parseWriteoffJSON('{"query":"Merguez","qty":1,"weight_grams":250}')).toEqual({
      query: "Merguez", qty: 1, weightGrams: 250,
    });
  });
  it("null weight_grams when absent or non-positive", () => {
    expect(parseWriteoffJSON('{"query":"Merguez","weight_grams":0}')).toEqual({
      query: "Merguez", qty: 1, weightGrams: null,
    });
  });
```

- [ ] **Step 5: Run tests**

Run: `cd 01_agents/bot && npm run test -- writeoff-parse`
Expected: PASS (all fixtures updated, new tests green).

- [ ] **Step 6: Commit**

```bash
git add 01_agents/bot/src/writeoff-parse.ts 01_agents/bot/src/writeoff-parse.test.ts
git commit -m "feat(bot): write-off types carry weightGrams + sold_by_weight; parse weight_grams"
```

---

## Task 3: Card shows weight; round-trip

**Files:** Modify `01_agents/bot/src/writeoff-parse.ts` + test

- [ ] **Step 1: Write failing tests** (append to `writeoff-parse.test.ts`, inside the existing "write-off card round-trip" describe):
```ts
  it("round-trips a weight card (grams instead of qty)", () => {
    const card = { itemName: "Merguez Sausage", qty: 1, weightGrams: 250, date: "27.08.2026" };
    const text = asDelivered(buildWriteoffMessage(card));
    expect(parseWriteoffFromMessage(text)).toEqual(card);
  });
```
Also update the existing "parses back the fields it renders" test's `card` object to include `weightGrams: null` (so it matches the new `WriteoffCard` shape and the parser's output).

- [ ] **Step 2: Run to verify fail**

Run: `cd 01_agents/bot && npm run test -- writeoff-parse`
Expected: FAIL (weight card not rendered/parsed yet; existing test may fail on the shape).

- [ ] **Step 3: Update `buildWriteoffMessage` and `parseWriteoffFromMessage`**:
```ts
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
```

- [ ] **Step 4: Run tests**

Run: `cd 01_agents/bot && npm run test -- writeoff-parse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 01_agents/bot/src/writeoff-parse.ts 01_agents/bot/src/writeoff-parse.test.ts
git commit -m "feat(bot): write-off card renders weight, round-trips grams"
```

---

## Task 4: Candidate keyboard carries grams; reminder shows weight

**Files:** Modify `01_agents/bot/src/writeoff-parse.ts` + test

- [ ] **Step 1: Write failing tests** (append):
```ts
  it("candidate keyboard carries qty + grams + variant_id", () => {
    const kb = buildCandidatesKeyboard(
      [{ variant_id: "v1", item_name: "146g Gruyere", in_stock: 1, sold_by_weight: false, score: 5 }],
      1, 146,
    );
    const flat = kb.inline_keyboard.flat();
    expect(flat.some((b: any) => b.callback_data === "wo_pick:1:146:v1")).toBe(true);
  });
  it("candidate keyboard uses '-' when no weight", () => {
    const kb = buildCandidatesKeyboard(
      [{ variant_id: "v1", item_name: "Prosecco", in_stock: 4, sold_by_weight: false, score: 5 }],
      2, null,
    );
    const flat = kb.inline_keyboard.flat();
    expect(flat.some((b: any) => b.callback_data === "wo_pick:2:-:v1")).toBe(true);
  });
```
And in the existing `formatPendingReminder` describe, add:
```ts
  it("shows grams for a weight-based pending row", () => {
    const out = formatPendingReminder(
      [{ id: "w", item_name: "Merguez Sausage", qty: 1, weight_grams: 250, taken_date: "2026-08-26", taken_by: "Grace", status: "pending" }],
      "2026-08-27",
    );
    expect(out).toContain("250 г Merguez Sausage");
    expect(out).not.toContain("1× Merguez");
  });
```
Also update the existing `formatPendingReminder` `rows` fixtures to include `weight_grams: null` on each row (new `PendingRow` shape).

- [ ] **Step 2: Run to verify fail**

Run: `cd 01_agents/bot && npm run test -- writeoff-parse`
Expected: FAIL (signature/format mismatch).

- [ ] **Step 3: Update `buildCandidatesKeyboard` and `formatPendingReminder`**:
```ts
export function buildCandidatesKeyboard(candidates: Candidate[], qty: number, weightGrams: number | null): InlineKeyboard {
  const g = weightGrams != null ? String(weightGrams) : "-";
  const kb = new InlineKeyboard();
  for (const c of candidates) {
    const label = `${c.item_name} (${c.in_stock} шт)`.slice(0, 60);
    kb.text(label, `wo_pick:${qty}:${g}:${c.variant_id}`).row();
  }
  kb.text("✖ Отмена", "wo_cancel");
  return kb;
}
```
In `formatPendingReminder`, change the line builder:
```ts
  const amount = (r: PendingRow) => (r.weight_grams != null ? `${r.weight_grams} г` : `${r.qty}×`);
  const lines = pending.map(
    (r) => `• ${amount(r)} ${escapeHtml(r.item_name)} — ${ageLabel(r.taken_date, today)}`,
  );
```

- [ ] **Step 4: Run tests**

Run: `cd 01_agents/bot && npm run test -- writeoff-parse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 01_agents/bot/src/writeoff-parse.ts 01_agents/bot/src/writeoff-parse.test.ts
git commit -m "feat(bot): candidate keyboard carries grams; reminder shows weight"
```

---

## Task 5: `writeoff.ts` — prompts, matchCatalog, insert, list

**Files:** Modify `01_agents/bot/src/writeoff.ts`

No unit test (side-effect layer); verified by compile + smoke.

- [ ] **Step 1: Update prompts** — add a `weight_grams` instruction to both `TEXT_PROMPT` and `PHOTO_PROMPT`. Append to `TEXT_PROMPT`:
```
+ `weight_grams — вес в граммах, если он ЯВНО указан с единицей (250г, 250 g, 250 грамм); голое небольшое число — это qty, не вес; если веса нет — не указывай. `
```
Append to `PHOTO_PROMPT`:
```
+ `weight_grams — вес в граммах с ценника, если он там напечатан (напр. 146g → 146); если веса не видно — не указывай. `
```
Update the JSON examples in each prompt to include the field where natural, e.g. photo example `{"query":"Merguez Sausage","qty":1,"weight_grams":250}`.

- [ ] **Step 2: `matchCatalog` accepts weight** — fold the weight into the search string so a weight-in-name SKU ranks:
```ts
export async function matchCatalog(query: string, weightGrams?: number | null): Promise<Candidate[]> {
  const catalog = await getCatalogItems();
  const q = weightGrams != null ? `${query} ${weightGrams}g` : query;
  return scoreCandidates(q, catalog);
}
```

- [ ] **Step 3: `findVariant` returns `sold_by_weight`** — its return type widens to include `sold_by_weight` (already present on catalog rows). Change the signature/return:
```ts
export async function findVariant(
  variantId: string,
): Promise<{ variant_id: string; item_name: string; in_stock: number; sold_by_weight: boolean } | null> {
  const catalog = await getCatalogItems();
  return catalog.find((c) => c.variant_id === variantId) ?? null;
}
```

- [ ] **Step 4: `insertWriteoff` writes weight** — add `weightGrams` to the arg and row:
```ts
export async function insertWriteoff(row: {
  variantId: string; itemName: string; qty: number; weightGrams: number | null; takenDate: string; takenBy: string;
}): Promise<void> {
  if (!supabase) throw new Error("Supabase не подключён (SUPABASE_URL/SUPABASE_SERVICE_KEY).");
  const ins = await supabase.from("stock_writeoffs").insert({
    variant_id: row.variantId || null,
    item_name: row.itemName,
    qty: row.qty,
    weight_grams: row.weightGrams,
    taken_date: row.takenDate,
    taken_by: row.takenBy || null,
    status: "pending",
  });
  if (ins.error) throw new Error(`DB insert failed: ${ins.error.message}`);
}
```

- [ ] **Step 5: `listPending` selects weight** — add `weight_grams` to the `.select(...)` string.

- [ ] **Step 6: Verify compile**

Run: `cd 01_agents/bot && npm run test` (suite transpiles imports)
Also: `npx tsc --noEmit --module nodenext --moduleResolution nodenext --esModuleInterop --skipLibCheck --target es2022 src/writeoff.ts` → no errors.

- [ ] **Step 7: Commit**

```bash
git add 01_agents/bot/src/writeoff.ts
git commit -m "feat(bot): write-off side-effects handle weight (prompts, match, insert, list)"
```

---

## Task 6: `index.ts` wiring — ask-grams flow, weight branch

**Files:** Modify `01_agents/bot/src/index.ts`

No unit test; verified by `tsc` + smoke. Read the file first.

- [ ] **Step 1: Add a `pendingWeight` state map** near the other pending maps (`pendingPhotos`, `pendingExpenses`):
```ts
// Weight items (sold_by_weight): after the item is chosen we ask "how many grams?"
// and complete the card from the next numeric reply. In-memory like pendingPhotos.
const pendingWeight = new Map<number, { variantId: string; itemName: string }>();
```

- [ ] **Step 2: Add two helpers** (near `startWriteoffFlow`):
```ts
async function sendWriteoffCard(
  chatId: number,
  card: { itemName: string; qty: number; weightGrams: number | null; date: string },
  variantId: string,
): Promise<void> {
  await bot.api.sendMessage(chatId, buildWriteoffMessage(card), {
    parse_mode: "HTML",
    reply_markup: buildWriteoffKeyboard(variantId),
  });
}

// Present a chosen catalog item: weight item with a known weight → card; weight
// item without a weight → ask for grams; piece item → card with qty.
async function presentChosenItem(
  chatId: number,
  item: { variant_id: string; item_name: string; sold_by_weight: boolean },
  qty: number,
  weightGrams: number | null,
): Promise<void> {
  if (item.sold_by_weight) {
    if (weightGrams != null) {
      await sendWriteoffCard(chatId, { itemName: item.item_name, qty: 1, weightGrams, date: bangkokDate() }, item.variant_id);
    } else {
      pendingWeight.set(chatId, { variantId: item.variant_id, itemName: item.item_name });
      await bot.api.sendMessage(chatId, `⚖️ Сколько грамм для ${item.item_name}? Напиши число.`);
    }
  } else {
    await sendWriteoffCard(chatId, { itemName: item.item_name, qty, weightGrams: null, date: bangkokDate() }, item.variant_id);
  }
}
```

- [ ] **Step 3: Update `startWriteoffFlow`** to take `weightGrams`, pass it to `matchCatalog`, and use `presentChosenItem` for the confident match:
```ts
async function startWriteoffFlow(
  chatId: number,
  extracted: { query: string; qty: number; weightGrams: number | null },
): Promise<void> {
  const candidates: Candidate[] = await matchCatalog(extracted.query, extracted.weightGrams);
  if (candidates.length === 0) {
    await bot.api.sendMessage(chatId, `🤔 Не нашёл «${extracted.query}» в каталоге. Напиши точнее название из Loyverse.`);
    return;
  }
  if (isConfident(candidates)) {
    await presentChosenItem(chatId, candidates[0], extracted.qty, extracted.weightGrams);
    return;
  }
  await bot.api.sendMessage(chatId, `🍷 Что списываем? Выбери:`, {
    reply_markup: buildCandidatesKeyboard(candidates, extracted.qty, extracted.weightGrams),
  });
}
```

- [ ] **Step 4: Handle the grams reply** — in `bot.on("message:text", ...)`, add a `pendingWeight` check at the very top of the handler body (before the `pendingPhoto` block):
```ts
  const pw = pendingWeight.get(chatId);
  if (pw) {
    const m = text.match(/(\d+)/);
    const grams = m ? Number(m[1]) : 0;
    if (!grams || grams <= 0) {
      await ctx.reply("Нужно число грамм, например 250.");
      return;
    }
    pendingWeight.delete(chatId);
    await sendWriteoffCard(chatId, { itemName: pw.itemName, qty: 1, weightGrams: grams, date: bangkokDate() }, pw.variantId);
    return;
  }
```

- [ ] **Step 5: Update `wo_pick`** in `handleWriteoffCallback` to parse grams and branch on `sold_by_weight`:
```ts
  if (data.startsWith("wo_pick:")) {
    const [, qtyStr, gStr, variantId] = data.split(":");
    const qty = Number(qtyStr) || 1;
    const weightGrams = gStr === "-" ? null : (Number(gStr) || null);
    await ctx.answerCallbackQuery("Загружаю…");
    try {
      const item = await findVariant(variantId);
      if (!item) {
        await ctx.editMessageText("Товар не найден в каталоге — заведи списание заново.");
        return;
      }
      if (item.sold_by_weight && weightGrams == null) {
        pendingWeight.set(chatId, { variantId: item.variant_id, itemName: item.item_name });
        await ctx.editMessageText(`⚖️ Сколько грамм для ${item.item_name}? Напиши число.`);
        return;
      }
      const card = {
        itemName: item.item_name,
        qty: item.sold_by_weight ? 1 : qty,
        weightGrams: item.sold_by_weight ? weightGrams : null,
        date: bangkokDate(),
      };
      await ctx.editMessageText(buildWriteoffMessage(card), {
        parse_mode: "HTML",
        reply_markup: buildWriteoffKeyboard(item.variant_id),
      });
    } catch (e) {
      console.error("wo_pick failed:", e);
      try { await ctx.editMessageText("❌ Ошибка при выборе товара. Заведи списание заново."); } catch {}
    }
    return;
  }
```

- [ ] **Step 6: Update `wo_confirm`** to store weight and show it. Where it builds the insert and the success message:
```ts
      await insertWriteoff({
        variantId,
        itemName: card.itemName,
        qty: card.qty,
        weightGrams: card.weightGrams,
        takenDate: toISODate(card.date) ?? todayInThailand(),
        takenBy,
      });
```
and the success `editMessageText` amount line:
```ts
      const amount = card.weightGrams != null ? `${card.weightGrams} г` : `${card.qty}×`;
      await ctx.editMessageText(
        `✅ Записано в список на списание.\n\n📦 ${amount} ${card.itemName}\n📅 ${card.date}\n\n` +
          `Когда сделаешь Stock Adjustment в Loyverse — жми «Списано» в /writeoffs.`,
      );
```

- [ ] **Step 7: Update `/writeoffs` command display** — the per-row line:
```ts
    const amount = r.weight_grams != null ? `${r.weight_grams} г` : `${r.qty}×`;
    await ctx.reply(
      `📦 ${amount} ${r.item_name}\n📅 ${r.taken_date} · ${ageLabel(r.taken_date, today)}` +
        (r.taken_by ? ` · ${r.taken_by}` : ""),
      { reply_markup: new InlineKeyboard().text("✅ Списано", `wo_close:${r.id}`) },
    );
```

- [ ] **Step 8: Verify**

Run: `cd 01_agents/bot && npm run test` (41+ pass)
Run: `npx tsc --noEmit --module nodenext --moduleResolution nodenext --esModuleInterop --skipLibCheck --target es2022 src/index.ts` → no errors.

- [ ] **Step 9: Commit**

```bash
git add 01_agents/bot/src/index.ts
git commit -m "feat(bot): wire weight into write-off flow (ask grams, pick, confirm, list)"
```

---

## Task 7: Migration 041 + portal display

**Files:** Create `02_services/mission-control/supabase/migrations/041_writeoff_weight.sql`; modify `app/api/m/writeoffs/route.ts` + `app/(portal)/m/writeoffs/page.tsx`

- [ ] **Step 1: Create the migration**
```sql
-- 041_writeoff_weight.sql
-- Weight-based write-offs: sold_by_weight items (sausages) record grams instead
-- of pieces. Null for piece items (incl. per-pack cheese SKUs whose weight is in
-- the name). Apply manually in the Supabase SQL Editor.

alter table public.stock_writeoffs
  add column if not exists weight_grams integer;
```

- [ ] **Step 2: API GET select** — add `weight_grams` to the `.select(...)` in `app/api/m/writeoffs/route.ts` GET.

- [ ] **Step 3: Portal page** — in `app/(portal)/m/writeoffs/page.tsx`: add `weight_grams: number | null` to the `Row` type, and render the Qty cell as weight when present:
```tsx
                <td className="py-2 pr-4 text-right">{r.weight_grams != null ? `${r.weight_grams} г` : r.qty}</td>
```

- [ ] **Step 4: Typecheck**

Run: `cd 02_services/mission-control && npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add "02_services/mission-control/supabase/migrations/041_writeoff_weight.sql" \
        "02_services/mission-control/app/api/m/writeoffs/route.ts" \
        "02_services/mission-control/app/(portal)/m/writeoffs/page.tsx"
git commit -m "feat(portal): weight_grams column (migration 041) + weight display on /m/writeoffs"
```

---

## Task 8: Verify, push, smoke

**Files:** none (verification)

- [ ] **Step 1: Full bot suite** — `cd 01_agents/bot && npm run test` → all pass.
- [ ] **Step 2: Portal typecheck** — `cd 02_services/mission-control && npx tsc --noEmit` → clean.
- [ ] **Step 3: Push** — `git push origin main` (deploys bot + portal).
- [ ] **Step 4: Ask the user to apply migration 041** in the Supabase SQL Editor (manual; without it, inserts with `weight_grams` fail — though `listPending` degrades gracefully).
- [ ] **Step 5: Manual smoke** (after deploy + migration): 
  1. Photo of a sausage price label + «спиши» → card shows «⚖️ Вес: N г» (or bot asks grams if not read) → confirm.
  2. Photo of a «146g Gruyere» pack + «спиши» → the 146g SKU is the confident/top match → card → confirm.
  3. Text «спиши мергез 250г» → weight card.
  4. Regression: «спиши 2 просекко» → qty=2 card (not grams); plain expense/PO flows unchanged.
  5. `/writeoffs` and portal `/m/writeoffs` show «250 г» for weight rows.

---

## Self-Review Notes

- **Spec coverage:** sold_by_weight detection (Task 1), weight parse from photo/text (Tasks 2,5), grams-vs-pieces card (Task 3), weight-in-query matching for cheese SKUs (Task 5 matchCatalog), ask-grams flow (Task 6 pendingWeight), display in card/reminder/`/writeoffs`/portal (Tasks 3,4,6,7), storage (Tasks 5,7). ✅
- **Type consistency:** `weightGrams` (camel, in-code) vs `weight_grams` (snake, DB/PendingRow/JSON) used consistently. Callback `wo_pick:<qty>:<grams|->:<variant_id>` produced by `buildCandidatesKeyboard` (Task 4) and parsed in `wo_pick` (Task 6) — 4 parts, variant_id last, UUID has no colon. `presentChosenItem`/`sendWriteoffCard` defined Task 6, used Task 6. ✅
- **Fixture ripple:** Task 2 explicitly updates all existing fixtures for the new required fields so the suite never goes red between tasks.
