/**
 * channels_diagnostic.ts
 *
 * Pisses out a single sheet "Каналы B2C/B2B" with three blocks:
 *   1. Monthly split — revenue / margin / receipts B2C vs B2B for last 18 months
 *   2. Top B2B customers — last 18 months ranked by revenue, with margin & checks
 *   3. B2B customer × month matrix — see who bought when (regulars vs sporadics)
 *
 * This is the diagnostic counterpart to lib/sales_aggregate.ts — proves the
 * channel split works correctly and exposes the B2B side of the business in
 * one place.
 *
 * Usage: npx tsx 03_automation/channels_diagnostic.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { classifyReceipt } from "./lib/b2b.js";
import { loadB2BOverrides, canonicalize } from "./lib/b2b_overrides.js";

const SHEET_ID = "10EfJl0cfWj1GLoFXq9nHfZ4ZrlLcQloXs4ANRbt8HBg";
const TAB      = "Каналы B2C/B2B";
const PERIOD_MONTHS = 18;

const LOYVERSE_TOKEN       = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

// ─── Loyverse / Sheets boilerplate ────────────────────────────────────────

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

async function sheets(method: string, path: string, body?: unknown) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await gToken()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Sheets ${method} ${path}: ${await r.text()}`);
  return r.json();
}

async function ensureTab(title: string): Promise<number> {
  const meta = await sheets("GET", "");
  const existing = (meta.sheets ?? []).find((s: any) => s.properties.title === title);
  if (existing) return existing.properties.sheetId;
  const res = await sheets("POST", ":batchUpdate", { requests: [{ addSheet: { properties: { title } } }] });
  return res.replies[0].addSheet.properties.sheetId;
}

async function clearTab(sheetId: number) {
  await sheets("POST", ":batchUpdate", {
    requests: [
      { unmergeCells: { range: { sheetId } } },
      { updateCells: { range: { sheetId }, fields: "userEnteredValue,userEnteredFormat" } },
    ],
  });
}

async function writeRows(sheetId: number, startRow: number, startCol: number, rows: any[][]) {
  if (rows.length === 0) return;
  const maxCols = Math.max(...rows.map(r => r.length));
  await sheets("POST", ":batchUpdate", {
    requests: [{
      updateCells: {
        start: { sheetId, rowIndex: startRow, columnIndex: startCol },
        rows: rows.map(row => ({
          values: Array.from({ length: maxCols }, (_, j) => {
            const v = row[j];
            if (v == null || v === "") return { userEnteredValue: { stringValue: "" } };
            if (typeof v === "number" && Number.isFinite(v)) return { userEnteredValue: { numberValue: v } };
            return { userEnteredValue: { stringValue: String(v) } };
          }),
        })),
        fields: "userEnteredValue",
      },
    }],
  });
}

async function loyFetch<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const url = `https://api.loyverse.com/v1.0${path}${path.includes("?") ? "&" : "?"}limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` } });
    if (!r.ok) throw new Error(`Loyverse ${r.status}: ${path}`);
    const d = await r.json();
    out.push(...(d[key] ?? []));
    cursor = d.cursor;
  } while (cursor);
  return out;
}

async function fetchCustomerNames(ids: Set<string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all([...ids].map(async id => {
    try {
      const r = await fetch(`https://api.loyverse.com/v1.0/customers/${id}`, {
        headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` },
      });
      if (!r.ok) return;
      const c = await r.json();
      map.set(id, ((c.name ?? "").trim() || c.email || id.slice(0, 8)));
    } catch {}
  }));
  return map;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function bangkokDate(d: Date): Date { return new Date(d.getTime() + 7 * 3_600_000); }
function ymKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function lastNMonths(n: number): string[] {
  const now = bangkokDate(new Date());
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(ymKey(d));
  }
  return out;
}
const RU_M = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
function ymLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${RU_M[m - 1]} '${String(y).slice(2)}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nChannels diagnostic (B2C / B2B)\n");

  const months = lastNMonths(PERIOD_MONTHS);
  const fromIso = `${months[0]}-01`;
  const todayBkk = bangkokDate(new Date());
  const toIso = todayBkk.toISOString().slice(0, 10);
  console.log(`Period: ${fromIso} → ${toIso} (${PERIOD_MONTHS} months)`);

  console.log("[1/2] Fetching receipts...");
  const minUtc = new Date(`${fromIso}T00:00:00+07:00`).toISOString();
  const maxUtc = new Date(`${toIso}T23:59:59+07:00`).toISOString();
  const receipts: any[] = await loyFetch(
    `/receipts?receipt_type=SALE&created_at_min=${minUtc}&created_at_max=${maxUtc}`,
    "receipts",
  );
  console.log(`  ${receipts.length} receipts.`);

  const custIds = new Set<string>();
  for (const r of receipts) if (r.customer_id) custIds.add(r.customer_id);
  const custNames = await fetchCustomerNames(custIds);
  console.log(`  ${custNames.size}/${custIds.size} customer names.`);

  // User-tagged overrides (anonymous bank-transfer receipts → real client name)
  const overrides = await loadB2BOverrides();
  console.log(`  ${overrides.size} manual B2B-tag overrides loaded.`);

  console.log("[2/2] Aggregating by month and B2B customer...");

  // ── monthly split ──
  interface MonthBlock { revB2C: number; revB2B: number; costB2C: number; costB2B: number; chB2C: number; chB2B: number; }
  const byMonth = new Map<string, MonthBlock>();
  for (const m of months) byMonth.set(m, { revB2C: 0, revB2B: 0, costB2C: 0, costB2B: 0, chB2C: 0, chB2B: 0 });

  // ── B2B customer × month ──
  // Track active B2B customers; if a receipt is B2B by bank-transfer with no
  // customer_id, we tag it as "(no customer)".
  const b2bMonthly = new Map<string, Map<string, { rev: number; cost: number; checks: number }>>();
  const b2bSkuCount = new Map<string, Map<string, number>>(); // customer → sku name → units (bottle counts) — top SKUs

  // ── item names for B2B SKU breakdown ──
  const itemNameById = new Map<string, string>();
  // Lazy fetch only when needed
  async function ensureItemNames() {
    if (itemNameById.size > 0) return;
    const items: any[] = await loyFetch("/items", "items");
    for (const it of items) itemNameById.set(it.id, it.item_name ?? it.name ?? "—");
  }

  for (const r of receipts) {
    const created = new Date(r.created_at);
    const bkk = bangkokDate(created);
    const ym = ymKey(bkk);
    if (!byMonth.has(ym)) continue;
    let customerName = r.customer_id ? (custNames.get(r.customer_id) ?? "") : "";
    // Apply override from "B2B без customer" sheet for anonymous receipts
    if (!customerName) {
      const override = overrides.get(String(r.receipt_number ?? ""));
      if (override) customerName = override;
    } else {
      // Canonicalize known names so different spellings collapse
      customerName = canonicalize(customerName);
    }
    const cls = classifyReceipt({ payments: r.payments, customerName });
    let rev = 0, cost = 0;
    for (const li of r.line_items ?? []) {
      rev += Number(li.total_money ?? 0);
      cost += Number(li.cost_total ?? 0);
    }
    const m = byMonth.get(ym)!;
    if (cls.isB2B) {
      m.revB2B += rev; m.costB2B += cost; m.chB2B++;
      // Customer breakdown (skip anonymous bank-transfer receipts in customer matrix)
      const cKey = customerName || "(no customer)";
      let cm = b2bMonthly.get(cKey);
      if (!cm) { cm = new Map(); b2bMonthly.set(cKey, cm); }
      let cmRow = cm.get(ym);
      if (!cmRow) { cmRow = { rev: 0, cost: 0, checks: 0 }; cm.set(ym, cmRow); }
      cmRow.rev += rev; cmRow.cost += cost; cmRow.checks++;
      // Track SKU usage per B2B customer (only for known customers)
      if (customerName) {
        let skuMap = b2bSkuCount.get(cKey);
        if (!skuMap) { skuMap = new Map(); b2bSkuCount.set(cKey, skuMap); }
        for (const li of r.line_items ?? []) {
          if (!li.item_id) continue;
          const cur = skuMap.get(li.item_id) ?? 0;
          skuMap.set(li.item_id, cur + Number(li.quantity ?? 0));
        }
      }
    } else {
      m.revB2C += rev; m.costB2C += cost; m.chB2C++;
    }
  }

  if (b2bSkuCount.size > 0) await ensureItemNames();

  // ─── Build sheet ──────────────────────────────────────────────────────
  const sheetId = await ensureTab(TAB);
  await clearTab(sheetId);

  const rows: any[][] = [];
  rows.push([`Каналы B2C/B2B · ${months[0]} → ${months[months.length - 1]}`]);

  // Block 1: monthly split
  rows.push([]);
  rows.push(["МЕСЯЧНЫЙ РАЗРЕЗ"]);
  const m1HdrRow = rows.length - 1;
  rows.push(["Метрика", ...months.map(ymLabel), "Среднее"]);
  const monHdrRow = rows.length - 1;
  const monStart = rows.length;

  function pushMonthMetric(label: string, getter: (m: MonthBlock) => number, fmt: "฿" | "int") {
    const vals = months.map(m => Math.round(getter(byMonth.get(m)!)));
    const avg = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    rows.push([label, ...vals, avg]);
  }

  pushMonthMetric("B2C выручка",      m => m.revB2C, "฿");
  pushMonthMetric("B2B выручка",      m => m.revB2B, "฿");
  pushMonthMetric("Всего выручка",    m => m.revB2C + m.revB2B, "฿");
  rows.push([]);
  pushMonthMetric("B2C маржа",        m => m.revB2C - m.costB2C, "฿");
  pushMonthMetric("B2B маржа",        m => m.revB2B - m.costB2B, "฿");
  pushMonthMetric("Всего маржа",      m => (m.revB2C + m.revB2B) - (m.costB2C + m.costB2B), "฿");
  rows.push([]);
  pushMonthMetric("B2C чеков",        m => m.chB2C, "int");
  pushMonthMetric("B2B чеков",        m => m.chB2B, "int");
  rows.push([]);
  // B2B share of revenue (%)
  const b2bShare = months.map(ym => {
    const m = byMonth.get(ym)!;
    const total = m.revB2C + m.revB2B;
    return total > 0 ? Math.round((m.revB2B / total) * 1000) / 10 : 0;
  });
  const b2bShareAvg = Math.round(b2bShare.reduce((s, v) => s + v, 0) / b2bShare.length * 10) / 10;
  rows.push(["B2B доля выручки %", ...b2bShare, b2bShareAvg]);
  const monEnd = rows.length;

  // Block 2: B2B customer × month
  rows.push([]);
  rows.push(["B2B КЛИЕНТЫ × МЕСЯЦ (выручка ฿)"]);
  const m2HdrRow = rows.length - 1;
  rows.push(["Клиент", ...months.map(ymLabel), "Итого выручка", "Маржа", "Активных мес"]);
  const cstHdrRow = rows.length - 1;
  const cstStart = rows.length;

  // Order customers by total revenue desc
  const customerOrder = [...b2bMonthly.entries()]
    .map(([name, m]) => {
      let tot = 0, totCost = 0, active = 0;
      for (const v of m.values()) { tot += v.rev; totCost += v.cost; if (v.checks > 0) active++; }
      return { name, totalRev: tot, totalCost: totCost, totalMargin: tot - totCost, activeMonths: active, monthly: m };
    })
    .sort((a, b) => b.totalRev - a.totalRev);

  for (const c of customerOrder) {
    const cells: any[] = [c.name];
    for (const ym of months) {
      const v = c.monthly.get(ym);
      cells.push(v ? Math.round(v.rev) : 0);
    }
    cells.push(Math.round(c.totalRev), Math.round(c.totalMargin), c.activeMonths);
    rows.push(cells);
  }
  const cstEnd = rows.length;

  // Block 3: top SKUs per top-N B2B customer (used to seed "B2B reserve")
  rows.push([]);
  rows.push(["ТОП-SKU ПО B2B-КЛИЕНТАМ (что они системно берут)"]);
  const m3HdrRow = rows.length - 1;
  rows.push(["Клиент", "SKU", "Бутылок (за период)"]);
  const skuHdrRow = rows.length - 1;
  const skuStart = rows.length;
  // Limit to top 5 customers by revenue, top 5 SKUs each
  for (const c of customerOrder.slice(0, 6)) {
    const skuMap = b2bSkuCount.get(c.name);
    if (!skuMap) continue;
    const top = [...skuMap.entries()]
      .map(([id, qty]) => ({ id, qty, name: itemNameById.get(id) ?? id }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
    for (let i = 0; i < top.length; i++) {
      rows.push([i === 0 ? c.name : "", top[i].name, Math.round(top[i].qty)]);
    }
  }
  const skuEnd = rows.length;

  // Notes
  rows.push([]);
  rows.push(["Заметки:"]);
  rows.push(["  · B2B = чек с типом оплаты «банковский перевод» ИЛИ привязан к клиенту из B2B_PATTERNS (lib/b2b.ts)."]);
  rows.push(["  · Bella Chao Trade и Titov не зарегистрированы как Loyverse customers — их чеки попадают в B2C."]);
  rows.push(["  · «Активных мес» в блоке клиентов — сколько месяцев из периода клиент сделал хотя бы 1 чек."]);
  rows.push(["  · Топ-SKU по B2B нужны для построения B2B-резерва — отдельный лист на следующем шаге."]);

  await writeRows(sheetId, 0, 0, rows);

  // ─── Formatting ────────────────────────────────────────────────────────
  const FMT_BAHT = { type: "CURRENCY", pattern: "#,##0\\ \"฿\"" };
  const FMT_INT  = { type: "NUMBER",   pattern: "#,##0" };
  const FMT_PCT  = { type: "NUMBER",   pattern: "0.0\"%\"" };
  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  const fmt: any[] = [];
  const totalCols = 2 + months.length;

  fmt.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });
  fmt.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 280 }, fields: "pixelSize" } });
  for (let i = 1; i < totalCols + 3; i++) {
    fmt.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: 95 }, fields: "pixelSize" } });
  }

  // Title
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: totalCols },
      cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: totalCols }, mergeType: "MERGE_ALL" } });

  // Block 1 hdr
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: m1HdrRow, endRowIndex: m1HdrRow + 1, startColumnIndex: 0, endColumnIndex: totalCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.40, blue: 0.20 }, textFormat: { bold: true, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: m1HdrRow, endRowIndex: m1HdrRow + 1, startColumnIndex: 0, endColumnIndex: totalCols }, mergeType: "MERGE_ALL" } });
  // Monthly column headers
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: monHdrRow, endRowIndex: monHdrRow + 1, startColumnIndex: 0, endColumnIndex: totalCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // Money rows = ฿; check rows = int; share row = %
  // We know the structure: rows monStart..monStart+9
  // 0,1,2 = revenue ฿
  // 3 blank
  // 4,5,6 = margin ฿
  // 7 blank
  // 8,9 = checks int
  // 10 blank
  // 11 = b2b share %
  function formatRowAs(rowIdx: number, fmtSpec: any) {
    if (rowIdx >= monStart && rowIdx < monEnd) {
      fmt.push({
        repeatCell: {
          range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 1, endColumnIndex: totalCols },
          cell: { userEnteredFormat: { numberFormat: fmtSpec, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
    }
  }
  // money rows: 0,1,2 (offsets from monStart) and 4,5,6
  for (const off of [0, 1, 2, 4, 5, 6]) formatRowAs(monStart + off, FMT_BAHT);
  // checks rows: 8,9
  for (const off of [8, 9]) formatRowAs(monStart + off, FMT_INT);
  // share row: 11
  formatRowAs(monStart + 11, FMT_PCT);
  // bold "Всего" rows
  for (const off of [2, 6]) {
    fmt.push({
      repeatCell: {
        range: { sheetId, startRowIndex: monStart + off, endRowIndex: monStart + off + 1, startColumnIndex: 0, endColumnIndex: totalCols },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat",
      },
    });
  }

  // Block 2 hdr (B2B customer × month)
  const cstTotalCols = 1 + months.length + 3;
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: m2HdrRow, endRowIndex: m2HdrRow + 1, startColumnIndex: 0, endColumnIndex: cstTotalCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.45, green: 0.36, blue: 0.08 }, textFormat: { bold: true, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: m2HdrRow, endRowIndex: m2HdrRow + 1, startColumnIndex: 0, endColumnIndex: cstTotalCols }, mergeType: "MERGE_ALL" } });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: cstHdrRow, endRowIndex: cstHdrRow + 1, startColumnIndex: 0, endColumnIndex: cstTotalCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // Money cells in customer table
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: cstStart, endRowIndex: cstEnd, startColumnIndex: 1, endColumnIndex: cstTotalCols - 1 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // Active months int
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: cstStart, endRowIndex: cstEnd, startColumnIndex: cstTotalCols - 1, endColumnIndex: cstTotalCols },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });

  // Block 3 (top SKU per customer)
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: m3HdrRow, endRowIndex: m3HdrRow + 1, startColumnIndex: 0, endColumnIndex: 5 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.55, green: 0.13, blue: 0.13 }, textFormat: { bold: true, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: m3HdrRow, endRowIndex: m3HdrRow + 1, startColumnIndex: 0, endColumnIndex: 5 }, mergeType: "MERGE_ALL" } });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: skuHdrRow, endRowIndex: skuHdrRow + 1, startColumnIndex: 0, endColumnIndex: 3 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: skuStart, endRowIndex: skuEnd, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });

  await sheets("POST", ":batchUpdate", { requests: fmt });
  console.log(`\n✓ "${TAB}" written.`);
  console.log(`→ https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
