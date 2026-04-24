/**
 * sync_harvest_sales.ts
 * Tracks sales of Harvest Creation consignment items.
 * Updates "Реализация Harvest" tab in the operations dashboard.
 *
 * Payment cycle:
 *   1. Sales accumulate from periodStart (initially 14.04.2026).
 *   2. Operator sets checkbox G6 = TRUE after paying Harvest.
 *   3. Script (22:15 Bangkok) detects checkbox → archives period → starts new one from tomorrow.
 *   4. All paid periods stay visible below the current one.
 *
 * State is stored as JSON in hidden row 1 (cell A1).
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
const DEFAULT_PERIOD_START = "2026-04-14";

const LOYVERSE_TOKEN       = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bangkokToday() {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}
function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
function nextPaymentDate(today = bangkokToday()) {
  const [y, m] = today.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
function tomorrow(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// ─── State ────────────────────────────────────────────────────────────────────

interface SaleRow { name: string; sku: string; qty: number; revenue: number; cost: number; }

interface ClosedPeriod {
  start: string; end: string; paidDate: string;
  totalRevenue: number; totalCost: number;
  rows: SaleRow[];
}

interface State {
  currentStart: string;
  closedPeriods: ClosedPeriod[];
}

function defaultState(): State {
  return { currentStart: DEFAULT_PERIOD_START, closedPeriods: [] };
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
  item_name: string;
  variants: { variant_id: string; sku: string }[];
}
interface LoyReceipt {
  payments: { name: string; money_amount: number }[];
  line_items: {
    variant_id: string; item_name: string; sku: string;
    quantity: number; total_money: number; cost_total: number;
  }[];
}

function isBankTransfer(receipt: LoyReceipt): boolean {
  return (receipt.payments ?? []).some(p => /bank.?transfer/i.test(p.name ?? ""));
}

interface PeriodSales { ours: SaleRow[]; bankTransfer: SaleRow[]; }

async function fetchSalesForPeriod(
  periodStart: string,
  periodEnd: string,
  variantMap: Map<string, { name: string; sku: string }>,
): Promise<PeriodSales> {
  const minUtc = new Date(`${periodStart}T00:00:00+07:00`).toISOString();
  const maxUtc = new Date(`${periodEnd}T23:59:59+07:00`).toISOString();
  const receipts = await loyFetch<LoyReceipt>(
    `/receipts?receipt_type=SALE&created_at_min=${minUtc}&created_at_max=${maxUtc}`,
    "receipts",
  );
  const aggOurs = new Map<string, SaleRow>();
  const aggBank = new Map<string, SaleRow>();
  for (const receipt of receipts) {
    const agg = isBankTransfer(receipt) ? aggBank : aggOurs;
    for (const li of receipt.line_items ?? []) {
      if (!variantMap.has(li.variant_id)) continue;
      const info = variantMap.get(li.variant_id)!;
      const cur  = agg.get(li.variant_id) ?? { name: info.name, sku: info.sku, qty: 0, revenue: 0, cost: 0 };
      agg.set(li.variant_id, {
        ...cur,
        qty:     cur.qty     + (li.quantity    ?? 0),
        revenue: cur.revenue + (li.total_money ?? 0),
        cost:    cur.cost    + (li.cost_total  ?? 0),
      });
    }
  }
  const sort = (m: Map<string, SaleRow>) =>
    [...m.values()].filter(r => r.qty > 0).sort((a, b) => b.revenue - a.revenue);
  return { ours: sort(aggOurs), bankTransfer: sort(aggBank) };
}

// ─── Colors ────────────────────────────────────────────────────────────────────

function rgb(h: string) {
  return { red: parseInt(h.slice(1,3),16)/255, green: parseInt(h.slice(3,5),16)/255, blue: parseInt(h.slice(5,7),16)/255 };
}
const C = {
  black:    rgb("#1A1A1A"), cream:   rgb("#F5F0EB"), cream2:  rgb("#EDE0D0"),
  stone:    rgb("#D4C9BC"), red:     rgb("#8C1C1C"), gold:    rgb("#C9A84C"),
  graphite: rgb("#3D3D3D"), white:   rgb("#FFFFFF"), rowA:    rgb("#F5F0EB"),
  rowB:     rgb("#FAF6F2"), navy:    rgb("#1C2B3A"), green:   rgb("#1A6B3C"),
  muted:    rgb("#585350"), archive: rgb("#2A2A2A"),
};

function fmt(bg: any, fg: any, size = 9, bold = false, hAlign = "LEFT", italic = false, wrap = false) {
  return {
    backgroundColor: bg, verticalAlignment: "MIDDLE", wrapStrategy: wrap ? "WRAP" : "CLIP",
    horizontalAlignment: hAlign,
    textFormat: { fontFamily: "Arial", fontSize: size, bold, italic, foregroundColor: fg },
  };
}
function cStr(v: string, f: any)  { return { userEnteredValue: { stringValue: v }, userEnteredFormat: f }; }
function cNum(n: number, f: any, pattern?: string) {
  const obj: any = { userEnteredValue: { numberValue: n }, userEnteredFormat: { ...f } };
  if (pattern) obj.userEnteredFormat.numberFormat = { type: "NUMBER", pattern };
  return obj;
}
function cEmpty(f: any) { return { userEnteredFormat: f }; }

// ─── Build sheet ───────────────────────────────────────────────────────────────

function buildSheet(tabId: number, state: State, currentSales: PeriodSales, today: string) {
  const { ours: currentRows, bankTransfer: bankRows } = currentSales;
  const data:    any[] = [];
  const merges:  any[] = [];
  const heights: { ri: number; h: number }[] = [];
  const COLS = 7;

  function row(cells: any[], h?: number) {
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
  function divider(color: any) {
    const ri = row(Array(COLS).fill(cEmpty(fmt(color, color))), 4);
    merge(ri, 0, COLS);
  }
  function sectionLabel(text: string, bg: any, fg: any) {
    const ri = row([cStr(text, fmt(bg, fg, 8, true, "LEFT")), ...Array(COLS-1).fill(cEmpty(fmt(bg, fg)))], 24);
    merge(ri, 0, COLS);
  }
  function colHeaders(bg: any) {
    row([
      cStr("#",          fmt(bg, C.graphite, 8, true, "CENTER")),
      cStr("ТОВАР",      fmt(bg, C.graphite, 8, true, "LEFT")),
      cStr("SKU",        fmt(bg, C.graphite, 8, true, "LEFT")),
      cStr("КОЛ-ВО",    fmt(bg, C.graphite, 8, true, "CENTER")),
      cStr("ВЫРУЧКА",   fmt(bg, C.graphite, 8, true, "RIGHT")),
      cStr("СЕБЕСТОИМ.", fmt(bg, C.graphite, 8, true, "RIGHT")),
      cStr("К ОПЛАТЕ",  fmt(bg, C.graphite, 8, true, "RIGHT")),
    ], 26);
  }
  function dataRows(rows: SaleRow[], dimmed = false) {
    const nameFg = dimmed ? C.muted : C.black;
    const costFg = dimmed ? C.muted : C.red;
    for (let i = 0; i < rows.length; i++) {
      const r   = rows[i];
      const bg  = i % 2 === 0 ? C.rowA : C.rowB;
      row([
        cNum(i + 1,    fmt(bg, C.stone,   8, false, "CENTER")),
        cStr(r.name,   fmt(bg, nameFg,    9, !dimmed, "LEFT", false, true)),
        cStr(r.sku,    fmt(bg, C.muted,   8, false, "LEFT")),
        cNum(r.qty,    fmt(bg, C.graphite,9, false, "CENTER"), "0"),
        cNum(r.revenue,fmt(bg, C.graphite,9, false, "RIGHT"),  "#,##0"),
        cNum(r.cost,   fmt(bg, C.graphite,9, false, "RIGHT"),  "#,##0"),
        cNum(r.cost,   fmt(bg, costFg,    9, !dimmed,"RIGHT"),  "#,##0"),
      ], 34);
    }
    if (rows.length === 0) {
      const ri = row([cStr("  Нет продаж за период", fmt(C.rowA, C.muted, 8, false, "LEFT", true)),
        ...Array(COLS-1).fill(cEmpty(fmt(C.rowA, C.muted)))], 34);
      merge(ri, 0, COLS);
    }
  }
  function totalRow(totalRevenue: number, totalCost: number, bg: any, fgTotal: any) {
    const ri = row([
      cStr("ИТОГО К ОПЛАТЕ", fmt(bg, C.cream, 11, true, "RIGHT")),
      cEmpty(fmt(bg, C.cream)), cEmpty(fmt(bg, C.cream)), cEmpty(fmt(bg, C.cream)),
      cNum(totalRevenue, fmt(bg, C.muted,  10, false, "RIGHT"), "#,##0 \"฿\""),
      cNum(totalCost,    fmt(bg, C.muted,  10, false, "RIGHT"), "#,##0 \"฿\""),
      cNum(totalCost,    fmt(bg, fgTotal,  13, true,  "RIGHT"), "#,##0 \"฿\""),
    ], 44);
    merge(ri, 0, 4);
  }

  // ── ROW 0: hidden state (JSON) ────────────────────────────────────────────
  const ri0 = row([
    cStr(JSON.stringify(state), fmt(C.white, C.white, 7)),
    ...Array(COLS-1).fill(cEmpty(fmt(C.white, C.white))),
  ], 3);
  merge(ri0, 0, COLS);

  // ── TITLE ─────────────────────────────────────────────────────────────────
  const titleRi = row([
    cStr("РЕАЛИЗАЦИЯ  ·  HARVEST CREATION", fmt(C.black, C.cream, 14, true, "LEFT")),
    ...Array(COLS-1).fill(cEmpty(fmt(C.black, C.cream))),
  ], 40);
  merge(titleRi, 0, COLS);

  const subtitleRi = row([
    cStr(`  Текущий период: ${fmtDate(state.currentStart)} — ${fmtDate(today)}  ·  цены в THB`,
      fmt(C.black, C.muted, 8, false, "LEFT")),
    ...Array(COLS-1).fill(cEmpty(fmt(C.black, C.muted))),
  ], 20);
  merge(subtitleRi, 0, COLS);

  divider(C.red);

  // ── STATUS + CHECKBOX ─────────────────────────────────────────────────────
  const lastPaid = state.closedPeriods.at(-1);
  const lastPaidInfo = lastPaid ? `  Последняя оплата: ${fmtDate(lastPaid.paidDate)}  ·  ${lastPaid.totalCost.toLocaleString()} ฿` : "";
  const statusRi = row([
    cStr("  СТАТУС:", fmt(C.navy, C.stone, 8, false, "LEFT")),
    cStr(`К ОПЛАТЕ  ·  срок ${fmtDate(nextPaymentDate(today))}`, fmt(C.navy, C.gold, 9, true, "LEFT")),
    cEmpty(fmt(C.navy, C.gold)), cEmpty(fmt(C.navy, C.gold)), cEmpty(fmt(C.navy, C.gold)),
    cStr(lastPaidInfo, fmt(C.navy, C.muted, 7, false, "RIGHT")),
    cEmpty(fmt(C.navy, C.muted)),
  ], 28);
  merge(statusRi, 5, COLS);

  // G6 = checkbox (row index 5 = 6th row, col 6 = G)
  const checkboxRi = row([
    cStr("  Оплачено? Поставь ✓ — период закроется в 22:15, новый начнётся завтра",
      fmt(C.cream2, C.graphite, 8, false, "LEFT", true)),
    cEmpty(fmt(C.cream2, C.graphite)), cEmpty(fmt(C.cream2, C.graphite)),
    cEmpty(fmt(C.cream2, C.graphite)), cEmpty(fmt(C.cream2, C.graphite)),
    cEmpty(fmt(C.cream2, C.graphite)),
    { userEnteredValue: { boolValue: false }, userEnteredFormat: fmt(C.cream2, C.graphite, 11, true, "CENTER") },
  ], 28);
  merge(checkboxRi, 0, COLS-1);

  // ── BLANK + COL HEADERS ───────────────────────────────────────────────────
  const blankRi = row(Array(COLS).fill(cEmpty(fmt(C.white, C.white))), 8);
  merge(blankRi, 0, COLS);
  colHeaders(C.cream2);

  // ── CURRENT PERIOD DATA ───────────────────────────────────────────────────
  dataRows(currentRows);
  divider(C.stone);
  const curRevenue = currentRows.reduce((s, r) => s + r.revenue, 0);
  const curCost    = currentRows.reduce((s, r) => s + r.cost,    0);
  totalRow(curRevenue, curCost, C.black, C.gold);

  // ── BANK TRANSFER (previous owner's sales, not our debt) ──────────────────
  if (bankRows.length > 0) {
    const gapRi2 = row(Array(COLS).fill(cEmpty(fmt(C.white, C.white))), 12);
    merge(gapRi2, 0, COLS);

    const bankBg = rgb("#1A1A2E");
    const bankLabelRi = row([
      cStr("  BANK TRANSFER  ·  НЕ НАШИ  —  продажи предыдущего владельца, в итог не включены",
        fmt(bankBg, rgb("#7B8FA1"), 8, true, "LEFT")),
      ...Array(COLS-1).fill(cEmpty(fmt(bankBg, rgb("#7B8FA1")))),
    ], 24);
    merge(bankLabelRi, 0, COLS);

    colHeaders(rgb("#22223A"));
    dataRows(bankRows, true);
    divider(rgb("#2E2E40"));
    const bankRevenue = bankRows.reduce((s, r) => s + r.revenue, 0);
    const bankCost    = bankRows.reduce((s, r) => s + r.cost,    0);
    totalRow(bankRevenue, bankCost, rgb("#1E1E30"), rgb("#7B8FA1"));
  }

  // ── CLOSED PERIODS (history) ──────────────────────────────────────────────
  if (state.closedPeriods.length > 0) {
    // Gap before history
    const gapRi = row(Array(COLS).fill(cEmpty(fmt(C.white, C.white))), 16);
    merge(gapRi, 0, COLS);

    sectionLabel("  ИСТОРИЯ ОПЛАТ", C.archive, C.stone);

    for (const period of [...state.closedPeriods].reverse()) {
      // Period header
      const phRi = row([
        cStr(`  ${fmtDate(period.start)} — ${fmtDate(period.end)}`, fmt(C.archive, C.stone, 9, true, "LEFT")),
        cEmpty(fmt(C.archive, C.stone)), cEmpty(fmt(C.archive, C.stone)),
        cEmpty(fmt(C.archive, C.stone)), cEmpty(fmt(C.archive, C.stone)),
        cStr(`Оплачено ${fmtDate(period.paidDate)}`, fmt(C.archive, C.muted, 8, false, "RIGHT")),
        cNum(period.totalCost, fmt(C.archive, C.gold, 10, true, "RIGHT"), "#,##0 \"฿\""),
      ], 30);
      merge(phRi, 0, 5);

      colHeaders(rgb("#2E2E2E"));
      dataRows(period.rows, true);
      divider(rgb("#333333"));
      totalRow(period.totalRevenue, period.totalCost, rgb("#2A2A2A"), C.stone);
    }
  }

  return { data, merges, heights, checkboxRi };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const today = bangkokToday();
  console.log("📅 Сегодня (Bangkok):", today);

  // 1. Auth + get tab info
  console.log("🔑 Авторизация Google...");
  const meta = await gApi("GET", "");
  let existingTab = (meta.sheets ?? []).find((s: any) => s.properties.title === TAB_NAME);
  let tabId: number;

  if (!existingTab) {
    const res = await gApi("POST", ":batchUpdate", {
      requests: [{ addSheet: { properties: { title: TAB_NAME, gridProperties: { rowCount: 300, columnCount: 7 } } } }],
    });
    tabId = res.replies[0].addSheet.properties.sheetId;
  } else {
    tabId = existingTab.properties.sheetId;
  }

  // 2. Read state from A1
  let state: State = defaultState();
  const stateRaw = await readRange(`${TAB_NAME}!A1`);
  if (stateRaw?.[0]?.[0]) {
    try { state = JSON.parse(stateRaw[0][0]); } catch { /* use default */ }
  }

  // 3. Check payment checkbox (G6 = row 5, col G)
  const checkboxRaw = await readRange(`${TAB_NAME}!G6`);
  const checkboxVal = (checkboxRaw?.[0]?.[0] ?? "").toString().toUpperCase();
  if (checkboxVal === "TRUE" || checkboxVal === "ИСТИНА") {
    console.log("✅ Период отмечен как ОПЛАЧЕНО — архивирую и начинаю новый период");

    // Fetch current period data to archive it
    console.log("   Загружаю данные текущего периода для архива...");
    const harvestSkus = await getHarvestSkus();
    const variantMap  = await buildVariantMap(harvestSkus);
    const { ours: rowsToArchive } = await fetchSalesForPeriod(state.currentStart, today, variantMap);

    state.closedPeriods.push({
      start: state.currentStart,
      end:   today,
      paidDate: today,
      totalRevenue: rowsToArchive.reduce((s, r) => s + r.revenue, 0),
      totalCost:    rowsToArchive.reduce((s, r) => s + r.cost,    0),
      rows: rowsToArchive,
    });
    state.currentStart = tomorrow(today);
    console.log(`   Архивировано. Новый период с: ${fmtDate(state.currentStart)}`);
  }

  // 4. Get Harvest SKUs + variant map
  console.log("📋 Читаю PO Items для Harvest Creation...");
  const harvestSkus = await getHarvestSkus();
  console.log(`   ${harvestSkus.size} уникальных SKU от Harvest`);

  console.log("🍷 Ищу варианты в Loyverse по SKU...");
  const variantMap = await buildVariantMap(harvestSkus);
  console.log(`   Найдено ${variantMap.size} вариантов`);

  // 5. Fetch current period sales
  console.log(`📊 Загружаю продажи ${fmtDate(state.currentStart)} — ${fmtDate(today)}...`);
  const currentSales = await fetchSalesForPeriod(state.currentStart, today, variantMap);
  console.log(`   ${currentSales.ours.length} позиций (наши) + ${currentSales.bankTransfer.length} bank transfer`);
  currentSales.ours.forEach(r => console.log(`   ${r.name} (${r.sku}): ${r.qty} шт. / ${r.revenue.toFixed(0)} ฿`));
  if (currentSales.bankTransfer.length) {
    console.log("   Bank Transfer (не наши):");
    currentSales.bankTransfer.forEach(r => console.log(`     ${r.name} (${r.sku}): ${r.qty} шт. / ${r.revenue.toFixed(0)} ฿`));
  }

  // 6. Build sheet
  console.log("📝 Пишу лист...");
  const totalRows = 50 + currentSales.ours.length + currentSales.bankTransfer.length +
    state.closedPeriods.reduce((s, p) => s + p.rows.length + 6, 0);
  const built = buildSheet(tabId, state, currentSales, today);

  // Resize grid if needed
  const neededRows = Math.max(300, totalRows + 20);
  const requests: any[] = [
    { updateSheetProperties: {
        properties: { sheetId: tabId, gridProperties: { rowCount: neededRows, columnCount: 7 } },
        fields: "gridProperties.rowCount,gridProperties.columnCount",
    }},
    // Clear existing content
    { updateCells: {
        range: { sheetId: tabId },
        fields: "userEnteredValue,userEnteredFormat,dataValidation",
    }},
    // Write all data
    { updateCells: {
        rows: built.data,
        fields: "userEnteredValue,userEnteredFormat",
        start: { sheetId: tabId, rowIndex: 0, columnIndex: 0 },
    }},
    // Column widths
    ...[40, 260, 100, 70, 100, 100, 110].map((px, i) => ({
      updateDimensionProperties: {
        range: { sheetId: tabId, dimension: "COLUMNS", startIndex: i, endIndex: i+1 },
        properties: { pixelSize: px }, fields: "pixelSize",
      },
    })),
    // Row heights
    ...built.heights.map(({ ri, h }) => ({
      updateDimensionProperties: {
        range: { sheetId: tabId, dimension: "ROWS", startIndex: ri, endIndex: ri + 1 },
        properties: { pixelSize: h }, fields: "pixelSize",
      },
    })),
    ...built.merges,
    // Freeze top 8 rows
    { updateSheetProperties: {
        properties: { sheetId: tabId, gridProperties: { frozenRowCount: 8 } },
        fields: "gridProperties.frozenRowCount",
    }},
    // Checkbox data validation on G6
    { setDataValidation: {
        range: { sheetId: tabId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 6, endColumnIndex: 7 },
        rule: { condition: { type: "BOOLEAN" }, strict: true, showCustomUi: true },
    }},
    // Hide state row (row 0)
    { updateDimensionProperties: {
        range: { sheetId: tabId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
        properties: { hiddenByUser: true }, fields: "hiddenByUser",
    }},
  ];

  await gApi("POST", ":batchUpdate", { requests });

  const totalCost = currentSales.ours.reduce((s, r) => s + r.cost, 0);
  console.log("");
  console.log("✅  Готово!");
  console.log(`   Текущий период: ${fmtDate(state.currentStart)} — ${fmtDate(today)}`);
  console.log(`   Позиций: ${currentSales.ours.length} (наши) + ${currentSales.bankTransfer.length} bank transfer`);
  console.log(`   К оплате: ${totalCost.toFixed(0)} ฿`);
  if (state.closedPeriods.length > 0) {
    console.log(`   Архивных периодов: ${state.closedPeriods.length}`);
  }
  console.log(`   https://docs.google.com/spreadsheets/d/${SHEET_ID}`);
}

// ─── Helpers for SKU/variant lookup ───────────────────────────────────────────

async function getHarvestSkus(): Promise<Set<string>> {
  const poData = await readRange(`${PO_ITEMS_TAB}!A2:J2000`);
  const skus = new Set<string>();
  for (const row of poData) {
    if (row[4] === HARVEST_SUPPLIER && row[7]) skus.add(row[7].trim());
  }
  return skus;
}

async function buildVariantMap(harvestSkus: Set<string>): Promise<Map<string, { name: string; sku: string }>> {
  const allItems = await loyFetch<LoyItem>("/items?limit=250", "items");
  const map = new Map<string, { name: string; sku: string }>();
  for (const item of allItems) {
    for (const v of item.variants ?? []) {
      const sku = (v.sku ?? "").trim();
      if (harvestSkus.has(sku)) map.set(v.variant_id, { name: item.item_name, sku });
    }
  }
  return map;
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
