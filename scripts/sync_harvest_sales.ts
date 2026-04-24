/**
 * sync_harvest_sales.ts
 * Tracks sales of Russia-category items (Harvest Creation consignment).
 * Updates "Реализация Harvest" tab in the operations dashboard.
 *
 * Payment logic:
 *   - Period accumulates sales from periodStart (initially 14.04.2026) to today.
 *   - On the 1st of each month, operator marks as paid (sets cell G2 = TRUE).
 *   - Next run detects paid flag, records payment date, starts new period.
 *
 * Usage:
 *   npx tsx scripts/sync_harvest_sales.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SHEET_ID             = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const TAB_NAME             = "Реализация Harvest";
const PO_ITEMS_TAB         = "PO Items";
const HARVEST_SUPPLIER     = "Harvest Creation";
const DEFAULT_PERIOD_START = "2026-04-14";  // last inventory date

const LOYVERSE_TOKEN       = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

// ─── Bangkok helpers ───────────────────────────────────────────────────────────

function bangkokNow() {
  return new Date(Date.now() + 7 * 3_600_000);
}
function bangkokToday() {
  return bangkokNow().toISOString().slice(0, 10);
}
function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
function nextPaymentDate(today = bangkokToday()) {
  const [y, m] = today.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return next;
}

// ─── Google Sheets ─────────────────────────────────────────────────────────────

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

async function gApi(method: string, path: string, body?: unknown) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await gToken()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Sheets ${method} ${path}: ${await r.text()}`);
  return r.json();
}

async function ensureTab(title: string): Promise<number> {
  const meta = await gApi("GET", "");
  const existing = (meta.sheets ?? []).find((s: any) => s.properties.title === title);
  if (existing) return existing.properties.sheetId;
  const res = await gApi("POST", ":batchUpdate", {
    requests: [{ addSheet: { properties: { title } } }],
  });
  return res.replies[0].addSheet.properties.sheetId;
}

async function readRange(range: string): Promise<string[][]> {
  try {
    const r = await gApi("GET", `/values/${encodeURIComponent(range)}`);
    return r.values ?? [];
  } catch { return []; }
}

// ─── Loyverse ──────────────────────────────────────────────────────────────────

async function loyFetch<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const url = `https://api.loyverse.com/v1.0${path}${sep}limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` } });
    if (!r.ok) throw new Error(`Loyverse ${r.status}: ${path}`);
    const d = await r.json();
    out.push(...(d[key] ?? []));
    cursor = d.cursor;
  } while (cursor);
  return out;
}

interface LoyItem {
  item_id: string; item_name: string;
  variants: { variant_id: string; sku: string; purchase_cost: number | null }[];
}
interface LoyReceipt {
  receipt_number: string; receipt_date: string;
  line_items: {
    variant_id: string; item_name: string; sku: string;
    quantity: number; price: number;
    total_money: number; cost: number; cost_total: number;
  }[];
}

// ─── Color helpers (Sheets API rgb objects) ────────────────────────────────────

function rgb(h: string) {
  return {
    red:   parseInt(h.slice(1, 3), 16) / 255,
    green: parseInt(h.slice(3, 5), 16) / 255,
    blue:  parseInt(h.slice(5, 7), 16) / 255,
  };
}
const C = {
  black:    rgb("#1A1A1A"), cream:   rgb("#F5F0EB"), cream2:  rgb("#EDE0D0"),
  stone:    rgb("#D4C9BC"), red:     rgb("#8C1C1C"), gold:    rgb("#C9A84C"),
  graphite: rgb("#3D3D3D"), white:   rgb("#FFFFFF"), rowA:    rgb("#F5F0EB"),
  rowB:     rgb("#FAF6F2"), navy:    rgb("#1C2B3A"), green:   rgb("#1A6B3C"),
  muted:    rgb("#585350"),
};

function fmt(bg: any, fg: any, size = 9, bold = false, hAlign = "LEFT", italic = false, wrap = false) {
  return {
    backgroundColor: bg,
    textFormat: { fontFamily: "Arial", fontSize: size, bold, italic, foregroundColor: fg },
    horizontalAlignment: hAlign,
    verticalAlignment: "MIDDLE",
    wrapStrategy: wrap ? "WRAP" : "CLIP",
  };
}
function cStr(text: string, f: any)  { return { userEnteredValue: { stringValue: text }, userEnteredFormat: f }; }
function cNum(n: number, f: any, pattern?: string) {
  const obj: any = { userEnteredValue: { numberValue: n }, userEnteredFormat: { ...f } };
  if (pattern) obj.userEnteredFormat.numberFormat = { type: "NUMBER", pattern };
  return obj;
}
function cEmpty(f: any) { return { userEnteredFormat: f }; }

// ─── Build sheet ───────────────────────────────────────────────────────────────

interface SaleRow { name: string; sku: string; qty: number; revenue: number; cost: number; }

function buildSheet(
  tabId: number,
  periodStart: string,
  today: string,
  isPaid: boolean,
  rows: SaleRow[],
) {
  const data: any[]  = [];
  const merges: any[] = [];
  const heights: { ri: number; h: number }[] = [];

  function addRow(cells: any[], h?: number) {
    const ri = data.length;
    data.push({ values: cells });
    if (h) heights.push({ ri, h });
    return ri;
  }
  function merge(ri: number, c1: number, c2: number) {
    merges.push({ mergeCells: {
      range: { sheetId: tabId, startRowIndex: ri, endRowIndex: ri + 1,
               startColumnIndex: c1, endColumnIndex: c2 },
      mergeType: "MERGE_ALL",
    }});
  }

  const totalCols = 7;

  // ── STATE ROW (row 0, index 0) — hidden, machine-readable ─────────────────
  // A=periodStart B=today(updated) C=isPaid D=paidDate(set when paid)
  addRow([
    cStr(periodStart, fmt(C.white, C.white, 7)),
    cStr(today,       fmt(C.white, C.white, 7)),
    cStr(isPaid ? "TRUE" : "FALSE", fmt(C.white, C.white, 7)),
    cStr("",          fmt(C.white, C.white, 7)),
    ...Array(3).fill(cEmpty(fmt(C.white, C.white))),
  ], 3);  // very short row — effectively hidden

  // ── TITLE BAR ─────────────────────────────────────────────────────────────
  let ri = addRow([
    cStr("РЕАЛИЗАЦИЯ  ·  HARVEST CREATION", fmt(C.black, C.cream, 14, true, "LEFT")),
    ...Array(totalCols - 1).fill(cEmpty(fmt(C.black, C.cream))),
  ], 40);
  merge(ri, 0, totalCols);

  // ── SUBTITLE: period range ─────────────────────────────────────────────────
  ri = addRow([
    cStr(`  Период: ${fmtDate(periodStart)} — ${fmtDate(today)}  ·  цены в THB`,
      fmt(C.black, C.muted, 8, false, "LEFT")),
    ...Array(totalCols - 1).fill(cEmpty(fmt(C.black, C.muted))),
  ], 20);
  merge(ri, 0, totalCols);

  // ── RED BAR ────────────────────────────────────────────────────────────────
  ri = addRow(Array(totalCols).fill(cEmpty(fmt(C.red, C.red))), 4);
  merge(ri, 0, totalCols);

  // ── STATUS ROW ────────────────────────────────────────────────────────────
  const nextPay    = nextPaymentDate(today);
  const statusBg   = isPaid ? C.green : C.navy;
  const statusText = isPaid ? `✓  ОПЛАЧЕНО` : `К ОПЛАТЕ  ·  ${fmtDate(nextPay)}`;
  ri = addRow([
    cStr("  СТАТУС:", fmt(statusBg, C.stone, 8, false, "LEFT")),
    cStr(statusText,  fmt(statusBg, isPaid ? C.cream : C.gold, 9, true, "LEFT")),
    cEmpty(fmt(statusBg, C.gold)), cEmpty(fmt(statusBg, C.gold)),
    cEmpty(fmt(statusBg, C.gold)), cEmpty(fmt(statusBg, C.gold)),
    cStr(isPaid ? "" : "← установить TRUE = оплачено",
      fmt(statusBg, C.muted, 7, false, "RIGHT", true)),
  ], 28);

  // ── PAID CHECKBOX ROW ─────────────────────────────────────────────────────
  ri = addRow([
    cStr("  Отметить как оплачено:", fmt(C.cream2, C.graphite, 8, false, "LEFT")),
    cEmpty(fmt(C.cream2, C.graphite)), cEmpty(fmt(C.cream2, C.graphite)),
    cEmpty(fmt(C.cream2, C.graphite)), cEmpty(fmt(C.cream2, C.graphite)),
    cEmpty(fmt(C.cream2, C.graphite)),
    // G6 = checkbox cell (script reads this on next run)
    { userEnteredValue: { boolValue: isPaid }, userEnteredFormat: fmt(C.cream2, C.graphite, 11, true, "CENTER") },
  ], 28);
  // checkbox row index for reference in batchUpdate
  const checkboxRowIdx = ri;

  // ── BLANK ─────────────────────────────────────────────────────────────────
  ri = addRow(Array(totalCols).fill(cEmpty(fmt(C.white, C.white))), 8);
  merge(ri, 0, totalCols);

  // ── COLUMN HEADERS ────────────────────────────────────────────────────────
  ri = addRow([
    cStr("#",          fmt(C.cream2, C.graphite, 8, true, "CENTER")),
    cStr("ТОВАР",      fmt(C.cream2, C.graphite, 8, true, "LEFT")),
    cStr("SKU",        fmt(C.cream2, C.graphite, 8, true, "LEFT")),
    cStr("КОЛ-ВО",    fmt(C.cream2, C.graphite, 8, true, "CENTER")),
    cStr("ВЫРУЧКА",   fmt(C.cream2, C.graphite, 8, true, "RIGHT")),
    cStr("СЕБЕСТОИМ.", fmt(C.cream2, C.graphite, 8, true, "RIGHT")),
    cStr("К ОПЛАТЕ",  fmt(C.cream2, C.graphite, 8, true, "RIGHT")),
  ], 26);

  // ── DATA ROWS ─────────────────────────────────────────────────────────────
  let totalRevenue = 0, totalCost = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const bg = i % 2 === 0 ? C.rowA : C.rowB;
    ri = addRow([
      cNum(i + 1,        fmt(bg, C.stone,    8, false, "CENTER")),
      cStr(row.name,     fmt(bg, C.black,    9, true,  "LEFT", false, true)),
      cStr(row.sku,      fmt(bg, C.muted,    8, false, "LEFT")),
      cNum(row.qty,      fmt(bg, C.graphite, 9, false, "CENTER"), "0"),
      cNum(row.revenue,  fmt(bg, C.graphite, 9, false, "RIGHT"),  "#,##0"),
      cNum(row.cost,     fmt(bg, C.graphite, 9, false, "RIGHT"),  "#,##0"),
      cNum(row.cost,     fmt(bg, C.red,      9, true,  "RIGHT"),  "#,##0"),
    ], 36);
    totalRevenue += row.revenue;
    totalCost    += row.cost;
  }

  if (rows.length === 0) {
    ri = addRow([
      cStr("  Нет продаж за выбранный период", fmt(C.rowA, C.muted, 8, false, "LEFT", true)),
      ...Array(totalCols - 1).fill(cEmpty(fmt(C.rowA, C.muted))),
    ], 36);
    merge(ri, 0, totalCols);
  }

  // ── DIVIDER ───────────────────────────────────────────────────────────────
  ri = addRow(Array(totalCols).fill(cEmpty(fmt(C.stone, C.stone))), 3);
  merge(ri, 0, totalCols);

  // ── TOTAL ROW ─────────────────────────────────────────────────────────────
  ri = addRow([
    cStr("ИТОГО К ОПЛАТЕ", fmt(C.black, C.cream, 11, true, "RIGHT")),
    cEmpty(fmt(C.black, C.cream)), cEmpty(fmt(C.black, C.cream)), cEmpty(fmt(C.black, C.cream)),
    cNum(totalRevenue, fmt(C.black, C.muted, 10, false, "RIGHT"), "#,##0 \"฿\""),
    cNum(totalCost,    fmt(C.black, C.muted, 10, false, "RIGHT"), "#,##0 \"฿\""),
    cNum(totalCost,    fmt(C.black, C.gold,  13, true,  "RIGHT"), "#,##0 \"฿\""),
  ], 46);
  merge(ri, 0, 4);

  return { data, merges, heights, checkboxRowIdx };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const today = bangkokToday();
  console.log("📅 Сегодня (Bangkok):", today);

  // 1. Google auth + ensure tab
  console.log("🔑 Авторизация Google...");
  const tabId = await ensureTab(TAB_NAME);

  // 2. Read state from row 0 of the tab
  const stateData = await readRange(`${TAB_NAME}!A1:D1`);
  let periodStart = DEFAULT_PERIOD_START;
  let isPaid      = false;

  if (stateData.length > 0 && stateData[0][0]) {
    periodStart = stateData[0][0];
    // Column C = isPaid flag (G6 checkbox value, synced back to A1:D1 on each run)
    isPaid = stateData[0][2] === "TRUE";
  }

  // 3. Read checkbox (G6 = row index 5, col index 6)
  const checkboxData = await readRange(`${TAB_NAME}!G6`);
  const checkboxValue = checkboxData?.[0]?.[0]?.toUpperCase();
  if (checkboxValue === "TRUE" || checkboxValue === "ИСТИНА") {
    // User marked as paid on this run
    if (!isPaid) {
      console.log("✅ Период отмечен как ОПЛАЧЕНО — обновляем и начинаем новый период");
      // Record payment date, shift period start to tomorrow
      const paidDate = today;
      // New period starts from 1st of next month
      const [y, m] = today.split("-").map(Number);
      const newStart = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      periodStart = newStart;
      isPaid = false;
      // Write new period start back to state row
      await gApi("PUT", `/values/${encodeURIComponent(`${TAB_NAME}!A1`)}?valueInputOption=RAW`, {
        range: `${TAB_NAME}!A1`, majorDimension: "ROWS",
        values: [[newStart, today, "FALSE", paidDate]],
      });
      console.log(`   Новый период: с ${newStart}`);
    }
  }

  // 4. Get Harvest SKUs from PO Items sheet
  console.log("📋 Читаю PO Items для Harvest Creation...");
  const poData = await readRange(`${PO_ITEMS_TAB}!A2:J2000`);
  // Columns: PO# | Date | Month | Year | Supplier | Status | Item | SKU | Qty | Cost
  const harvestSkus = new Set<string>();
  for (const row of poData) {
    if (row[4] === HARVEST_SUPPLIER && row[7]) harvestSkus.add(row[7].trim());
  }
  console.log(`   ${harvestSkus.size} уникальных SKU от Harvest: ${[...harvestSkus].join(", ")}`);

  // 5. Find Loyverse variant_ids for those SKUs
  console.log("🍷 Ищу варианты в Loyverse по SKU...");
  // Fetch all items to build SKU→variant map (paginated)
  const allItems = await loyFetch<LoyItem>("/items?limit=250", "items");
  const variantMap = new Map<string, { name: string; sku: string }>();
  for (const item of allItems) {
    for (const v of item.variants ?? []) {
      const sku = (v.sku ?? "").trim();
      if (harvestSkus.has(sku)) {
        variantMap.set(v.variant_id, { name: item.item_name, sku });
      }
    }
  }
  console.log(`   Найдено ${variantMap.size} вариантов из ${harvestSkus.size} SKU`);
  // Warn about unmatched SKUs
  const matchedSkus = new Set([...variantMap.values()].map(v => v.sku));
  const unmatched   = [...harvestSkus].filter(s => !matchedSkus.has(s));
  if (unmatched.length) console.log(`   ⚠️  Не найдены в Loyverse: ${unmatched.join(", ")}`);

  // 6. Fetch receipts (UTC ISO — Loyverse doesn't accept +07:00 offsets)
  const periodStartUtc = new Date(`${periodStart}T00:00:00+07:00`).toISOString();
  const todayEndUtc    = new Date(`${today}T23:59:59+07:00`).toISOString();
  console.log(`📊 Загружаю продажи ${fmtDate(periodStart)} — ${fmtDate(today)}...`);
  const receipts = await loyFetch<LoyReceipt>(
    `/receipts?receipt_type=SALE&created_at_min=${periodStartUtc}&created_at_max=${todayEndUtc}`,
    "receipts"
  );
  console.log(`   ${receipts.length} чеков`);

  // 7. Aggregate Harvest item sales by variant
  const agg = new Map<string, SaleRow>();
  for (const receipt of receipts) {
    for (const li of receipt.line_items ?? []) {
      if (!variantMap.has(li.variant_id)) continue;
      const info = variantMap.get(li.variant_id)!;
      const key  = li.variant_id;
      const cur  = agg.get(key) ?? { name: info.name, sku: info.sku, qty: 0, revenue: 0, cost: 0 };
      agg.set(key, {
        ...cur,
        qty:     cur.qty     + (li.quantity    ?? 0),
        revenue: cur.revenue + (li.total_money ?? 0),
        cost:    cur.cost    + (li.cost_total  ?? 0),
      });
    }
  }

  const saleRows: SaleRow[] = [...agg.values()]
    .filter(r => r.qty > 0)
    .sort((a, b) => b.revenue - a.revenue);

  console.log(`   ${saleRows.length} позиций продано`);
  saleRows.forEach(r => console.log(`   ${r.name} (${r.sku}): ${r.qty} шт. / ${r.revenue.toFixed(0)} ฿`));

  // 7. Build + write sheet
  console.log("📝 Обновляю лист...");
  const { data, merges, heights, checkboxRowIdx } = buildSheet(
    tabId, periodStart, today, isPaid, saleRows
  );

  // Delete + recreate tab for clean state
  const meta = await gApi("GET", "");
  const existingSheet = meta.sheets.find((s: any) => s.properties.title === TAB_NAME);
  if (existingSheet) {
    await gApi("POST", ":batchUpdate", {
      requests: [{ deleteSheet: { sheetId: existingSheet.properties.sheetId } }],
    });
  }
  const addRes = await gApi("POST", ":batchUpdate", {
    requests: [{ addSheet: { properties: { title: TAB_NAME, gridProperties: { rowCount: 200, columnCount: 7 } } } }],
  });
  const newTabId = addRes.replies[0].addSheet.properties.sheetId;

  // Rebuild with correct tabId
  const built = buildSheet(newTabId, periodStart, today, isPaid, saleRows);

  const requests: any[] = [
    { updateCells: {
        rows: built.data,
        fields: "userEnteredValue,userEnteredFormat",
        start: { sheetId: newTabId, rowIndex: 0, columnIndex: 0 },
    }},
    // Column widths: A=40(#) B=260(name) C=100(sku) D=70(qty) E=100(rev) F=100(cost) G=110(topay)
    ...[40, 260, 100, 70, 100, 100, 110].map((px, i) => ({
      updateDimensionProperties: {
        range: { sheetId: newTabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px }, fields: "pixelSize",
      },
    })),
    ...built.heights.map(({ ri, h }) => ({
      updateDimensionProperties: {
        range: { sheetId: newTabId, dimension: "ROWS", startIndex: ri, endIndex: ri + 1 },
        properties: { pixelSize: h }, fields: "pixelSize",
      },
    })),
    ...built.merges,
    // Freeze first 8 rows (state + header + status + checkbox + blank + headers)
    { updateSheetProperties: {
        properties: { sheetId: newTabId, gridProperties: { frozenRowCount: 8 } },
        fields: "gridProperties.frozenRowCount",
    }},
    // Add checkbox data validation to G6 (checkboxRowIdx=5, col=6)
    { setDataValidation: {
        range: { sheetId: newTabId, startRowIndex: 5, endRowIndex: 6,
                 startColumnIndex: 6, endColumnIndex: 7 },
        rule: { condition: { type: "BOOLEAN" }, strict: true, showCustomUi: true },
    }},
    // Hide state row (row 0)
    { updateDimensionProperties: {
        range: { sheetId: newTabId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
        properties: { hiddenByUser: true }, fields: "hiddenByUser",
    }},
  ];

  await gApi("POST", ":batchUpdate", { requests });

  const totalCost = saleRows.reduce((s, r) => s + r.cost, 0);
  console.log("");
  console.log("✅  Готово!");
  console.log(`   Период: ${fmtDate(periodStart)} — ${fmtDate(today)}`);
  console.log(`   Позиций: ${saleRows.length}`);
  console.log(`   К оплате Harvest: ${totalCost.toFixed(0)} ฿`);
  console.log(`   Следующий платёж: ${fmtDate(nextPaymentDate(today))}`);
  console.log(`   https://docs.google.com/spreadsheets/d/${SHEET_ID}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
