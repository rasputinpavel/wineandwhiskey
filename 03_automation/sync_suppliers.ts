/**
 * sync_suppliers.ts
 * Writes supplier dashboard and per-supplier details to Google Sheets.
 *
 * Tabs written:
 *   Поставщики   — overview dashboard (KPIs, monthly dynamics, supplier ranking)
 *   Поставщик    — interactive per-supplier view (dropdown + stats + terms + pivot)
 *   SuppData     — hidden: Supplier | Month | Amount | Orders
 *   SuppItems    — hidden: Supplier | Month | Product | Qty | Amount
 *
 * Usage: npx tsx scripts/sync_suppliers.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// ─── Config ────────────────────────────────────────────────────────────────

const SHEET_ID             = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const LOYVERSE_TOKEN       = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ─── Bangkok helpers ───────────────────────────────────────────────────────

function bangkokNow() { return new Date(Date.now() + 7 * 3600_000); }

function monthLabel(ym: string) {
  const names = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
  const [y, m] = ym.split("-").map(Number);
  return `${names[m - 1]} ${y}`;
}

function lastNMonths(n: number): string[] {
  const now = bangkokNow();
  const result: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    let m = now.getUTCMonth() + 1 - i;
    let y = now.getUTCFullYear();
    while (m <= 0) { m += 12; y--; }
    result.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return result;
}

// ─── Google Sheets ─────────────────────────────────────────────────────────

let _gToken: string | null = null;
async function gToken() {
  if (_gToken) return _gToken;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`OAuth2: ${await r.text()}`);
  _gToken = (await r.json()).access_token;
  return _gToken!;
}

async function sheetsReq(method: string, path: string, body?: unknown) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await gToken()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Sheets ${method} ${path}: ${await r.text()}`);
  return r.json();
}

async function ensureTab(title: string): Promise<number> {
  const meta = await sheetsReq("GET", "");
  const existing = (meta.sheets ?? []).find((s: any) => s.properties.title === title);
  if (existing) return existing.properties.sheetId;
  const res = await sheetsReq("POST", ":batchUpdate", {
    requests: [{ addSheet: { properties: { title } } }],
  });
  return res.replies[0].addSheet.properties.sheetId;
}

async function clearTab(sheetId: number) {
  await sheetsReq("POST", ":batchUpdate", {
    requests: [{ updateCells: { range: { sheetId }, fields: "userEnteredValue,userEnteredFormat,dataValidation" } }],
  });
}

async function ensureColumns(sheetId: number, minCols: number) {
  const meta = await sheetsReq("GET", "");
  const sheet = (meta.sheets ?? []).find((s: any) => s.properties.sheetId === sheetId);
  const current = sheet?.properties?.gridProperties?.columnCount ?? 26;
  if (current < minCols) {
    await sheetsReq("POST", ":batchUpdate", {
      requests: [{ appendDimension: { sheetId, dimension: "COLUMNS", length: minCols - current } }],
    });
  }
}

async function writeValues(tab: string, range: string, values: any[][], inputOption = "RAW") {
  if (!values.length) return;
  await sheetsReq("PUT",
    `/values/${encodeURIComponent(`${tab}!${range}`)}?valueInputOption=${inputOption}`,
    { range: `${tab}!${range}`, majorDimension: "ROWS", values },
  );
}

async function writeCellFormulas(sheetId: number, cells: Array<{ row: number; col: number; formula: string }>) {
  await sheetsReq("POST", ":batchUpdate", {
    requests: cells.map(({ row, col, formula }) => ({
      updateCells: {
        rows: [{ values: [{ userEnteredValue: { formulaValue: formula } }] }],
        fields: "userEnteredValue",
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: col, endColumnIndex: col + 1 },
      },
    })),
  });
}

function hFmt(sheetId: number, r0: number, r1: number, c0: number, c1: number, bg: any, fg: any) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 },
      cell: { userEnteredFormat: { backgroundColor: bg, textFormat: { bold: true, foregroundColor: fg } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  };
}

// ─── Loyverse suppliers ────────────────────────────────────────────────────

interface LoyverseSupplier {
  id: string;
  name: string;
  phone_number: string | null;
  email: string | null;
  note: string | null;
}

async function fetchLoyverseSuppliers(): Promise<LoyverseSupplier[]> {
  const r = await fetch("https://api.loyverse.com/v1.0/suppliers?limit=250", {
    headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` },
  });
  if (!r.ok) throw new Error(`Loyverse suppliers: ${r.status}`);
  const data = await r.json() as any;
  return (data.suppliers ?? []).filter((s: any) => !s.deleted_at);
}

// ─── Supabase data ─────────────────────────────────────────────────────────

interface SupplierMonth { amount: number; orders: number; }
interface SupplierStats {
  name: string;
  note: string | null;
  totalAmount: number;
  totalOrders: number;
  firstOrder: string;
  lastOrder: string;
  byMonth: Map<string, SupplierMonth>;
}
interface ItemLine { supplier: string; month: string; product: string; qty: number; amount: number; }

async function fetchSupplierData(): Promise<{ stats: Map<string, SupplierStats>; items: ItemLine[] }> {
  console.log("  Fetching purchase_orders from Supabase...");
  const { data: orders, error } = await supabase
    .from("purchase_orders")
    .select("po_number, order_date, supplier, total_thb, purchase_order_items(product_name, qty_ordered, line_total)")
    .not("loyverse_id", "is", null)
    .not("supplier", "is", null)
    .not("order_date", "is", null)
    .order("order_date", { ascending: true });

  if (error) throw new Error(`Supabase: ${error.message}`);
  console.log(`  ${orders?.length ?? 0} purchase orders loaded.`);

  const stats = new Map<string, SupplierStats>();
  const items: ItemLine[] = [];

  for (const po of orders ?? []) {
    const name = (po.supplier as string).trim();
    const ym   = (po.order_date as string).slice(0, 7);
    const amt  = ((po as any).purchase_order_items ?? [])
      .reduce((s: number, li: any) => s + (li.line_total ?? 0), 0);

    if (!stats.has(name)) {
      stats.set(name, {
        name, note: null,
        totalAmount: 0, totalOrders: 0,
        firstOrder: po.order_date, lastOrder: po.order_date,
        byMonth: new Map(),
      });
    }
    const s = stats.get(name)!;
    s.totalAmount += amt;
    s.totalOrders++;
    if (po.order_date < s.firstOrder) s.firstOrder = po.order_date;
    if (po.order_date > s.lastOrder)  s.lastOrder  = po.order_date;
    const m = s.byMonth.get(ym) ?? { amount: 0, orders: 0 };
    m.amount += amt; m.orders++;
    s.byMonth.set(ym, m);

    for (const li of (po as any).purchase_order_items ?? []) {
      if (!li.product_name) continue;
      items.push({
        supplier: name,
        month: ym,
        product: li.product_name.trim(),
        qty: li.qty_ordered ?? 0,
        amount: li.line_total ?? 0,
      });
    }
  }

  return { stats, items };
}

// ─── Write SuppData (hidden) ───────────────────────────────────────────────

async function writeSuppDataTab(sheetId: number, stats: Map<string, SupplierStats>) {
  await clearTab(sheetId);
  const rows: any[][] = [["Supplier", "Month", "Amount", "Orders"]];
  for (const s of [...stats.values()].sort((a, b) => b.totalAmount - a.totalAmount)) {
    for (const [ym, m] of [...s.byMonth.entries()].sort()) {
      rows.push([s.name, ym, Math.round(m.amount), m.orders]);
    }
  }
  await writeValues("SuppData", "A1", rows);
  const dark = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  await sheetsReq("POST", ":batchUpdate", {
    requests: [
      hFmt(sheetId, 0, 1, 0, 4, dark, white),
      { updateSheetProperties: { properties: { sheetId, hidden: true }, fields: "hidden" } },
    ],
  });
}

// ─── Write SuppItems (hidden) ──────────────────────────────────────────────

async function writeSuppItemsTab(sheetId: number, items: ItemLine[]) {
  await clearTab(sheetId);
  const rows: any[][] = [["Supplier", "Month", "Product", "Qty", "Amount"],
    ...items
      .sort((a, b) => b.month.localeCompare(a.month))
      .map(i => [i.supplier, i.month, i.product, i.qty, Math.round(i.amount)]),
  ];
  await writeValues("SuppItems", "A1", rows);
  const dark = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  await sheetsReq("POST", ":batchUpdate", {
    requests: [
      hFmt(sheetId, 0, 1, 0, 5, dark, white),
      { updateSheetProperties: { properties: { sheetId, hidden: true }, fields: "hidden" } },
    ],
  });
}

// ─── Write Поставщики dashboard ────────────────────────────────────────────

async function writeSuppliersTab(sheetId: number, stats: Map<string, SupplierStats>, updatedAt: string) {
  await clearTab(sheetId);

  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  const wine  = { red: 0.48, green: 0.11, blue: 0.11 };

  const now = bangkokNow();
  const curYear = String(now.getUTCFullYear());

  let ytdAmount = 0, ytdOrders = 0;
  const activeYTD = new Set<string>();
  for (const s of stats.values()) {
    for (const [ym, m] of s.byMonth) {
      if (ym.startsWith(curYear)) {
        ytdAmount += m.amount;
        ytdOrders += m.orders;
        activeYTD.add(s.name);
      }
    }
  }

  // Row 1: title
  await writeValues("Поставщики", "A1", [[`Поставщики — Wine & Whiskey | Обновлено: ${updatedAt}`]]);

  // Rows 3-4: KPIs
  const f = (n: number) => Math.round(n).toLocaleString("ru-RU");
  await writeValues("Поставщики", "A3", [
    ["Закупки YTD", "Заказов YTD", "Поставщиков YTD", "Ср. заказ YTD"],
    [
      f(ytdAmount) + " ฿",
      ytdOrders,
      activeYTD.size,
      ytdOrders > 0 ? f(ytdAmount / ytdOrders) + " ฿" : "—",
    ],
  ]);

  // Row 6+: Monthly dynamics — all months from data, newest first
  const allMonths = [...new Set(
    [...stats.values()].flatMap(s => [...s.byMonth.keys()])
  )].sort().reverse();

  await writeValues("Поставщики", "A6", [["Динамика закупок по месяцам"]]);
  const dynHeader = ["Месяц", "Сумма ฿", "Заказов", "Поставщиков"];
  const dynRows: any[][] = [dynHeader];
  for (const ym of allMonths) {
    let amt = 0, ords = 0;
    const active = new Set<string>();
    for (const s of stats.values()) {
      const m = s.byMonth.get(ym);
      if (m && m.orders > 0) { amt += m.amount; ords += m.orders; active.add(s.name); }
    }
    dynRows.push([monthLabel(ym), Math.round(amt), ords, active.size]);
  }
  await writeValues("Поставщики", "A7", dynRows);

  // Ranking starts after dynamics table + 2 rows gap
  const rankStartRow = 7 + dynRows.length + 2;
  await writeValues("Поставщики", `A${rankStartRow}`, [["Рейтинг поставщиков (все время)"]]);
  const rankHeader = ["Поставщик", "Закуплено ฿", "Заказов", "Ср. заказ ฿", "Первый заказ", "Последний заказ"];
  const rankRows: any[][] = [rankHeader];
  for (const s of [...stats.values()].sort((a, b) => b.totalAmount - a.totalAmount)) {
    rankRows.push([
      s.name,
      Math.round(s.totalAmount),
      s.totalOrders,
      s.totalOrders > 0 ? Math.round(s.totalAmount / s.totalOrders) : 0,
      s.firstOrder,
      s.lastOrder,
    ]);
  }
  await writeValues("Поставщики", `A${rankStartRow + 1}`, rankRows);

  // Formatting
  await sheetsReq("POST", ":batchUpdate", {
    requests: [
      hFmt(sheetId, 0, 1, 0, 6, dark, white),
      hFmt(sheetId, 2, 3, 0, 4, { red: 0.38, green: 0.38, blue: 0.38 }, white),
      hFmt(sheetId, 5, 6, 0, 1, dark, white),
      hFmt(sheetId, 6, 7, 0, 4, { red: 0.25, green: 0.25, blue: 0.25 }, white),
      hFmt(sheetId, rankStartRow - 1, rankStartRow, 0, 1, wine, white),
      hFmt(sheetId, rankStartRow, rankStartRow + 1, 0, 6, { red: 0.25, green: 0.25, blue: 0.25 }, white),
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 260 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 6 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
    ],
  });
}

// ─── Write Поставщик tab (dropdown + QUERY) ────────────────────────────────

async function writeSupplierTab(sheetId: number, stats: Map<string, SupplierStats>, loyverseSuppliers: LoyverseSupplier[]) {
  await clearTab(sheetId);
  // QUERY PIVOT needs 1 product col + ~50 month cols; default sheet has only 26.
  await ensureColumns(sheetId, 100);

  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  const gray  = { red: 0.38, green: 0.38, blue: 0.38 };
  const wine  = { red: 0.48, green: 0.11, blue: 0.11 };

  const supplierNames = [...stats.keys()].sort((a, b) =>
    (stats.get(b)!.totalAmount) - (stats.get(a)!.totalAmount)
  );
  const firstSupplier = supplierNames[0] ?? "";

  // Build note lookup from Loyverse
  const noteMap = new Map<string, string>();
  for (const ls of loyverseSuppliers) {
    if (ls.note?.trim()) noteMap.set(ls.name.trim(), ls.note.trim());
  }

  // ── Static labels ──
  // Row 1: dropdown
  await writeValues("Поставщик", "A1", [["Поставщик:", firstSupplier]], "RAW");

  // Row 3: stats labels
  await writeValues("Поставщик", "A3", [["Закуплено всего", "", "Заказов", "", "Ср. заказ", ""]], "RAW");
  // Row 5: date labels
  await writeValues("Поставщик", "A5", [["Первый заказ", "", "Последний заказ", "", "", ""]], "RAW");

  // Row 7: conditions header
  await writeValues("Поставщик", "A7", [["Условия работы"]], "RAW");

  // ── SUMIF / QUERY для статистики ──
  const d = "SuppData";
  await writeCellFormulas(sheetId, [
    { row: 3, col: 1, formula: `=SUMIF(${d}!A:A;B1;${d}!C:C)` },
    { row: 3, col: 3, formula: `=SUMIF(${d}!A:A;B1;${d}!D:D)` },
    { row: 3, col: 5, formula: `=IFERROR(SUMIF(${d}!A:A;B1;${d}!C:C)/SUMIF(${d}!A:A;B1;${d}!D:D);"—")` },
    // MINIFS/MAXIFS не работают на текстовых датах — используем QUERY с ORDER BY
    { row: 5, col: 1, formula: `=IFERROR(QUERY(${d}!A:B;"SELECT B WHERE A = '"&B1&"' ORDER BY B ASC LIMIT 1 LABEL B ''";0);"—")` },
    { row: 5, col: 3, formula: `=IFERROR(QUERY(${d}!A:B;"SELECT B WHERE A = '"&B1&"' ORDER BY B DESC LIMIT 1 LABEL B ''";0);"—")` },
  ]);

  // ── Conditions: write notes to hidden SuppNotes tab, VLOOKUP pulls by B1 ──
  const noteRows: any[][] = [["Supplier", "Note"]];
  for (const name of supplierNames) {
    noteRows.push([name, noteMap.get(name) ?? "—"]);
  }
  await writeValues("SuppNotes", "A1", noteRows, "RAW");

  await writeCellFormulas(sheetId, [
    { row: 7, col: 1, formula: `=IFERROR(VLOOKUP(B1;SuppNotes!A:B;2;0);"—")` },
  ]);

  // Row 10: dynamic label; QUERY may expand ~40 rows max (3+ years monthly)
  await writeValues("Поставщик", "A10", [["Динамика по месяцам"]], "RAW");
  await writeCellFormulas(sheetId, [
    { row: 10, col: 0, formula: `=IFERROR(QUERY(${d}!A:D;"SELECT B, C, D WHERE A = '"&B1&"' ORDER BY B DESC LABEL B 'Месяц', C 'Сумма ฿', D 'Заказов'";1);"Нет данных")` },
  ]);

  // Row 55: pivot revenue (safe gap after dynamics)
  const o = "SuppItems";
  await writeValues("Поставщик", "A55", [["Товары — сумма ฿ по месяцам"]], "RAW");
  await writeCellFormulas(sheetId, [
    {
      row: 55, col: 0,
      formula: `=IFERROR(QUERY(${o}!A:E;"SELECT C, SUM(E) WHERE A = '"&B1&"' GROUP BY C PIVOT B LABEL C 'Товар'";1);"Нет данных")`,
    },
  ]);

  // Row 210: pivot qty (safe gap after revenue pivot which can expand ~150 rows)
  await writeValues("Поставщик", "A210", [["Товары — кол-во по месяцам"]], "RAW");
  await writeCellFormulas(sheetId, [
    {
      row: 210, col: 0,
      formula: `=IFERROR(QUERY(${o}!A:E;"SELECT C, SUM(D) WHERE A = '"&B1&"' GROUP BY C PIVOT B LABEL C 'Товар'";1);"Нет данных")`,
    },
  ]);

  // ── Formatting ──
  await sheetsReq("POST", ":batchUpdate", {
    requests: [
      hFmt(sheetId, 0, 1, 0, 6, dark, white),
      { repeatCell: {
          range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 6 },
          cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: gray } } },
          fields: "userEnteredFormat.textFormat",
      }},
      { repeatCell: {
          range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 4 },
          cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: gray } } },
          fields: "userEnteredFormat.textFormat",
      }},
      hFmt(sheetId, 6, 7, 0, 1, wine, white),
      { repeatCell: {
          range: { sheetId, startRowIndex: 7, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 6 },
          cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
          fields: "userEnteredFormat.wrapStrategy",
      }},
      hFmt(sheetId, 9, 10, 0, 1, dark, white),
      hFmt(sheetId, 54, 55, 0, 1, dark, white),
      hFmt(sheetId, 209, 210, 0, 1, dark, white),
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 200 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 6 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 7, endIndex: 10 }, properties: { pixelSize: 80 }, fields: "pixelSize" } },
      {
        setDataValidation: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 },
          rule: {
            condition: { type: "ONE_OF_LIST", values: supplierNames.map(v => ({ userEnteredValue: v })) },
            showCustomUi: true, strict: false,
          },
        },
      },
    ],
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const now       = bangkokNow();
  const updatedAt = now.toISOString().slice(0, 16).replace("T", " ") + " BKK";

  console.log("\nWine & Whiskey — Suppliers Sync");
  console.log(`Updated: ${updatedAt}\n`);

  console.log("[1/3] Fetching data...");
  const [{ stats, items }, loyverseSuppliers] = await Promise.all([
    fetchSupplierData(),
    fetchLoyverseSuppliers(),
  ]);

  // Attach notes from Loyverse to stats
  for (const ls of loyverseSuppliers) {
    const s = stats.get(ls.name.trim());
    if (s && ls.note) s.note = ls.note.trim();
  }

  console.log(`  ${stats.size} suppliers, ${items.length} line items, ${loyverseSuppliers.filter(s => s.note).length} with notes.\n`);

  console.log("[2/3] Ensuring tabs...");
  const [suppId, dataId, itemsId, notesId, supplierTabId] = await Promise.all([
    ensureTab("Поставщики"),
    ensureTab("SuppData"),
    ensureTab("SuppItems"),
    ensureTab("SuppNotes"),
    ensureTab("Поставщик"),
  ]);

  console.log("[3/3] Writing sheets...");
  await writeSuppDataTab(dataId, stats);
  console.log("  ✓ SuppData");

  await writeSuppItemsTab(itemsId, items);
  console.log("  ✓ SuppItems");

  await writeSuppliersTab(suppId, stats, updatedAt);
  console.log("  ✓ Поставщики");

  await writeSupplierTab(supplierTabId, stats, loyverseSuppliers);
  console.log("  ✓ Поставщик");

  // Hide SuppNotes
  await sheetsReq("POST", ":batchUpdate", {
    requests: [{ updateSheetProperties: { properties: { sheetId: notesId, hidden: true }, fields: "hidden" } }],
  });

  console.log(`\n✓ Done. → https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
}

main().catch(e => { console.error(e); process.exit(1); });
