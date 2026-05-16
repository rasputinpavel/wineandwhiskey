/**
 * sync_b2b.ts
 * Writes B2B customer dashboard and supplier meeting prep to Google Sheets.
 *
 * Tabs written:
 *   B2B          — wholesale customer dashboard (computed)
 *   B2B_Данные   — raw monthly data per client (formula source, hidden)
 *   B2B Клиент   — interactive client view (dropdown + QUERY formulas)
 *   Поставщики   — supplier meeting prep (one section per supplier)
 *
 * Usage: npx tsx scripts/sync_b2b.ts
 */

import dotenv from "dotenv";
import { BANK_TRANSFER_TYPE_ID, isB2BCustomerName } from "./lib/b2b.js";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// ─── Config ────────────────────────────────────────────────────────────────

const SHEET_ID             = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const LOYVERSE_TOKEN       = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

// ─── Bangkok helpers ───────────────────────────────────────────────────────

function bangkokNow() { return new Date(Date.now() + 7 * 3600_000); }

function monthLabel(ym: string) {
  const names = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
  const [y, m] = ym.split("-").map(Number);
  return `${names[m - 1]} ${y}`;
}

function toYM(dateStr: string) { return dateStr.slice(0, 7); }

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

async function writeValues(tab: string, range: string, values: any[][], inputOption = "RAW") {
  if (!values.length) return;
  await sheetsReq("PUT",
    `/values/${encodeURIComponent(`${tab}!${range}`)}?valueInputOption=${inputOption}`,
    { range: `${tab}!${range}`, majorDimension: "ROWS", values },
  );
}

// Locale-independent formula write — formulaValue bypasses spreadsheet locale (no ; vs , issue)
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

// ─── Loyverse ──────────────────────────────────────────────────────────────

async function loyverseFetch<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const url = `https://api.loyverse.com/v1.0${path}${path.includes("?") ? "&" : "?"}limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45_000);
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` }, signal: ctrl.signal });
      if (!r.ok) throw new Error(`Loyverse ${r.status}: ${path}`);
      const d = await r.json();
      out.push(...(d[key] ?? []));
      cursor = d.cursor;
    } finally { clearTimeout(t); }
  } while (cursor);
  return out;
}

// ─── B2B Data ──────────────────────────────────────────────────────────────

interface MonthStats { revenue: number; gp: number; orders: number; }

interface ClientStats {
  name: string;
  totalRevenue: number;
  totalGP: number;
  totalOrders: number;
  firstOrder: string;
  lastOrder: string;
  byMonth: Map<string, MonthStats>;
}

interface OrderLine {
  clientName: string;
  date: string;
  receiptNumber: string;
  product: string;
  qty: number;
  unitPrice: number;
  total: number;
}

interface B2BData { clients: ClientStats[]; orders: OrderLine[]; }

async function fetchB2BData(): Promise<B2BData> {
  console.log("  Fetching Loyverse customers...");
  const customers = await loyverseFetch<any>("/customers", "customers");
  const b2bCustomers = customers.filter((c: any) => isB2BCustomerName(c.name ?? ""));
  console.log(`  B2B customers matched: ${b2bCustomers.length}`);
  if (b2bCustomers.length === 0) {
    console.log("  Names found:", customers.slice(0, 10).map((c: any) => c.name).join(", "));
  }

  const b2bIds = new Set(b2bCustomers.map((c: any) => c.id));
  const idToName = new Map<string, string>(b2bCustomers.map((c: any) => [c.id, c.name as string]));

  console.log("  Fetching receipts from 2024-01-01 (this may take a few minutes)...");
  const from = "2024-01-01T00:00:00.000Z";
  const to   = bangkokNow().toISOString();
  const receipts = await loyverseFetch<any>(
    `/receipts?receipt_type=SALE&created_at_min=${from}&created_at_max=${to}`,
    "receipts"
  );
  console.log(`  Total receipts fetched: ${receipts.length}`);

  const b2bReceipts = receipts.filter((r: any) =>
    r.customer_id &&
    b2bIds.has(r.customer_id) &&
    (r.payments ?? []).some((p: any) => p.payment_type_id === BANK_TRANSFER_TYPE_ID)
  );
  console.log(`  B2B bank transfer receipts: ${b2bReceipts.length}`);

  const statsMap = new Map<string, ClientStats>();
  const orderLines: OrderLine[] = [];

  for (const r of b2bReceipts) {
    const name = idToName.get(r.customer_id)!;
    const date = (r.receipt_date ?? r.created_at ?? "").slice(0, 10);
    const ym   = date.slice(0, 7);
    if (!ym) continue;

    let cost = 0;
    for (const li of r.line_items ?? []) cost += li.cost_total ?? 0;
    const revenue = r.total_money ?? 0;
    const gp = revenue - cost;

    if (!statsMap.has(name)) {
      statsMap.set(name, {
        name, totalRevenue: 0, totalGP: 0, totalOrders: 0,
        firstOrder: date, lastOrder: date, byMonth: new Map(),
      });
    }
    const s = statsMap.get(name)!;
    s.totalRevenue += revenue;
    s.totalGP += gp;
    s.totalOrders++;
    if (date && date < s.firstOrder) s.firstOrder = date;
    if (date && date > s.lastOrder)  s.lastOrder  = date;

    const m = s.byMonth.get(ym) ?? { revenue: 0, gp: 0, orders: 0 };
    m.revenue += revenue; m.gp += gp; m.orders++;
    s.byMonth.set(ym, m);

    // Line items for order history
    for (const li of r.line_items ?? []) {
      orderLines.push({
        clientName: name,
        date,
        receiptNumber: r.receipt_number ?? "—",
        product: li.item_name ?? "—",
        qty: li.quantity ?? 0,
        unitPrice: li.price ?? 0,
        total: li.total_money ?? 0,
      });
    }
  }

  const clients = [...statsMap.values()].sort((a, b) => b.totalRevenue - a.totalRevenue);
  return { clients, orders: orderLines };
}

// ─── Supplier Data from Supabase ───────────────────────────────────────────

interface SupplierStats {
  name: string;
  totalThb: number;
  ordersCount: number;
  firstOrder: string;
  lastOrder: string;
  byMonth: Map<string, number>;
  topItems: Array<{ product: string; qty: number; total: number }>;
}

async function fetchSupplierData(): Promise<{ stats: SupplierStats[]; rawOrders: any[] }> {
  if (!supabase) { console.log("  Supabase not configured — skipping suppliers."); return { stats: [], rawOrders: [] }; }

  console.log("  Fetching purchase orders from Supabase...");
  const PAGE = 500;
  const orders: any[] = [];
  let from = 0;
  while (true) {
    const { data, error: oErr } = await supabase
      .from("purchase_orders")
      .select("*, purchase_order_items(*)")
      .not("order_date", "is", null)
      .order("order_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (oErr) { console.error("  Supabase error:", oErr.message); return []; }
    orders.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`  Purchase orders: ${orders.length}`);

  const supplierMap = new Map<string, SupplierStats>();
  const itemBySupplier = new Map<string, Map<string, { qty: number; total: number }>>();

  for (const po of orders ?? []) {
    const supplier = (po.supplier ?? "Unknown").trim();
    if (!supplierMap.has(supplier)) {
      supplierMap.set(supplier, {
        name: supplier, totalThb: 0, ordersCount: 0,
        firstOrder: po.order_date, lastOrder: po.order_date,
        byMonth: new Map(), topItems: [],
      });
    }
    const s = supplierMap.get(supplier)!;
    s.totalThb   += po.total_thb ?? 0;
    s.ordersCount++;
    if (po.order_date < s.firstOrder) s.firstOrder = po.order_date;
    if (po.order_date > s.lastOrder)  s.lastOrder  = po.order_date;

    const ym = po.order_date.slice(0, 7);
    s.byMonth.set(ym, (s.byMonth.get(ym) ?? 0) + (po.total_thb ?? 0));

    for (const item of (po as any).purchase_order_items ?? []) {
      if (!itemBySupplier.has(supplier)) itemBySupplier.set(supplier, new Map());
      const im = itemBySupplier.get(supplier)!;
      const pname = (item.product_name ?? "—").trim();
      const cur = im.get(pname) ?? { qty: 0, total: 0 };
      im.set(pname, { qty: cur.qty + (item.qty_ordered ?? 0), total: cur.total + (item.line_total ?? 0) });
    }
  }

  for (const [supplier, s] of supplierMap) {
    const im = itemBySupplier.get(supplier);
    if (im) {
      s.topItems = [...im.entries()]
        .map(([product, d]) => ({ product, ...d }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 8);
    }
  }

  return {
    stats: [...supplierMap.values()].sort((a, b) => b.totalThb - a.totalThb),
    rawOrders: orders,
  };
}

// ─── Write B2B Orders flat list tab ───────────────────────────────────────

async function writeB2BOrdersListTab(sheetId: number, orders: OrderLine[]) {
  await clearTab(sheetId);

  const header = ["Клиент", "Дата", "Номер заказа", "Позиция", "Кол-во", "Сумма, ฿"];
  const rows: any[][] = [
    header,
    ...orders
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(o => [
        o.clientName,
        o.date,
        o.receiptNumber,
        o.product,
        o.qty,
        Math.round(o.total),
      ]),
  ];

  await writeValues("B2B Позиции", "A1", rows);

  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  await sheetsReq("POST", ":batchUpdate", {
    requests: [
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, foregroundColor: white } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
      { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 6 } } },
    ],
  });
}

// ─── Write hidden data tabs ────────────────────────────────────────────────

async function writeB2BDataTab(sheetId: number, clients: ClientStats[]) {
  await clearTab(sheetId);

  const header = ["Client", "Month", "Revenue", "Orders", "GP", "AvgOrder", "FirstOrder", "LastOrder"];
  const rows: any[][] = [header];

  for (const c of clients) {
    for (const [ym, m] of [...c.byMonth.entries()].sort()) {
      rows.push([
        c.name, ym, Math.round(m.revenue), m.orders, Math.round(m.gp),
        m.orders > 0 ? Math.round(m.revenue / m.orders) : 0,
        c.firstOrder, c.lastOrder,
      ]);
    }
  }

  await writeValues("B2BData", "A1", rows);

  const dark = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  await sheetsReq("POST", ":batchUpdate", {
    requests: [
      hFmt(sheetId, 0, 1, 0, 8, dark, white),
      { updateSheetProperties: { properties: { sheetId, hidden: true }, fields: "hidden" } },
    ],
  });
}

async function writeB2BOrdersTab(sheetId: number, orders: OrderLine[]) {
  await clearTab(sheetId);

  const header = ["Client", "Date", "Product", "Qty", "UnitPrice", "Total"];
  const rows: any[][] = [header,
    ...orders
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(o => [o.clientName, o.date.slice(0, 7), o.product, o.qty, Math.round(o.unitPrice), Math.round(o.total)]),
  ];

  await writeValues("B2BOrders", "A1", rows);

  const dark = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  await sheetsReq("POST", ":batchUpdate", {
    requests: [
      hFmt(sheetId, 0, 1, 0, 6, dark, white),
      { updateSheetProperties: { properties: { sheetId, hidden: true }, fields: "hidden" } },
    ],
  });
}

// ─── Write B2B Dashboard tab ───────────────────────────────────────────────

async function writeB2BDashboard(sheetId: number, clients: ClientStats[], updatedAt: string) {
  await clearTab(sheetId);

  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  const wine  = { red: 0.48, green: 0.11, blue: 0.11 };

  const f = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const now = bangkokNow();
  const curYM  = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const prevM  = now.getUTCMonth();
  const prevYM = prevM === 0
    ? `${now.getUTCFullYear() - 1}-12`
    : `${now.getUTCFullYear()}-${String(prevM).padStart(2, "0")}`;
  const curYear  = String(now.getUTCFullYear());
  const prevYear = String(now.getUTCFullYear() - 1);

  let ytdRevenue = 0, ytdOrders = 0, ytdGP = 0;
  let curMonthRevenue = 0, prevMonthRevenue = 0, prevYearRevenue = 0;
  const activeThisMonth = new Set<string>();

  for (const c of clients) {
    for (const [ym, m] of c.byMonth) {
      if (ym.startsWith(curYear))  { ytdRevenue += m.revenue; ytdOrders += m.orders; ytdGP += m.gp; }
      if (ym === curYM)  { curMonthRevenue += m.revenue; if (m.orders > 0) activeThisMonth.add(c.name); }
      if (ym === prevYM) { prevMonthRevenue += m.revenue; }
      if (ym.startsWith(prevYear)) { prevYearRevenue += m.revenue; }
    }
  }

  const yoy = prevYearRevenue > 0 ? ((ytdRevenue / prevYearRevenue - 1) * 100) : 0;
  const mom = prevMonthRevenue > 0 ? ((curMonthRevenue / prevMonthRevenue - 1) * 100) : 0;
  const gpPct = ytdRevenue > 0 ? (ytdGP / ytdRevenue * 100) : 0;

  // Row 1: title
  await writeValues("B2B", "A1", [[`B2B Dashboard — Wine & Whiskey | Обновлено: ${updatedAt}`]]);

  // Rows 3-4: KPI
  await writeValues("B2B", "A3", [
    ["Выручка YTD", "Заказов YTD", "GP YTD", "GP%", "Клиентов (тек. мес)", "MoM", "YoY"],
    [
      f(ytdRevenue) + " ฿", ytdOrders, f(ytdGP) + " ฿",
      gpPct.toFixed(1) + "%", activeThisMonth.size,
      (mom >= 0 ? "+" : "") + mom.toFixed(1) + "%",
      (yoy >= 0 ? "+" : "") + yoy.toFixed(1) + "%",
    ],
  ]);

  // Row 6+: Monthly dynamics (last 18 months, newest first)
  const last18 = lastNMonths(18).reverse();
  const dynHeader = ["Месяц", "Выручка, ฿", "Заказов", "Клиентов", "Ср. заказ, ฿", "GP, ฿", "GP%"];
  const dynRows: any[][] = [dynHeader];

  for (const ym of last18) {
    let rev = 0, ords = 0, gp = 0;
    const active = new Set<string>();
    for (const c of clients) {
      const m = c.byMonth.get(ym);
      if (m && m.orders > 0) { rev += m.revenue; ords += m.orders; gp += m.gp; active.add(c.name); }
    }
    const gpP = rev > 0 ? (gp / rev * 100) : 0;
    dynRows.push([monthLabel(ym), Math.round(rev), ords, active.size, ords > 0 ? Math.round(rev / ords) : 0, Math.round(gp), +gpP.toFixed(1)]);
  }

  const dynStartRow = 6; // 1-indexed
  await writeValues("B2B", `A${dynStartRow}`, dynRows);

  // Client activity matrix (last 12 months)
  const last12 = lastNMonths(12);
  const matrixStartRow = dynStartRow + 1 + last18.length + 2;
  const matrixHeader = ["Клиент / Месяц", ...last12.map(monthLabel)];
  const matrixRows: any[][] = [matrixHeader];

  for (const c of clients) {
    const row: (string | number)[] = [c.name];
    for (const ym of last12) {
      const rev = Math.round(c.byMonth.get(ym)?.revenue ?? 0);
      row.push(rev > 0 ? rev : "");
    }
    matrixRows.push(row);
  }
  await writeValues("B2B", `A${matrixStartRow}`, matrixRows);

  // Formatting
  const totalCols = 13;
  const fmtReqs: any[] = [
    hFmt(sheetId, 0, 1, 0, 7, dark, white),
    hFmt(sheetId, 2, 3, 0, 7, { red: 0.38, green: 0.38, blue: 0.38 }, white),
    hFmt(sheetId, dynStartRow - 1, dynStartRow, 0, 7, dark, white),
    hFmt(sheetId, matrixStartRow - 1, matrixStartRow, 0, totalCols, dark, white),
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 200 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 7 }, properties: { pixelSize: 120 }, fields: "pixelSize" } },
    { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: totalCols } } },
  ];
  await sheetsReq("POST", ":batchUpdate", { requests: fmtReqs });
}


// ─── Write B2B Клиент tab (dropdown + QUERY) ──────────────────────────────

async function writeClientTab(sheetId: number, clients: ClientStats[]) {
  await clearTab(sheetId);

  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  const gray  = { red: 0.38, green: 0.38, blue: 0.38 };

  const clientNames = clients.map(c => c.name);
  const firstClient = clientNames[0] ?? "";

  // Строки: 1=dropdown, 3=метки1, 4=значения1, 5=метки2, 6=значения2, 7=заголовок, 8=QUERY
  await writeValues("B2B Клиент", "A1", [["Клиент:", firstClient]], "RAW");
  await writeValues("B2B Клиент", "A3", [["Выручка всего", "", "Заказов", "", "GP", ""]], "RAW");
  await writeValues("B2B Клиент", "A5", [["Первый заказ", "", "Последний заказ", "", "Ср. заказ", ""]], "RAW");
  await writeValues("B2B Клиент", "A7", [["Динамика по месяцам"]], "RAW");

  const d = "B2BData";
  await writeCellFormulas(sheetId, [
    // Row 4 (idx 3) — значения блока 1
    { row: 3, col: 1, formula: `=SUMIF(${d}!A:A;B1;${d}!C:C)` },
    { row: 3, col: 3, formula: `=SUMIF(${d}!A:A;B1;${d}!D:D)` },
    { row: 3, col: 5, formula: `=SUMIF(${d}!A:A;B1;${d}!E:E)` },
    // Row 6 (idx 5) — значения блока 2
    { row: 5, col: 1, formula: `=IFERROR(MINIFS(${d}!G:G;${d}!A:A;B1);"—")` },
    { row: 5, col: 3, formula: `=IFERROR(MAXIFS(${d}!H:H;${d}!A:A;B1);"—")` },
    { row: 5, col: 5, formula: `=IFERROR(SUMIF(${d}!A:A;B1;${d}!C:C)/SUMIF(${d}!A:A;B1;${d}!D:D);"—")` },
    // Row 8 (idx 7) — помесячная динамика + GP%
    { row: 7, col: 0, formula: `=IFERROR(QUERY(${d}!A:F;"SELECT B, C, D, E, E/C*100 WHERE A = '"&B1&"' ORDER BY B DESC LABEL B 'Месяц', C 'Выручка ฿', D 'Заказов', E 'GP ฿', E/C*100 'GP%'";1);"Нет данных")` },
  ]);

  // Row 32+: pivot — revenue by product × month
  // Row 80+: pivot — qty by product × month
  const o = "B2BOrders";
  await writeValues("B2B Клиент", "A31", [["Выручка по товарам (฿), по месяцам"]], "RAW");
  await writeValues("B2B Клиент", "A79", [["Кол-во по товарам, по месяцам"]], "RAW");
  await writeCellFormulas(sheetId, [
    {
      row: 31, col: 0,
      formula: `=IF(COUNTIF(${o}!A:A;B1)=0;"Нет данных";IFERROR(QUERY(${o}!A:F;"SELECT C, SUM(F) WHERE A = '"&B1&"' GROUP BY C PIVOT B LABEL C 'Товар'";1);"Нет данных"))`,
    },
    {
      row: 79, col: 0,
      formula: `=IF(COUNTIF(${o}!A:A;B1)=0;"Нет данных";IFERROR(QUERY(${o}!A:F;"SELECT C, SUM(D) WHERE A = '"&B1&"' GROUP BY C PIVOT B LABEL C 'Товар'";1);"Нет данных"))`,
    },
  ]);

  // Formatting
  await sheetsReq("POST", ":batchUpdate", {
    requests: [
      hFmt(sheetId, 0, 1, 0, 6, dark, white),
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 6 },
          cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: gray } } },
          fields: "userEnteredFormat.textFormat",
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 6 },
          cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: gray } } },
          fields: "userEnteredFormat.textFormat",
        },
      },
      hFmt(sheetId, 6, 7, 0, 1, dark, white),
      hFmt(sheetId, 30, 31, 0, 1, dark, white),
      hFmt(sheetId, 78, 79, 0, 1, dark, white),
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 160 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 6 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
      {
        setDataValidation: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 },
          rule: {
            condition: { type: "ONE_OF_LIST", values: clientNames.map(v => ({ userEnteredValue: v })) },
            showCustomUi: true,
            strict: false,
          },
        },
      },
    ],
  });
}

// ─── Write Поставщик tab — static product pivots ──────────────────────────

async function writeSupplierDetailTab(token: string, rawOrders: any[]) {
  // Read which supplier is selected in B1
  const b1Resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent("Поставщик")}!B1`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(r => r.json());
  const supplierName = (b1Resp.values?.[0]?.[0] ?? "").trim();
  if (!supplierName) { console.log("  Поставщик: B1 empty, skipping."); return; }

  // Build product × month matrices for this supplier
  const revenueMap = new Map<string, Map<string, number>>(); // product → month → total
  const qtyMap     = new Map<string, Map<string, number>>(); // product → month → qty
  const months     = new Set<string>();

  for (const po of rawOrders) {
    if ((po.supplier ?? "").trim() !== supplierName) continue;
    const month = (po.order_date ?? "").slice(0, 7);
    if (!month) continue;
    months.add(month);
    for (const item of po.purchase_order_items ?? []) {
      const product = (item.product_name ?? "—").trim();
      if (!revenueMap.has(product)) revenueMap.set(product, new Map());
      if (!qtyMap.has(product))     qtyMap.set(product, new Map());
      revenueMap.get(product)!.set(month, (revenueMap.get(product)!.get(month) ?? 0) + (item.line_total  ?? 0));
      qtyMap.get(product)!.set(month,     (qtyMap.get(product)!.get(month)     ?? 0) + (item.qty_ordered ?? 0));
    }
  }

  const sortedMonths    = [...months].sort();
  const sortedProducts  = [...revenueMap.keys()].sort();

  const buildPivot = (dataMap: Map<string, Map<string, number>>) => {
    const header = ["Товар", ...sortedMonths];
    const rows: (string | number)[][] = [header];
    for (const product of sortedProducts) {
      const row: (string | number)[] = [product];
      for (const m of sortedMonths) row.push(dataMap.get(product)?.get(m) ?? "");
      rows.push(row);
    }
    return rows;
  };

  const revPivot = buildPivot(revenueMap);
  const qtyPivot = buildPivot(qtyMap);

  // Clear rows 55 onwards, then write both pivots
  const sheetMeta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());
  const sheet = (sheetMeta.sheets as any[]).find((s: any) => s.properties.title === "Поставщик");
  const sheetId = sheet?.properties?.sheetId;

  if (sheetId != null) {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ updateCells: { range: { sheetId, startRowIndex: 54 }, fields: "userEnteredValue" } }] }),
    });
  }

  const revStartRow = 55;
  const qtyStartRow = revStartRow + 1 + revPivot.length + 2;

  await writeValues("Поставщик", `A${revStartRow}`, [["Товары — сумма ฿ по месяцам"]]);
  await writeValues("Поставщик", `A${revStartRow + 1}`, revPivot);
  await writeValues("Поставщик", `A${qtyStartRow}`, [["Товары — кол-во по месяцам"]]);
  await writeValues("Поставщик", `A${qtyStartRow + 1}`, qtyPivot);

  console.log(`  Поставщик (${supplierName}): ${sortedProducts.length} products × ${sortedMonths.length} months.`);
}

// ─── Write SuppItems tab (data source for Поставщик formula) ──────────────

async function writeSuppItemsTab(sheetId: number, orders: any[]) {
  await clearTab(sheetId);

  const rows: any[][] = [["Supplier", "Month", "Product", "Qty", "Total"]];

  for (const po of orders) {
    const supplier = (po.supplier ?? "").trim();
    const month    = (po.order_date ?? "").slice(0, 7);
    for (const item of po.purchase_order_items ?? []) {
      rows.push([
        supplier,
        month,
        (item.product_name ?? "").trim(),
        item.qty_ordered ?? 0,
        item.line_total  ?? 0,
      ]);
    }
  }

  await writeValues("SuppItems", "A1", rows);

  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  await sheetsReq("POST", ":batchUpdate", {
    requests: [
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, foregroundColor: white } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { updateSheetProperties: { properties: { sheetId, hidden: true }, fields: "hidden" } },
    ],
  });

  console.log(`  SuppItems: ${rows.length - 1} item rows written.`);
}

// ─── Write Поставщики tab ──────────────────────────────────────────────────

async function writeSuppliersTab(sheetId: number, suppliers: SupplierStats[]) {
  await clearTab(sheetId);

  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  const wine  = { red: 0.48, green: 0.11, blue: 0.11 };
  const grayC = { red: 0.38, green: 0.38, blue: 0.38 };

  const f = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const last12 = lastNMonths(12).reverse(); // newest first

  const allRows: any[][] = [];
  const fmtReqs: any[] = [];
  let row = 0; // 0-indexed

  // Global title
  allRows.push([`Поставщики — Подготовка к встречам`, "", "", "", "", "", ""]);
  fmtReqs.push(hFmt(sheetId, row, row + 1, 0, 7, dark, white));
  row++;

  allRows.push([""]); row++; // spacer

  for (const s of suppliers) {
    // Supplier header
    allRows.push([s.name, "", "", "", "", "", ""]);
    fmtReqs.push(hFmt(sheetId, row, row + 1, 0, 7, wine, white));
    row++;

    // Summary stats
    const avgOrder = s.ordersCount > 0 ? s.totalThb / s.ordersCount : 0;
    allRows.push([
      "Всего закуплено", f(s.totalThb) + " ฿",
      "Заказов",         s.ordersCount,
      "Ср. заказ",       f(avgOrder) + " ฿",
      "",
    ]);
    allRows.push([
      "Первый заказ", s.firstOrder,
      "Последний заказ", s.lastOrder,
      "", "", "",
    ]);
    row += 2;

    // Monthly dynamics header
    allRows.push(["Месяц", "Сумма ฿", "", "Топ товаров", "Кол-во", "Сумма ฿", ""]);
    fmtReqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: 7 },
        cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: grayC } } },
        fields: "userEnteredFormat.textFormat",
      },
    });
    row++;

    const maxLines = Math.max(last12.length, s.topItems.length);
    for (let i = 0; i < maxLines; i++) {
      const ym  = last12[i];
      const amt = ym ? (s.byMonth.get(ym) ?? 0) : 0;
      const item = s.topItems[i];
      allRows.push([
        ym ? monthLabel(ym) : "",
        ym && amt > 0 ? Math.round(amt) : "",
        "",
        item ? item.product : "",
        item ? Math.round(item.qty) : "",
        item ? Math.round(item.total) : "",
        "",
      ]);
      row++;
    }

    allRows.push([""]); row++; // spacer between suppliers
  }

  await writeValues("Поставщики", "A1", allRows);

  if (fmtReqs.length > 0) {
    await sheetsReq("POST", ":batchUpdate", {
      requests: [
        ...fmtReqs,
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 220 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 }, properties: { pixelSize: 280 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 4, endIndex: 6 }, properties: { pixelSize: 100 }, fields: "pixelSize" } },
      ],
    });
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const now       = bangkokNow();
  const updatedAt = now.toISOString().slice(0, 16).replace("T", " ") + " BKK";

  console.log("\nWine & Whiskey — B2B Sync");
  console.log(`Updated: ${updatedAt}\n`);

  console.log("[1/2] Fetching B2B customer data from Loyverse...");
  const { clients, orders } = await fetchB2BData();
  console.log(`  ${clients.length} B2B clients, ${orders.length} order lines.\n`);

  console.log("[2/2] Fetching supplier data from Supabase...");
  const { stats: suppliers, rawOrders: poOrders } = await fetchSupplierData();
  console.log(`  ${suppliers.length} suppliers found.\n`);

  console.log("[3/4] Ensuring tabs...");
  const [b2bId, dataId, ordersId, clientId, suppliersId, suppItemsId, ordersListId] = await Promise.all([
    ensureTab("B2B"),
    ensureTab("B2BData"),
    ensureTab("B2BOrders"),
    ensureTab("B2B Клиент"),
    ensureTab("Поставщики"),
    ensureTab("SuppItems"),
    ensureTab("B2B Позиции"),
  ]);

  // Remove stale tabs
  const meta = await sheetsReq("GET", "");
  const toDelete = ["B2B_Данные"]
    .map(title => (meta.sheets ?? []).find((s: any) => s.properties.title === title))
    .filter(Boolean);
  if (toDelete.length > 0) {
    await sheetsReq("POST", ":batchUpdate", {
      requests: toDelete.map((s: any) => ({ deleteSheet: { sheetId: s.properties.sheetId } })),
    });
    console.log(`  ✓ Removed old tabs: ${toDelete.map((s: any) => s.properties.title).join(", ")}`);
  }

  console.log("[4/4] Writing sheets...");

  if (clients.length > 0) {
    await writeB2BDashboard(b2bId, clients, updatedAt);
    console.log("  ✓ B2B written.");

    await writeB2BDataTab(dataId, clients);
    console.log("  ✓ B2BData written.");

    await writeB2BOrdersTab(ordersId, orders);
    console.log("  ✓ B2BOrders written.");

    await writeClientTab(clientId, clients);
    console.log("  ✓ B2B Клиент written.");

    await writeB2BOrdersListTab(ordersListId, orders);
    console.log("  ✓ B2B Позиции written.");
  } else {
    console.log("  ⚠ No B2B clients found — skipped.");
  }

  if (suppliers.length > 0) {
    await writeSuppliersTab(suppliersId, suppliers);
    console.log("  ✓ Поставщики written.");
  }

  await writeSuppItemsTab(suppItemsId, poOrders);
  console.log("  ✓ SuppItems written.");

  await writeSupplierDetailTab(await gToken(), poOrders);
  console.log("  ✓ Поставщик written.");

  console.log(`\n✓ Done. → https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
