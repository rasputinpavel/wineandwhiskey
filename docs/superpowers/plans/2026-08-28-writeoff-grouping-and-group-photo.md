# Reminder Grouping + Group-Photo Write-offs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Group identical item names into one line in the morning "не списано" reminder; (B) let one photo of several bottles write them all off via a single summary card.

**Architecture:** Pure logic + tests in `writeoff-parse.ts` (grouping, JSON-array parse, group card/keyboard); a multi-item vision call in `writeoff.ts`; group flow + in-memory `pendingGroup` state wired in `index.ts`. No migration (uses existing `stock_writeoffs` columns).

**Tech Stack:** TypeScript, grammy, `@anthropic-ai/sdk` (claude-sonnet-4-6), `@supabase/supabase-js`, vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-writeoff-grouping-and-group-photo-design.md`

**Deploy:** Directly on `main` (user's choice), no migration. Commit locally per task; push at the end.

---

## Task 1: Group identical names in the reminder (A)

**Files:** Modify `01_agents/bot/src/writeoff-parse.ts` + `01_agents/bot/src/writeoff-parse.test.ts`

- [ ] **Step 1: Write failing tests** (append to `writeoff-parse.test.ts`):
```ts
import { groupPending } from "./writeoff-parse.js";

describe("groupPending", () => {
  it("sums qty for identical piece item names, oldest first", () => {
    const rows = [
      { id: "a", item_name: "Prosecco", qty: 2, weight_grams: null, taken_date: "2026-08-20", taken_by: "G", status: "pending" },
      { id: "b", item_name: "Prosecco", qty: 1, weight_grams: null, taken_date: "2026-08-18", taken_by: "S", status: "pending" },
      { id: "c", item_name: "Beluga",   qty: 1, weight_grams: null, taken_date: "2026-08-19", taken_by: "G", status: "pending" },
    ];
    const g = groupPending(rows);
    expect(g.map((x) => x.item_name)).toEqual(["Prosecco", "Beluga"]); // Prosecco oldest (18th) first
    expect(g[0]).toMatchObject({ item_name: "Prosecco", qty: 3, weight_grams: null, oldest: "2026-08-18" });
  });
  it("sums grams for identical weight item names", () => {
    const rows = [
      { id: "a", item_name: "Merguez", qty: 1, weight_grams: 250, taken_date: "2026-08-20", taken_by: "G", status: "pending" },
      { id: "b", item_name: "Merguez", qty: 1, weight_grams: 300, taken_date: "2026-08-21", taken_by: "G", status: "pending" },
    ];
    const g = groupPending(rows);
    expect(g[0]).toMatchObject({ item_name: "Merguez", weight_grams: 550, oldest: "2026-08-20" });
  });
  it("ignores non-pending rows", () => {
    const rows = [
      { id: "a", item_name: "X", qty: 1, weight_grams: null, taken_date: "2026-08-20", taken_by: null, status: "done" },
    ];
    expect(groupPending(rows)).toEqual([]);
  });
});

describe("formatPendingReminder grouping", () => {
  it("collapses duplicates into one line", () => {
    const rows = [
      { id: "a", item_name: "Prosecco", qty: 2, weight_grams: null, taken_date: "2026-08-20", taken_by: "G", status: "pending" },
      { id: "b", item_name: "Prosecco", qty: 1, weight_grams: null, taken_date: "2026-08-18", taken_by: "S", status: "pending" },
    ];
    const out = formatPendingReminder(rows, "2026-08-27");
    expect(out).toContain("3× Prosecco");
    expect(out).toContain("Не списано (1)"); // one group
    expect((out.match(/Prosecco/g) || []).length).toBe(1); // single line
  });
});
```

- [ ] **Step 2: Run to verify fail** — `cd 01_agents/bot && npm run test -- writeoff-parse` → the `groupPending` tests fail (not exported), the collapse test fails (currently one line per row).

- [ ] **Step 3: Implement** — add `groupPending` and rewrite `formatPendingReminder` to use it:
```ts
export function groupPending(
  rows: PendingRow[],
): { item_name: string; qty: number; weight_grams: number | null; oldest: string }[] {
  const map = new Map<string, { item_name: string; qty: number; weight_grams: number | null; oldest: string }>();
  for (const r of rows.filter((x) => x.status === "pending")) {
    const g = map.get(r.item_name);
    if (!g) {
      map.set(r.item_name, { item_name: r.item_name, qty: r.qty, weight_grams: r.weight_grams, oldest: r.taken_date });
    } else {
      g.qty += r.qty;
      if (r.weight_grams != null) g.weight_grams = (g.weight_grams ?? 0) + r.weight_grams;
      if (r.taken_date < g.oldest) g.oldest = r.taken_date;
    }
  }
  return [...map.values()].sort((a, b) => a.oldest.localeCompare(b.oldest));
}

export function formatPendingReminder(rows: PendingRow[], today: string): string {
  const groups = groupPending(rows);
  if (groups.length === 0) return "";
  const amount = (g: { qty: number; weight_grams: number | null }) =>
    g.weight_grams != null ? `${g.weight_grams} г` : `${g.qty}×`;
  const lines = groups.map(
    (g) => `• ${amount(g)} ${escapeHtml(g.item_name)} — ${ageLabel(g.oldest, today)}`,
  );
  return [
    `🍷 <b>Не списано (${groups.length}):</b>`,
    ...lines,
    `Закрой через /writeoffs, когда сделаешь Stock Adjustment в Loyverse.`,
  ].join("\n");
}
```

- [ ] **Step 4: Run tests** — `npm run test -- writeoff-parse` → ALL pass (existing reminder tests use distinct names so they still hold: 2 names → "(2)", each its own line). Paste summary.

- [ ] **Step 5: Commit**
```bash
git add 01_agents/bot/src/writeoff-parse.ts 01_agents/bot/src/writeoff-parse.test.ts
git commit -m "feat(bot): group identical item names in the write-off reminder"
```

---

## Task 2: Group-photo pure logic — array parse, card, keyboard (B)

**Files:** Modify `01_agents/bot/src/writeoff-parse.ts` + `01_agents/bot/src/writeoff-parse.test.ts`

- [ ] **Step 1: Write failing tests** (append):
```ts
import { parseWriteoffJSONArray, buildGroupMessage, buildGroupKeyboard, type GroupItem } from "./writeoff-parse.js";

describe("parseWriteoffJSONArray", () => {
  it("parses an array of items", () => {
    expect(parseWriteoffJSONArray('[{"query":"Prosecco","qty":1},{"query":"Rioja","qty":2}]')).toEqual([
      { query: "Prosecco", qty: 1, weightGrams: null },
      { query: "Rioja", qty: 2, weightGrams: null },
    ]);
  });
  it("skips empty-query items and strips fences", () => {
    expect(parseWriteoffJSONArray('```json\n[{"query":""},{"query":"Beluga"}]\n```')).toEqual([
      { query: "Beluga", qty: 1, weightGrams: null },
    ]);
  });
  it("returns [] for non-array or garbage", () => {
    expect(parseWriteoffJSONArray('{"query":"x"}')).toEqual([]);
    expect(parseWriteoffJSONArray("nope")).toEqual([]);
  });
});

describe("buildGroupMessage / buildGroupKeyboard", () => {
  const items: GroupItem[] = [
    { variantId: "v1", itemName: "Prosecco Miravento", qty: 1 },
    { variantId: "v2", itemName: "Rioja Reserva", qty: 2 },
  ];
  it("lists items and unresolved", () => {
    const msg = buildGroupMessage(items, ["Chateau X"]);
    expect(msg).toContain("1× Prosecco Miravento");
    expect(msg).toContain("2× Rioja Reserva");
    expect(msg).toContain("не распознал уверенно: Chateau X");
  });
  it("omits the unresolved line when none", () => {
    expect(buildGroupMessage(items, [])).not.toContain("не распознал");
  });
  it("keyboard carries confirm/cancel", () => {
    const flat = buildGroupKeyboard().inline_keyboard.flat();
    expect(flat.some((b: any) => b.callback_data === "wo_group_confirm")).toBe(true);
    expect(flat.some((b: any) => b.callback_data === "wo_group_cancel")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm run test -- writeoff-parse` → new tests fail (symbols not exported).

- [ ] **Step 3: Implement** (append to `writeoff-parse.ts`):
```ts
export type GroupItem = { variantId: string; itemName: string; qty: number };

// Parse a JSON ARRAY of write-off items (group photo). Each element goes through
// the same field logic as parseWriteoffJSON; empty-query elements are dropped.
export function parseWriteoffJSONArray(raw: string): WriteoffExtraction[] {
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const arr = JSON.parse(clean);
    if (!Array.isArray(arr)) return [];
    const out: WriteoffExtraction[] = [];
    for (const j of arr) {
      const query = j?.query ? String(j.query).trim() : "";
      if (!query) continue;
      const qtyNum = Number(j?.qty);
      const qty = Number.isFinite(qtyNum) && qtyNum > 0 ? Math.max(1, Math.round(qtyNum)) : 1;
      const wNum = Number(j?.weight_grams);
      const weightGrams = Number.isFinite(wNum) && wNum > 0 ? Math.round(wNum) : null;
      out.push({ query, qty, weightGrams });
    }
    return out;
  } catch {
    return [];
  }
}

// Summary card for a group write-off. No round-trip: the item list lives in the
// bot's in-memory pendingGroup (variant_ids don't fit in callback data), so this
// is display-only; confirm reads pendingGroup, not this text.
export function buildGroupMessage(items: GroupItem[], unresolved: string[]): string {
  const lines = items.map((i) => `• ${i.qty}× ${escapeHtml(i.itemName)}`);
  const parts = [`🍷 <b>Списание группой — проверь:</b>`, ``, ...lines];
  if (unresolved.length) {
    parts.push(``, `⚠️ не распознал уверенно: ${unresolved.map(escapeHtml).join(", ")} — заведи по одному`);
  }
  return parts.join("\n");
}

export function buildGroupKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Записать всё", "wo_group_confirm")
    .text("✖ Отмена", "wo_group_cancel");
}
```

- [ ] **Step 4: Run tests** — `npm run test -- writeoff-parse` → ALL pass. Paste summary.

- [ ] **Step 5: Commit**
```bash
git add 01_agents/bot/src/writeoff-parse.ts 01_agents/bot/src/writeoff-parse.test.ts
git commit -m "feat(bot): group-photo pure logic — array parse, summary card, keyboard"
```

---

## Task 3: Multi-item vision parse (B)

**Files:** Modify `01_agents/bot/src/writeoff.ts`

No unit test (side-effect). Read the file first (it has `parseWriteoffPhoto`, `PHOTO_PROMPT`, the Anthropic client, and imports from `./writeoff-parse.js`).

- [ ] **Step 1: Add `parseWriteoffPhotoMulti`** (and import `parseWriteoffJSONArray`). Add `parseWriteoffJSONArray` to the existing import from `./writeoff-parse.js`. Add the prompt + function:
```ts
const PHOTO_MULTI_PROMPT =
  `На фото — одна или НЕСКОЛЬКО бутылок/этикеток алкоголя, которые сотрудник забрал себе и хочет списать. ` +
  `Распознай КАЖДУЮ отдельную позицию и верни JSON-МАССИВ, по одному объекту на каждый распознанный товар. ` +
  `Каждый объект: query — краткое название для поиска по каталогу; qty — сколько ОДИНАКОВЫХ бутылок этого товара видно (иначе 1); ` +
  `weight_grams — вес в граммах с ценника, если напечатан, иначе не указывай. ` +
  `Если на фото одна бутылка — массив из одного объекта. ` +
  `Ответь ТОЛЬКО валидным JSON-массивом без markdown. ` +
  `Пример: [{"query":"Prosecco Miravento","qty":1},{"query":"Rioja Reserva","qty":2}].`;

// Vision parse for a (possibly multi-bottle) photo → array of items. One element
// → single write-off flow; several → group flow.
export async function parseWriteoffPhotoMulti(
  base64: string,
  mime: "image/jpeg" | "image/png",
  caption: string,
): Promise<WriteoffExtraction[]> {
  const source = { type: "base64" as const, media_type: mime, data: base64 };
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    messages: [{
      role: "user",
      content: [
        { type: "image", source },
        { type: "text", text: `${PHOTO_MULTI_PROMPT}\n\nПодпись пользователя: ${caption || "(нет)"}` },
      ],
    }],
  });
  const raw = response.content.find((b) => b.type === "text")?.text ?? "";
  return parseWriteoffJSONArray(raw);
}
```
(Leave the existing `parseWriteoffPhoto` in place — index.ts will stop using it in Task 4; it's harmless if left. Do not delete it in this task to keep the build green between tasks.)

- [ ] **Step 2: Verify compile**

Run: `cd 01_agents/bot && npm run test` (suite transpiles imports)
Run: `npx tsc --noEmit --module nodenext --moduleResolution nodenext --esModuleInterop --skipLibCheck --target es2022 src/writeoff.ts` → no errors.

- [ ] **Step 3: Commit**
```bash
git add 01_agents/bot/src/writeoff.ts
git commit -m "feat(bot): multi-item vision parse for group-photo write-offs"
```

---

## Task 4: Wire group flow into `index.ts` (B)

**Files:** Modify `01_agents/bot/src/index.ts`. Read it first. No unit test; verify with `tsc`.

- [ ] **Step 1: Imports** — add `buildGroupMessage, buildGroupKeyboard, type GroupItem` to the import from `./writeoff-parse.js`; add `parseWriteoffPhotoMulti` to the import from `./writeoff.js`.

- [ ] **Step 2: Add `pendingGroup` map** (near `pendingWeight`):
```ts
// A group-photo write-off in progress: the confirmed items, held in memory
// because N variant_ids don't fit in callback data. Restart loses it (rare).
const pendingGroup = new Map<number, GroupItem[]>();
```

- [ ] **Step 3: Add `startGroupWriteoffFlow`** (near `startWriteoffFlow`):
```ts
// Match each recognized bottle; confident piece matches go into the summary,
// everything else (ambiguous / not found / weight item) is listed to enter by hand.
async function startGroupWriteoffFlow(
  chatId: number,
  extractions: { query: string; qty: number; weightGrams: number | null }[],
): Promise<void> {
  const byVariant = new Map<string, GroupItem>();
  const unresolved: string[] = [];
  for (const ex of extractions) {
    const cands = await matchCatalog(ex.query, ex.weightGrams);
    if (cands.length > 0 && isConfident(cands) && !cands[0].sold_by_weight) {
      const c = cands[0];
      const g = byVariant.get(c.variant_id);
      if (g) g.qty += ex.qty;
      else byVariant.set(c.variant_id, { variantId: c.variant_id, itemName: c.item_name, qty: ex.qty });
    } else {
      unresolved.push(ex.query);
    }
  }
  const items = [...byVariant.values()];
  if (items.length === 0) {
    await bot.api.sendMessage(chatId, `🤔 Не распознал уверенно ни одной позиции. Заведи по одной: ${unresolved.join(", ")}`);
    return;
  }
  pendingGroup.set(chatId, items);
  await bot.api.sendMessage(chatId, buildGroupMessage(items, unresolved), {
    parse_mode: "HTML",
    reply_markup: buildGroupKeyboard(),
  });
}
```

- [ ] **Step 4: Route photos through the multi parse.** In `bot.on("message:photo", ...)`, in the `if (hasWriteoffTrigger(caption)) { ... }` branch, replace the single-parse body with:
```ts
      if (hasWriteoffTrigger(caption)) {
        const items = await parseWriteoffPhotoMulti(photo.base64, photo.mimeType as "image/jpeg" | "image/png", caption);
        await ctx.api.deleteMessage(chatId, waitMsg.message_id);
        if (items.length === 0) await ctx.reply("Не понял, что списать. Напиши: «спиши 2 просекко».");
        else if (items.length === 1) await startWriteoffFlow(chatId, items[0]);
        else await startGroupWriteoffFlow(chatId, items);
        return;
      }
```
And in the `message:text` **pendingPhoto** block, the write-off branch that currently calls `parseWriteoffPhoto` — replace with the same 0/1/many dispatch:
```ts
    if (hasWriteoffTrigger(text)) {
      const wmsg = await ctx.reply("Распознаю списание...");
      try {
        const items = await parseWriteoffPhotoMulti(pendingPhoto.base64, pendingPhoto.mimeType, text);
        await ctx.api.deleteMessage(chatId, wmsg.message_id);
        if (items.length === 0) await ctx.reply("Не понял, что списать. Пришли фото ещё раз с подписью «спиши 2».");
        else if (items.length === 1) await startWriteoffFlow(chatId, items[0]);
        else await startGroupWriteoffFlow(chatId, items);
      } catch (e) {
        console.error(e);
        await ctx.api.editMessageText(chatId, wmsg.message_id, "Ошибка при распознавании списания.");
      }
      return;
    }
```
(Read the current pendingPhoto write-off branch and replace it in place, preserving the surrounding variable names.)

- [ ] **Step 5: Add group callbacks** in `handleWriteoffCallback` (place these exact-match checks near the top, before the `wo_pick:`/`wo_confirm:` prefix checks):
```ts
  if (data === "wo_group_cancel") {
    pendingGroup.delete(chatId);
    await ctx.answerCallbackQuery("Отменено");
    await ctx.editMessageText("✖ Групповое списание отменено.");
    return;
  }
  if (data === "wo_group_confirm") {
    const items = pendingGroup.get(chatId);
    if (!items || items.length === 0) {
      await ctx.answerCallbackQuery("Группа устарела — отправь фото снова.");
      return;
    }
    await ctx.answerCallbackQuery("Записываю…");
    const takenBy = ctx.from?.first_name ?? ctx.from?.username ?? "—";
    const takenDate = todayInThailand();
    try {
      for (const it of items) {
        await insertWriteoff({ variantId: it.variantId, itemName: it.itemName, qty: it.qty, weightGrams: null, takenDate, takenBy });
      }
    } catch (e) {
      console.error("group confirm failed:", e);
      try { await ctx.editMessageText("❌ Ошибка записи группы. Попробуй снова."); } catch {}
      return;
    }
    pendingGroup.delete(chatId);
    try {
      await ctx.editMessageText(
        `✅ Записано: ${items.length} ${items.length === 1 ? "позиция" : "позиций"}.\n\n` +
          `Когда сделаешь Stock Adjustment в Loyverse — жми «Списано» в /writeoffs.`,
      );
    } catch {}
    return;
  }
```

- [ ] **Step 6: Verify**

Run: `cd 01_agents/bot && npm run test` → existing tests pass.
Run: `npx tsc --noEmit --module nodenext --moduleResolution nodenext --esModuleInterop --skipLibCheck --target es2022 src/index.ts` → no errors. Paste exit status.

- [ ] **Step 7: Commit**
```bash
git add 01_agents/bot/src/index.ts
git commit -m "feat(bot): wire group-photo write-off flow (summary card, record all)"
```

---

## Task 5: Verify, push, smoke

**Files:** none.

- [ ] **Step 1: Full bot suite** — `cd 01_agents/bot && npm run test` → all pass.
- [ ] **Step 2: Typechecks** — `npx tsc --noEmit --module nodenext --moduleResolution nodenext --esModuleInterop --skipLibCheck --target es2022 src/index.ts src/writeoff.ts src/writeoff-parse.ts src/briefing.ts` → clean.
- [ ] **Step 3: Push** — `git push origin main` (deploys bot; no migration needed).
- [ ] **Step 4: Manual smoke** (after deploy):
  1. Morning reminder / `/briefing`: two write-offs of the same item show ONE line with summed qty (e.g. «3× Prosecco»).
  2. Photo of several different bottles + «спиши» → summary card lists all → «Записать всё» → `/writeoffs` shows each as its own row.
  3. Group photo where one bottle is unclear → summary lists the confident ones + «не распознал уверенно: … — заведи по одному».
  4. Regression: single-bottle photo + «спиши» → single card (unchanged); text «спиши 2 просекко» unchanged.

---

## Self-Review Notes
- **Spec coverage:** grouping (Task 1), array parse + summary card + keyboard (Task 2), multi vision (Task 3), auto 0/1/many dispatch + group flow + confirm/cancel + in-memory pendingGroup (Task 4). No migration (spec says none). ✅
- **Type consistency:** `GroupItem {variantId,itemName,qty}` defined Task 2, used Tasks 2/4. `parseWriteoffPhotoMulti` returns `WriteoffExtraction[]` (Task 3), consumed Task 4. Callbacks `wo_group_confirm`/`wo_group_cancel` are exact-match (no colon), distinct from `wo_cancel`/`wo_confirm:`/`wo_pick:` — routed under the existing `data.startsWith("wo_")` dispatch. ✅
- **Green between tasks:** `parseWriteoffPhoto` left in place until index stops using it (Task 4); no task leaves a broken build.
