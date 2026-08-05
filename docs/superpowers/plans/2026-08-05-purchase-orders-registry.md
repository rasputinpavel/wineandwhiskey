# Purchase Orders Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Chip & Dale Telegram bot recognize a photographed supplier purchase order, extract supplier / date / doc number / amount, store the scan in Supabase Storage, write a row to `public.po_scans`, and surface everything on a searchable portal page so a scan can be retrieved in seconds.

**Architecture:** Two subsystems over one shared Supabase. (1) Bot: a new `message:photo` branch classifies the image as a supplier PO via Claude vision, shows a confirmation card, and on confirm uploads the scan to the private `po-scans` bucket + inserts a row. (2) Portal (mission-control): a native read-only page at `/m/purchase-orders` lists rows with search by supplier/number and a date filter, opening each scan via a signed URL. A new `public.po_scans` table (migration 037) — deliberately separate from the existing scraper-owned `public.purchase_orders`.

**Tech Stack:** grammy + @anthropic-ai/sdk + @supabase/supabase-js (bot, tsx/ESM); Next.js App Router + @supabase/supabase-js + Tailwind (portal); Supabase Postgres + Storage; vitest for unit tests.

---

## File Structure

**Database**
- Create: `02_services/mission-control/supabase/migrations/037_po_scans.sql` — the `po_scans` table + indexes.

**Bot** (`01_agents/bot/`)
- Create: `src/db.ts` — one shared Supabase client + bucket name.
- Create: `src/po-parse.ts` — pure, env-free logic: types, JSON/extract parsing, date conversion, card + keyboard builders. Unit-tested.
- Create: `src/po.ts` — network side: classify+extract (Claude vision), duplicate check, save (Storage upload + DB insert).
- Create: `src/po-parse.test.ts` — vitest unit tests for the pure helpers.
- Modify: `src/index.ts` — branch the photo handler into PO-first; add a `po_` callback handler.
- Modify: `package.json` — add vitest devDep + `test` script.

**Portal** (`02_services/mission-control/`)
- Modify: `lib/supabase.ts` — add the `PoScan` type.
- Create: `lib/po/scans.ts` — signed-URL helper for the `po-scans` bucket.
- Modify: `lib/registry.ts` — add the `purchase-orders` nav item.
- Create: `app/(portal)/m/purchase-orders/page.tsx` — the searchable list page.

**Manual steps (done by the user, outside code)** — see the final section.

---

## Task 1: Migration for `public.po_scans`

**Files:**
- Create: `02_services/mission-control/supabase/migrations/037_po_scans.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 037_po_scans.sql
-- Purchase Order scan archive. Managers photograph the paper PO that arrives
-- with each supplier shipment; the Chip & Dale Telegram bot extracts the key
-- fields and stores the scan in the private `po-scans` Storage bucket. The
-- paper original still goes to bookkeeping — this is the store's own copy,
-- retrievable when a supplier later asks "which invoice was this against?".
--
-- DELIBERATELY SEPARATE from public.purchase_orders (that table is owned by the
-- cost scraper 03_automation/scrape_purchase_orders.ts). Do not merge the two.
--
-- The private Storage bucket `po-scans` must be created once in Supabase Studio.

create table if not exists public.po_scans (
  id            uuid primary key default gen_random_uuid(),
  supplier      text,                         -- normalized supplier name
  supplier_raw  text,                         -- as written on the document
  doc_number    text,                         -- Purchase No. / invoice number
  order_date    date,                         -- date printed on the document
  received_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  amount_total  numeric(12,2),                -- total incl. VAT, THB
  scan_path     text not null,                -- object path in bucket `po-scans`
  note          text,
  uploaded_by   text,                         -- Telegram name of the manager
  created_at    timestamptz not null default now()
);

create index if not exists po_scans_supplier_idx   on public.po_scans (lower(supplier));
create index if not exists po_scans_doc_number_idx  on public.po_scans (doc_number);
create index if not exists po_scans_order_date_idx   on public.po_scans (order_date desc);
```

- [ ] **Step 2: Commit**

```bash
git add 02_services/mission-control/supabase/migrations/037_po_scans.sql
git commit -m "feat(po-scans): migration 037 — PO scan archive table"
```

> **Note:** migrations are applied manually by the user in the Supabase SQL Editor (project convention — the service key is PostgREST, not DDL). No code applies this. `public` is already an exposed schema, so no settings change is needed.

---

## Task 2: `PoScan` type in the portal

**Files:**
- Modify: `02_services/mission-control/lib/supabase.ts` (append after the existing `public.purchase_orders` types block)

- [ ] **Step 1: Add the type**

Append this block right after the `PurchaseOrderItem` type definition:

```ts
// ─── public.po_scans (PO scan archive, migration 037) ────────────────────
// SEPARATE from purchase_orders above. Rows are written by the Chip & Dale bot
// from a photographed supplier PO. Scans live in the private `po-scans` bucket.

export type PoScan = {
  id: string
  supplier: string | null
  supplier_raw: string | null
  doc_number: string | null
  order_date: string | null       // 'YYYY-MM-DD'
  received_date: string | null    // 'YYYY-MM-DD'
  amount_total: number | null
  scan_path: string               // object path in the `po-scans` bucket
  note: string | null
  uploaded_by: string | null
  created_at: string
}
```

- [ ] **Step 2: Type-check compiles**

Run: `cd 02_services/mission-control && npx tsc --noEmit`
Expected: no new errors referencing `supabase.ts`.

- [ ] **Step 3: Commit**

```bash
git add 02_services/mission-control/lib/supabase.ts
git commit -m "feat(po-scans): PoScan type"
```

---

## Task 3: Signed-URL helper

**Files:**
- Create: `02_services/mission-control/lib/po/scans.ts`

- [ ] **Step 1: Write the helper**

```ts
import { sbPublic } from '@/lib/supabase'

// Scans live in a private bucket, so the portal serves them via short-lived
// signed URLs (mirrors lib/promo/storage.ts).
const BUCKET = 'po-scans'
const SIGNED_TTL_SECONDS = 60 * 60 // 1h — long enough to open a scan

// Resolve signed URLs for a batch of object paths. Returns a Map keyed by the
// same path string. On error, returns whatever succeeded (never throws) so the
// page still renders the rows, just without live scan links.
export async function signScanUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const clean = Array.from(new Set(paths.filter(Boolean)))
  if (clean.length === 0) return out
  const { data, error } = await sbPublic.storage
    .from(BUCKET)
    .createSignedUrls(clean, SIGNED_TTL_SECONDS)
  if (error || !data) return out
  data.forEach((row, i) => {
    if (row.signedUrl) out.set(clean[i], row.signedUrl)
  })
  return out
}
```

- [ ] **Step 2: Type-check compiles**

Run: `cd 02_services/mission-control && npx tsc --noEmit`
Expected: no errors referencing `lib/po/scans.ts`.

- [ ] **Step 3: Commit**

```bash
git add 02_services/mission-control/lib/po/scans.ts
git commit -m "feat(po-scans): signed-URL helper for po-scans bucket"
```

---

## Task 4: Nav registry item

**Files:**
- Modify: `02_services/mission-control/lib/registry.ts` (inside the `operations` section, right after the `suppliers` item)

- [ ] **Step 1: Add the item**

Find the `suppliers` item in the `operations` section (it starts with `slug: 'suppliers', name: 'Suppliers'`). Immediately **after** that item's closing `},`, insert:

```ts
      {
        slug: 'purchase-orders', name: 'Purchase Orders', icon: '🧾', status: 'building',
        description: 'Архив сканов PO от поставщиков: поставщик, № счёта, дата, сумма, скан. Заполняется ботом Chip & Dale из фото прихода.',
        route: m('purchase-orders'),
        embed: { kind: 'native' },
      },
```

- [ ] **Step 2: Type-check compiles**

Run: `cd 02_services/mission-control && npx tsc --noEmit`
Expected: no errors referencing `lib/registry.ts`.

- [ ] **Step 3: Commit**

```bash
git add 02_services/mission-control/lib/registry.ts
git commit -m "feat(po-scans): Purchase Orders nav item under Operations"
```

---

## Task 5: Portal list page

**Files:**
- Create: `02_services/mission-control/app/(portal)/m/purchase-orders/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { sbPublic, type PoScan } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { signScanUrls } from '@/lib/po/scans'

export const dynamic = 'force-dynamic'

type SearchParams = { q?: string; from?: string; to?: string }

// Render a 'YYYY-MM-DD' date as DD.MM.YYYY; pass through anything else.
function fmtD(d: string | null): string {
  if (!d) return '—'
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d
}

function fmtAmount(n: number | null): string {
  return n == null ? '—' : `฿${Math.round(n).toLocaleString('en-US')}`
}

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const q = (sp.q ?? '').trim()
  const from = (sp.from ?? '').trim()
  const to = (sp.to ?? '').trim()

  let query = sbPublic
    .from('po_scans')
    .select('*')
    .order('received_date', { ascending: false })
    .limit(500)

  if (q) query = query.or(`supplier.ilike.%${q}%,doc_number.ilike.%${q}%`)
  if (from) query = query.gte('order_date', from)
  if (to) query = query.lte('order_date', to)

  const { data, error } = await query
  if (error) {
    return (
      <div className="p-6">
        <SchemaError error={error.message} />
      </div>
    )
  }

  const rows = (data ?? []) as PoScan[]
  const urls = await signScanUrls(rows.map((r) => r.scan_path))

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Purchase Orders</h1>
        <p className="text-sm text-neutral-500">
          Scanned supplier POs. Search by supplier or document number; open a scan to retrieve the copy.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-neutral-500">
          Search
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="supplier or № …"
            className="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-500">
          From (order date)
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-500">
          To
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"
          />
        </label>
        <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
          Apply
        </button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              <th className="py-2 pr-4">Supplier</th>
              <th className="py-2 pr-4">№</th>
              <th className="py-2 pr-4">Order date</th>
              <th className="py-2 pr-4">Received</th>
              <th className="py-2 pr-4 text-right">Total</th>
              <th className="py-2 pr-4">Scan</th>
              <th className="py-2 pr-4">By</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-neutral-400">
                  No purchase orders yet.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const url = urls.get(r.scan_path)
              return (
                <tr key={r.id} className="border-b border-neutral-100">
                  <td className="py-2 pr-4 font-medium">{r.supplier ?? '—'}</td>
                  <td className="py-2 pr-4">{r.doc_number ?? '—'}</td>
                  <td className="py-2 pr-4">{fmtD(r.order_date)}</td>
                  <td className="py-2 pr-4">{fmtD(r.received_date)}</td>
                  <td className="py-2 pr-4 text-right">{fmtAmount(r.amount_total)}</td>
                  <td className="py-2 pr-4">
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                        open ↗
                      </a>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-neutral-500">{r.uploaded_by ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build the portal**

Run: `cd 02_services/mission-control && npm run build`
Expected: build succeeds; `/m/purchase-orders` compiles as a dynamic route. (At runtime before the manual DB steps, the page renders the SchemaError card — that's expected until migration 037 is applied.)

- [ ] **Step 3: Commit**

```bash
git add "02_services/mission-control/app/(portal)/m/purchase-orders/page.tsx"
git commit -m "feat(po-scans): portal list page with search + signed scan links"
```

---

## Task 6: Bot Supabase client

**Files:**
- Create: `01_agents/bot/src/db.ts`

- [ ] **Step 1: Write the client module**

```ts
// One shared Supabase client for the bot. Uses the same service-role key that
// tools.ts uses for stock queries. Null when env is missing, so the PO archive
// degrades gracefully instead of crashing the bot at import.

import { createClient } from "@supabase/supabase-js";

export const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

if (!supabase) {
  console.warn("SUPABASE_URL / SUPABASE_SERVICE_KEY not set — PO archive disabled.");
}

// Private Storage bucket holding the PO scans (created once in Supabase Studio).
export const PO_BUCKET = "po-scans";
```

- [ ] **Step 2: Commit**

```bash
git add 01_agents/bot/src/db.ts
git commit -m "feat(bot): shared Supabase client for PO archive"
```

---

## Task 7: Pure PO helpers (TDD)

**Files:**
- Create: `01_agents/bot/src/po-parse.ts`
- Test: `01_agents/bot/src/po-parse.test.ts`
- Modify: `01_agents/bot/package.json`

- [ ] **Step 1: Add vitest to the bot**

Edit `01_agents/bot/package.json` — add a `test` script and the `vitest` devDependency:

```json
{
  "name": "wine-whiskey-bot",
  "version": "1.0.0",
  "description": "Telegram bot for Wine & Whiskey store",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@supabase/supabase-js": "^2.45.0",
    "@types/node-cron": "^3.0.11",
    "dotenv": "^16.4.0",
    "grammy": "^1.30.0",
    "node-cron": "^4.2.1"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.0.0",
    "vitest": "^2.1.0"
  }
}
```

Then install: `cd 01_agents/bot && npm install`
Expected: vitest is added to `node_modules`.

- [ ] **Step 2: Write the failing test**

Create `01_agents/bot/src/po-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePOJSON, toISODate, buildPOMessage, type PendingPO } from "./po-parse.js";

describe("parsePOJSON", () => {
  it("parses a supplier PO", () => {
    const raw = '{"is_po": true, "supplier": "Harvest", "doc_number": "INV-8842", "order_date": "05.08.2026", "amount": "24500"}';
    expect(parsePOJSON(raw)).toEqual({
      supplier: "Harvest",
      docNumber: "INV-8842",
      orderDate: "05.08.2026",
      amount: "24500",
    });
  });

  it("strips markdown fences and currency noise from amount", () => {
    const raw = '```json\n{"is_po": true, "supplier": "Cigar Empire", "doc_number": "PO-1190", "order_date": "", "amount": "฿11,000"}\n```';
    expect(parsePOJSON(raw)).toEqual({
      supplier: "Cigar Empire",
      docNumber: "PO-1190",
      orderDate: "",
      amount: "11000",
    });
  });

  it("returns null when it is not a PO", () => {
    expect(parsePOJSON('{"is_po": false}')).toBeNull();
  });

  it("returns null when is_po is absent (safer default)", () => {
    expect(parsePOJSON('{"supplier": "X"}')).toBeNull();
  });

  it("returns null on garbage", () => {
    expect(parsePOJSON("not json")).toBeNull();
  });
});

describe("toISODate", () => {
  it("converts DD.MM.YYYY to YYYY-MM-DD", () => {
    expect(toISODate("05.08.2026")).toBe("2026-08-05");
  });
  it("returns null for empty or malformed input", () => {
    expect(toISODate("")).toBeNull();
    expect(toISODate("5/8/26")).toBeNull();
  });
});

describe("buildPOMessage", () => {
  const base: PendingPO = {
    supplier: "Harvest",
    docNumber: "INV-8842",
    orderDate: "05.08.2026",
    receivedDate: "05.08.2026",
    amount: "24500",
    note: "",
    scanBase64: "",
    scanMime: "image/jpeg",
    uploadedBy: "Grace",
    duplicate: false,
  };

  it("includes every field", () => {
    const msg = buildPOMessage(base);
    expect(msg).toContain("Harvest");
    expect(msg).toContain("INV-8842");
    expect(msg).toContain("05.08.2026");
    expect(msg).toContain("24500");
  });

  it("shows a duplicate warning only when flagged", () => {
    expect(buildPOMessage(base)).not.toContain("уже есть");
    expect(buildPOMessage({ ...base, duplicate: true })).toContain("уже есть");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd 01_agents/bot && npm test`
Expected: FAIL — `Cannot find module './po-parse.js'` (module not written yet).

- [ ] **Step 4: Write the implementation**

Create `01_agents/bot/src/po-parse.ts`:

```ts
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
  scanMime: "image/jpeg" | "image/png";
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd 01_agents/bot && npm test`
Expected: PASS — all `po-parse` tests green.

- [ ] **Step 6: Commit**

```bash
git add 01_agents/bot/src/po-parse.ts 01_agents/bot/src/po-parse.test.ts 01_agents/bot/package.json 01_agents/bot/package-lock.json
git commit -m "feat(bot): pure PO parse/build helpers + vitest"
```

---

## Task 8: PO network module (classify, dedup, save)

**Files:**
- Create: `01_agents/bot/src/po.ts`

- [ ] **Step 1: Write the module**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { supabase, PO_BUCKET } from "./db.js";
import { parsePOJSON, toISODate, type POExtraction, type PendingPO } from "./po-parse.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const PO_PROMPT =
  `На изображении документ, пришедший с поставкой в винный магазин. ` +
  `Определи, это purchase order / инвойс / счёт от ПОСТАВЩИКА ` +
  `(а НЕ кассовый чек об оплате и НЕ квитанция расхода магазина). ` +
  `Если это документ поставщика — извлеки поля: название поставщика, номер документа (PO/invoice №), ` +
  `дату документа (DD.MM.YYYY) и итоговую сумму в THB (только число). ` +
  `Ответь ТОЛЬКО валидным JSON без markdown и пояснений. Пример документа поставщика: ` +
  `{"is_po": true, "supplier": "Harvest", "doc_number": "INV-8842", "order_date": "05.08.2026", "amount": "24500"}. ` +
  `Если это НЕ документ поставщика: {"is_po": false}.`;

// Ask Claude vision whether the photo is a supplier PO and extract its fields.
// Returns null when it is not a PO (→ caller falls back to the expense flow).
export async function classifyAndExtractPO(
  base64: string,
  mime: "image/jpeg" | "image/png",
): Promise<POExtraction | null> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime, data: base64 } },
          { type: "text", text: PO_PROMPT },
        ],
      },
    ],
  });
  const raw = response.content.find((b) => b.type === "text")?.text ?? "";
  return parsePOJSON(raw);
}

// Soft duplicate check — same doc_number already archived?
export async function isDuplicateDocNumber(docNumber: string): Promise<boolean> {
  if (!supabase || !docNumber) return false;
  const { data } = await supabase
    .from("po_scans")
    .select("id")
    .eq("doc_number", docNumber)
    .limit(1);
  return !!(data && data.length > 0);
}

// Upload the scan to the private bucket, then insert the row. If the DB insert
// fails, the just-uploaded object is removed so we don't orphan it.
export async function savePO(p: PendingPO): Promise<void> {
  if (!supabase) throw new Error("Supabase не подключён (SUPABASE_URL/SUPABASE_SERVICE_KEY).");

  const ext = p.scanMime === "image/png" ? "png" : "jpg";
  const safeSupplier =
    (p.supplier || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "unknown";
  const safeDoc = (p.docNumber || "no-number").replace(/[^A-Za-z0-9._-]+/g, "-");
  const path = `${safeSupplier}/${safeDoc}_${Date.now()}.${ext}`;
  const buffer = Buffer.from(p.scanBase64, "base64");

  const up = await supabase.storage
    .from(PO_BUCKET)
    .upload(path, buffer, { contentType: p.scanMime, upsert: false });
  if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);

  const ins = await supabase.from("po_scans").insert({
    supplier: p.supplier || null,
    supplier_raw: p.supplier || null,
    doc_number: p.docNumber || null,
    order_date: toISODate(p.orderDate),
    received_date: toISODate(p.receivedDate),
    amount_total: p.amount ? Number(p.amount) : null,
    scan_path: path,
    note: p.note || null,
    uploaded_by: p.uploadedBy || null,
  });
  if (ins.error) {
    await supabase.storage.from(PO_BUCKET).remove([path]);
    throw new Error(`DB insert failed: ${ins.error.message}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add 01_agents/bot/src/po.ts
git commit -m "feat(bot): PO classify/dedup/save (vision + Storage + insert)"
```

> **Note:** `classifyAndExtractPO`, `isDuplicateDocNumber`, and `savePO` hit the network / DB, so they are verified by the manual smoke test in Task 11, not by unit tests (avoids heavy SDK/Storage mocking).

---

## Task 9: Wire PO flow into `index.ts`

**Files:**
- Modify: `01_agents/bot/src/index.ts`

- [ ] **Step 1: Add imports**

After the existing expenses import block (ends at line ~16), add:

```ts
import {
  PendingPO,
  buildPOMessage, buildPOKeyboard,
} from "./po-parse.js";
import {
  classifyAndExtractPO, isDuplicateDocNumber, savePO,
} from "./po.js";
```

- [ ] **Step 2: Add the pending-PO map + flow starter**

Right after the existing `const pendingExpenses = new Map<number, PendingExpense>();` line, add:

```ts
const pendingPOs = new Map<number, PendingPO>();

async function startPOFlow(
  chatId: number,
  extracted: { supplier: string; docNumber: string; orderDate: string; amount: string },
  photo: { base64: string; mimeType: "image/jpeg" | "image/png" },
  uploadedBy: string,
): Promise<void> {
  const duplicate = await isDuplicateDocNumber(extracted.docNumber);
  const po: PendingPO = {
    supplier:     extracted.supplier,
    docNumber:    extracted.docNumber,
    orderDate:    extracted.orderDate,
    receivedDate: bangkokDate(),
    amount:       extracted.amount,
    note:         "",
    scanBase64:   photo.base64,
    scanMime:     photo.mimeType,
    uploadedBy,
    duplicate,
  };
  pendingPOs.set(chatId, po);
  await bot.api.sendMessage(chatId, buildPOMessage(po), {
    parse_mode:   "HTML",
    reply_markup: buildPOKeyboard(),
  });
}
```

(`bangkokDate` is already imported from `./expenses.js`.)

- [ ] **Step 3: Branch the photo handler PO-first**

Replace the entire body of the `bot.on("message:photo", ...)` handler (currently lines ~342-369) with:

```ts
bot.on("message:photo", async (ctx) => {
  const chatId  = ctx.chat.id;
  const caption = ctx.message.caption?.trim();
  const photos  = ctx.message.photo;
  const fileId  = photos[photos.length - 1].file_id; // largest size

  const waitMsg = await ctx.reply("Читаю документ...");
  try {
    const photo = await downloadTelegramPhoto(process.env.TELEGRAM_BOT_TOKEN!, fileId);

    // 1) Supplier purchase order? Classify first; PO wins over the expense flow.
    const po = await classifyAndExtractPO(photo.base64, photo.mimeType);
    if (po) {
      await ctx.api.deleteMessage(chatId, waitMsg.message_id);
      const uploadedBy = ctx.from?.first_name ?? ctx.from?.username ?? "—";
      await startPOFlow(chatId, po, photo, uploadedBy);
      return;
    }

    // 2) Not a PO → existing expense behaviour.
    if (caption) {
      const extracted = await extractExpenseFromPhoto(photo.base64, photo.mimeType, caption);
      await ctx.api.deleteMessage(chatId, waitMsg.message_id);
      if (extracted) {
        await startExpenseFlow(chatId, extracted);
      } else {
        await ctx.reply("Не смог распознать сумму. Напиши расход текстом: «856 интернет»");
      }
    } else {
      // Store photo, wait for caption in next text message
      pendingPhotos.set(chatId, photo);
      await ctx.api.editMessageText(chatId, waitMsg.message_id, "📷 Фото получено. Напиши пояснение (на что потратили и сумму, если не видно):");
    }
  } catch (e) {
    console.error(e);
    await ctx.api.editMessageText(chatId, waitMsg.message_id, "Ошибка при обработке фото.");
  }
});
```

- [ ] **Step 4: Add a `po_` branch to the callback handler**

In `bot.on("callback_query:data", ...)`, find this line (~440):

```ts
  if (!data.startsWith("exp_")) { await ctx.answerCallbackQuery(); return; }
```

Insert **immediately before** it:

```ts
  if (data.startsWith("po_")) { await handlePOCallback(ctx, chatId, data); return; }
```

- [ ] **Step 5: Add the `handlePOCallback` function**

Add this function directly **above** the `bot.on("callback_query:data", ...)` handler:

```ts
async function handlePOCallback(ctx: any, chatId: number, data: string): Promise<void> {
  if (data === "po_cancel") {
    pendingPOs.delete(chatId);
    await ctx.answerCallbackQuery("Отменено");
    await ctx.editMessageText("✖ PO отменён.");
    return;
  }

  const po = pendingPOs.get(chatId);
  if (!po) {
    await ctx.answerCallbackQuery("Сессия устарела — отправь скан снова.");
    return;
  }

  if (data === "po_expense") {
    // Misclassified — hand the same photo to the expense flow.
    pendingPOs.delete(chatId);
    await ctx.answerCallbackQuery("Ок, это расход");
    const extracted = await extractExpenseFromPhoto(po.scanBase64, po.scanMime, "");
    if (extracted) {
      await ctx.editMessageText("↔️ Переключил на расход.");
      await startExpenseFlow(chatId, extracted);
    } else {
      await ctx.editMessageText("↔️ Это расход. Напиши сумму и описание текстом: «856 интернет».");
    }
    return;
  }

  if (data === "po_confirm") {
    pendingPOs.delete(chatId);
    await ctx.answerCallbackQuery("Записываю...");
    try {
      await savePO(po);
    } catch (e) {
      console.error("savePO failed:", e);
      try {
        await ctx.editMessageText("❌ Ошибка записи PO. Попробуй ещё раз.");
      } catch (editErr) { console.error("editMessageText failed:", editErr); }
      return;
    }
    try {
      await ctx.editMessageText(
        `✅ PO записан.\n\n` +
        `🏭 ${po.supplier || "—"}\n` +
        `🧾 ${po.docNumber || "—"}\n` +
        `📅 ${po.orderDate || "—"} · 📦 ${po.receivedDate}\n` +
        `💰 ฿${po.amount || "—"}`,
      );
    } catch (editErr) { console.error("confirmation edit failed:", editErr); }
    return;
  }

  await ctx.answerCallbackQuery();
}
```

- [ ] **Step 6: Verify the bot starts (imports resolve, no crash)**

Run: `cd 01_agents/bot && npm test`
Expected: existing `po-parse` tests still PASS (index.ts is not unit-tested, but a broken import there would not affect this; the real check is Step 7 + the smoke test).

Run: `cd 01_agents/bot && node --input-type=module -e "import('./src/po.js').then(()=>console.log('po.ts imports OK')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: prints `po.ts imports OK` (module graph loads; env may be unset — that only disables Supabase, it does not throw).

- [ ] **Step 7: Commit**

```bash
git add 01_agents/bot/src/index.ts
git commit -m "feat(bot): route photos through PO classification with confirm card"
```

---

## Task 10: Final build + full test sweep

**Files:** none (verification only)

- [ ] **Step 1: Portal build + tests**

Run: `cd 02_services/mission-control && npm run build && npm test`
Expected: build succeeds; existing vitest suite stays green.

- [ ] **Step 2: Bot tests**

Run: `cd 01_agents/bot && npm test`
Expected: `po-parse` suite green.

- [ ] **Step 3: Commit any lockfile changes**

```bash
git add -A
git commit -m "chore(po-scans): lockfiles + build artifacts" || echo "nothing to commit"
```

---

## Manual steps (user, outside code)

These are NOT code tasks — the implementer must surface them to the user, who performs them:

1. **Apply migration** — paste `02_services/mission-control/supabase/migrations/037_po_scans.sql` into the Supabase SQL Editor and run it.
2. **Create the Storage bucket** — in Supabase Studio → Storage, create a **private** bucket named exactly `po-scans`.
3. **Bot env on Railway** — confirm the bot service has `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` set (the same values mission-control uses). Add them if missing — without them the PO archive is disabled (bot logs a warning and photos fall back to the expense flow).
4. **Deploy** — push to `main`; Railway redeploys both the bot and mission-control.

## Smoke test (after manual steps + deploy)

1. Send a photo of a real supplier PO into the Chip & Dale chat.
2. Bot replies with the PO confirmation card (supplier / № / dates / amount).
3. Tap **✅ Записать** → bot confirms "PO записан".
4. Open the portal → **Operations ▸ Purchase Orders** → the row appears; **open ↗** shows the scan.
5. Send a normal expense receipt photo → bot still routes it to the expense flow (PO classifier returns not-a-PO).
6. Send the same PO again → card shows the ⚠️ duplicate warning.

---

## Deliberate simplifications (YAGNI)

- **No inline field editing.** The card offers Confirm / «Это расход» / Cancel. To fix a
  misread field, the manager cancels and re-sends (mirrors the expense flow, which also has
  no free-text amount edit). Inline editing can be a follow-up if it proves needed.
- **Pending PO state is in-memory** (`pendingPOs`), like `pendingPhotos`. A Railway redeploy
  mid-confirmation drops it; the manager just re-sends the photo. The scan is only uploaded
  on confirm, so no orphaned objects result from a dropped pending state.
- **Supplier normalization** is whatever Claude returns in `supplier`, stored alongside the
  raw value. A hard mapping to the `suppliers` table can follow if duplicates diverge.
