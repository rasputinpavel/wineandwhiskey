/**
 * monthly_b2c_margin.ts
 *
 * Месячный разрез B2C-only маржи по категориям. Отделяет B2C от B2B по
 * двум критериям (любой совпавший = B2B, остальное = B2C):
 *   1. payment_type_id == BANK_TRANSFER_TYPE_ID — оплата банковским переводом
 *   2. customer_id привязан к имени из B2B_PATTERNS — известный B2B клиент
 *
 * Пишет в лист "B2C по месяцам":
 *   - матрица: строки = категории, колонки = месяцы, значения = маржа B2C / мес
 *   - YoY сравнение для пересекающихся месяцев (Feb-May 2025 vs 2026)
 *   - сравнение с FOC и целевой прибылью
 *
 * Usage: npx tsx 03_automation/monthly_b2c_margin.ts
 */

import dotenv from "dotenv";
import { BANK_TRANSFER_TYPE_ID, isB2BCustomerName } from "./lib/b2b.js";
import { loyverseFetch } from "./lib/loyverse.js";
dotenv.config({ path: ".env.local" });

const SHEET_ID = "10EfJl0cfWj1GLoFXq9nHfZ4ZrlLcQloXs4ANRbt8HBg";
const TAB      = "B2C по месяцам";
const PERIOD_MONTHS = 18;
const FOC = 100_000;
const TARGET_LOW  = 120_000;
const TARGET_HIGH = 160_000;

const LOYVERSE_TOKEN       = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

// ─── Sheets boilerplate ───────────────────────────────────────────────────

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

// ─── Loyverse ─────────────────────────────────────────────────────────────


async function fetchCustomerNames(ids: Set<string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all([...ids].map(async id => {
    try {
      const r = await fetch(`https://api.loyverse.com/v1.0/customers/${id}`, {
        headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` },
      });
      if (!r.ok) return;
      const c = await r.json();
      const name = (c.name ?? "").trim() || c.email || id.slice(0, 8);
      map.set(id, name);
    } catch { /* skip */ }
  }));
  return map;
}

// ─── Group classification (same as category_margin_diagnostic) ────────────

type Group =
  | "Красное вино"
  | "Белое вино"
  | "Игристое"
  | "Пиво"
  | "Крепкий алкоголь"
  | "Закуски (Food)"
  | "Аксессуары"
  | "Прочее (региональные / приватные)"
  | "Архив / прочее";

function classifyCat(name: string): Group | null {
  const n = name.toLowerCase();
  if (/red\s*wine|красн/.test(n)) return "Красное вино";
  if (/white\s*wine|бел/.test(n)) return "Белое вино";
  if (/sparkling/.test(n)) return "Игристое";
  if (/^beer$|пиво/.test(n)) return "Пиво";
  if (/whiskey|whisky|vodka|^gin$|^rum$|tequila|cognac|armagnac|calvados|sidr|cidre|grappa|liquor|liqueur|sherry|fortified|sake|джин|водка|ром|текила|коньяк/.test(n)) return "Крепкий алкоголь";
  if (/^food$/.test(n)) return "Закуски (Food)";
  if (/accessor|cigar/.test(n)) return "Аксессуары";
  if (/archive/.test(n)) return "Архив / прочее";
  if (/russia|granmonte|lazada|coke|gallothai|consigment|consignment|wholesale|p[ée]t[\s\-]?nat|natural|orange|rose/.test(n)) return "Прочее (региональные / приватные)";
  return null;
}

const GROUP_ORDER: Group[] = [
  "Красное вино", "Белое вино", "Игристое",
  "Пиво", "Крепкий алкоголь", "Закуски (Food)",
  "Аксессуары", "Прочее (региональные / приватные)", "Архив / прочее",
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function bangkokDate(d: Date): Date {
  return new Date(d.getTime() + 7 * 3_600_000);
}

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

const RU_MONTH = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
function ymLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${RU_MONTH[m - 1]} '${String(y).slice(2)}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nMonthly B2C margin diagnostic\n");

  const months = lastNMonths(PERIOD_MONTHS);
  console.log(`Months: ${months[0]} → ${months[months.length - 1]}`);

  const todayBkk = bangkokDate(new Date());
  const fromMonth = months[0];
  const fromIso = `${fromMonth}-01`;
  const toIso   = todayBkk.toISOString().slice(0, 10);
  console.log(`Period: ${fromIso} → ${toIso}\n`);

  console.log("[1/4] Fetching Loyverse data...");
  const [categories, items] = await Promise.all([
    loyverseFetch<any>("/categories", "categories"),
    loyverseFetch<any>("/items", "items"),
  ]);
  const catGroup = new Map<string, Group>();
  for (const c of categories) {
    const g = classifyCat(c.name);
    if (g) catGroup.set(c.id, g);
  }
  const itemCat = new Map<string, string>();
  for (const it of items) if (it.category_id) itemCat.set(it.id, it.category_id);

  console.log("[2/4] Fetching receipts...");
  const minUtc = new Date(`${fromIso}T00:00:00+07:00`).toISOString();
  const maxUtc = new Date(`${toIso}T23:59:59+07:00`).toISOString();
  const receipts: any[] = await loyverseFetch(
    `/receipts?receipt_type=SALE&created_at_min=${minUtc}&created_at_max=${maxUtc}`,
    "receipts",
  );
  console.log(`  ${receipts.length} receipts.`);

  console.log("[3/4] Resolving customer names...");
  const customerIds = new Set<string>();
  for (const r of receipts) if (r.customer_id) customerIds.add(r.customer_id);
  const customerNames = await fetchCustomerNames(customerIds);
  console.log(`  ${customerNames.size}/${customerIds.size} resolved.`);

  console.log("[4/4] Aggregating B2C-only by month × group...");
  // key = ym|group → { revenue, cost }
  const acc   = new Map<string, { revenue: number; cost: number }>();
  // also track B2B totals to display for context
  const accB2B = new Map<string, { revenue: number; cost: number }>();
  function addTo(map: Map<string, { revenue: number; cost: number }>, key: string, rev: number, cost: number) {
    const cur = map.get(key) ?? { revenue: 0, cost: 0 };
    cur.revenue += rev;
    cur.cost    += cost;
    map.set(key, cur);
  }

  let totalReceipts = 0, b2bReceipts = 0;
  for (const r of receipts) {
    if (r.cancelled_at) continue;                       // voided — never a sale
    const sign = r.receipt_type === "REFUND" ? -1 : 1;  // refunds reduce net sales
    if (sign > 0) totalReceipts++;
    const created = new Date(r.created_at);
    const bkk = bangkokDate(created);
    const ym  = ymKey(bkk);

    // B2B detection: bank-transfer payment OR known B2B customer name.
    const hasBankTransfer = (r.payments ?? []).some((p: any) => p.payment_type_id === BANK_TRANSFER_TYPE_ID);
    const customerName = r.customer_id ? (customerNames.get(r.customer_id) ?? "") : "";
    const isB2B = hasBankTransfer || (customerName && isB2BCustomerName(customerName));
    if (isB2B && sign > 0) b2bReceipts++;

    for (const li of r.line_items ?? []) {
      const id = li.item_id; if (!id) continue;
      const catId = itemCat.get(id); if (!catId) continue;
      const group = catGroup.get(catId); if (!group) continue;
      const rev = (li.total_money ?? 0) * sign;
      const cost = (li.cost_total  ?? 0) * sign;
      const key = `${ym}|${group}`;
      if (isB2B) addTo(accB2B, key, rev, cost);
      else       addTo(acc,    key, rev, cost);
    }
  }
  console.log(`  ${b2bReceipts}/${totalReceipts} receipts B2B (${Math.round(b2bReceipts / totalReceipts * 100)}%).`);

  // Build group × month margin matrix
  function getMargin(map: Map<string, { revenue: number; cost: number }>, ym: string, g: Group): number {
    const v = map.get(`${ym}|${g}`);
    return v ? v.revenue - v.cost : 0;
  }
  function getRevenue(map: Map<string, { revenue: number; cost: number }>, ym: string, g: Group): number {
    return map.get(`${ym}|${g}`)?.revenue ?? 0;
  }

  // ─── Build sheet ──────────────────────────────────────────────────────
  const sheetId = await ensureTab(TAB);
  await clearTab(sheetId);

  const visibleGroups = GROUP_ORDER.filter(g =>
    months.some(m => (acc.get(`${m}|${g}`) || accB2B.get(`${m}|${g}`)))
  );

  const rows: any[][] = [];

  // Title
  rows.push([`B2C маржа по категориям × месяцам · ${months[0]} → ${months[months.length - 1]} · ${b2bReceipts}/${totalReceipts} чеков B2B (${Math.round(b2bReceipts / totalReceipts * 100)}%)`]);

  // ─── Block 1: Margin matrix (B2C only) ────────────────────────────────
  rows.push([]);
  rows.push(["МАРЖА B2C / МЕСЯЦ ПО КАТЕГОРИЯМ"]);
  const m1HdrRow = rows.length - 1;
  rows.push(["Категория", ...months.map(ymLabel), "Среднее"]);
  const matrixHdrRow = rows.length - 1;
  const matrixStart = rows.length;
  for (const g of visibleGroups) {
    const vals = months.map(m => Math.round(getMargin(acc, m, g)));
    const avg = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    rows.push([g, ...vals, avg]);
  }
  // Total row
  const totalMonth = months.map(m => Math.round(visibleGroups.reduce((s, g) => s + getMargin(acc, m, g), 0)));
  const totalAvg = Math.round(totalMonth.reduce((s, v) => s + v, 0) / totalMonth.length);
  rows.push(["B2C ИТОГО маржа", ...totalMonth, totalAvg]);
  // FOC reference row
  rows.push(["FOC", ...months.map(_ => FOC), FOC]);
  // Net (after FOC) — это и есть личный доход
  const netMonth = totalMonth.map(v => v - FOC);
  const netAvg = Math.round(netMonth.reduce((s, v) => s + v, 0) / netMonth.length);
  rows.push(["Остаток после FOC", ...netMonth, netAvg]);
  const matrixEnd = rows.length;

  // ─── Block 2: Revenue B2C vs B2B by month ─────────────────────────────
  rows.push([]);
  rows.push(["B2B vs B2C — выручка по месяцам"]);
  const m2HdrRow = rows.length - 1;
  rows.push(["", ...months.map(ymLabel), "Среднее"]);
  const channelHdrRow = rows.length - 1;
  const channelStart = rows.length;
  const revB2C = months.map(m => Math.round(visibleGroups.reduce((s, g) => s + getRevenue(acc, m, g), 0)));
  const revB2B = months.map(m => Math.round(visibleGroups.reduce((s, g) => s + getRevenue(accB2B, m, g), 0)));
  const totalRevByMonth = revB2C.map((v, i) => v + revB2B[i]);
  const b2bShare = revB2B.map((v, i) => totalRevByMonth[i] > 0 ? Math.round(v / totalRevByMonth[i] * 1000) / 10 : 0);
  rows.push(["B2C выручка", ...revB2C, Math.round(revB2C.reduce((s, v) => s + v, 0) / revB2C.length)]);
  rows.push(["B2B выручка", ...revB2B, Math.round(revB2B.reduce((s, v) => s + v, 0) / revB2B.length)]);
  rows.push(["B2B доля, %", ...b2bShare, Math.round(b2bShare.reduce((s, v) => s + v, 0) / b2bShare.length * 10) / 10]);
  const channelEnd = rows.length;

  // ─── YoY: build pairs (only fully-complete months) ────────────────────
  // Drop the current month (incomplete) and any 2026 month that hasn't fully passed yet.
  const currentYM = ymKey(todayBkk);
  const overlappingPairs: Array<[string, string]> = [];
  for (const m of months) {
    const [y, mm] = m.split("-");
    if (y === "2025") {
      const m26 = `2026-${mm}`;
      if (months.includes(m26) && m26 !== currentYM) overlappingPairs.push([m, m26]);
    }
  }

  // ─── Block 3 (NEW): YoY summary by category, sorted by decline ────────
  let summaryHdrRow = 0, summaryDataStart = 0, summaryDataEnd = 0;
  let detailHdrRow = 0, detailColHdrRow = 0, detailDataStart = 0, detailDataEnd = 0;
  if (overlappingPairs.length > 0) {
    rows.push([]);
    rows.push([`YoY СВОДКА — B2C-маржа по перекрытию (${overlappingPairs.length} мес. полных): ${overlappingPairs.map(([a, b]) => `${ymLabel(a)} vs ${ymLabel(b)}`).join(", ")}`]);
    summaryHdrRow = rows.length - 1;
    rows.push(["Категория", "Маржа 2025 (сумма)", "Маржа 2026 (сумма)", "Δ %", "Δ ฿"]);
    const summaryColHdrRow = rows.length - 1;
    summaryDataStart = rows.length;
    interface YoyRow { g: Group | "ИТОГО"; v25: number; v26: number; deltaPct: number; deltaAbs: number; }
    const yoySummary: YoyRow[] = [];
    for (const g of visibleGroups) {
      const v25 = overlappingPairs.reduce((s, [a]) => s + getMargin(acc, a, g), 0);
      const v26 = overlappingPairs.reduce((s, [, b]) => s + getMargin(acc, b, g), 0);
      const deltaPct = v25 !== 0 ? ((v26 - v25) / v25) * 100 : 0;
      yoySummary.push({ g, v25, v26, deltaPct, deltaAbs: v26 - v25 });
    }
    // Sort: worst decline first (lowest delta_pct)
    yoySummary.sort((a, b) => a.deltaPct - b.deltaPct);
    for (const y of yoySummary) {
      rows.push([y.g, Math.round(y.v25), Math.round(y.v26), Math.round(y.deltaPct * 10) / 10, Math.round(y.deltaAbs)]);
    }
    // ИТОГО
    const t25 = visibleGroups.reduce((s, g) => s + overlappingPairs.reduce((x, [a]) => x + getMargin(acc, a, g), 0), 0);
    const t26 = visibleGroups.reduce((s, g) => s + overlappingPairs.reduce((x, [, b]) => x + getMargin(acc, b, g), 0), 0);
    const tDelta = t25 !== 0 ? ((t26 - t25) / t25) * 100 : 0;
    rows.push(["B2C ИТОГО", Math.round(t25), Math.round(t26), Math.round(tDelta * 10) / 10, Math.round(t26 - t25)]);
    summaryDataEnd = rows.length;

    // ─── Block 4: detailed per-month YoY ──────────────────────────────────
    rows.push([]);
    rows.push(["YoY ДЕТАЛЬНО — помесячно"]);
    detailHdrRow = rows.length - 1;
    rows.push(["Категория", ...overlappingPairs.flatMap(([a, b]) => [ymLabel(a), ymLabel(b), "Δ %"])]);
    detailColHdrRow = rows.length - 1;
    detailDataStart = rows.length;
    // Use same sort order as summary (worst first)
    for (const { g } of yoySummary) {
      const cells: any[] = [g];
      for (const [a, b] of overlappingPairs) {
        const va = Math.round(getMargin(acc, a, g as Group));
        const vb = Math.round(getMargin(acc, b, g as Group));
        const delta = va > 0 ? Math.round((vb - va) / va * 1000) / 10 : 0;
        cells.push(va, vb, delta);
      }
      rows.push(cells);
    }
    const totalCells: any[] = ["B2C ИТОГО"];
    for (const [a, b] of overlappingPairs) {
      const va = visibleGroups.reduce((s, g) => s + getMargin(acc, a, g), 0);
      const vb = visibleGroups.reduce((s, g) => s + getMargin(acc, b, g), 0);
      const delta = va > 0 ? Math.round((vb - va) / va * 1000) / 10 : 0;
      totalCells.push(Math.round(va), Math.round(vb), delta);
    }
    rows.push(totalCells);
    detailDataEnd = rows.length;

    // ─── Comments below YoY ─────────────────────────────────────────────
    rows.push([]);
    rows.push(["Заметки:"]);
    rows.push([`  · YoY-блоки сравнивают только ПОЛНОСТЬЮ ЗАВЕРШЁННЫЕ месяцы (текущий ${ymLabel(currentYM)} исключён, в нём данные неполные).`]);
    rows.push(["  · «Маржа» = выручка − закуп (gross profit), только B2C-чеки. B2B = чек с типом оплаты «банковский перевод» ИЛИ известный B2B-клиент."]);
    rows.push(["  · «Остаток после FOC» — то, что остаётся на личный доход после оплаты ЗП/аренды/налогов. В минус — значит магазин не покрывает свои расходы только B2C-маржой и зависит от B2B."]);
    rows.push(["  · Сезонность: высокий сезон Nov-Mar, низкий Apr-Oct. Цели: 60K (низкий) ÷ 80K (высокий) над FOC."]);
    rows.push(["  · Сводка отсортирована от худшего падения к лучшему — крайне правые в таблице категории растут или падают меньше остальных."]);

    // store for formatting
    (globalThis as any).__yoyMeta = { summaryHdrRow, summaryColHdrRow, summaryDataStart, summaryDataEnd, detailHdrRow, detailColHdrRow, detailDataStart, detailDataEnd };
  }

  // ─── Write ─────────────────────────────────────────────────────────────
  await writeRows(sheetId, 0, 0, rows);

  // ─── Formatting ────────────────────────────────────────────────────────
  const FMT_INT  = { type: "NUMBER",   pattern: "#,##0" };
  const FMT_BAHT = { type: "CURRENCY", pattern: "#,##0\\ \"฿\"" };
  const FMT_PCT  = { type: "NUMBER",   pattern: "0.0\"%\";\\-0.0\"%\"" };
  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  const nMonthCols = months.length;
  const totalCols = 2 + nMonthCols;  // category + months + average

  const fmt: any[] = [];
  fmt.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });

  // Column widths
  fmt.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 240 }, fields: "pixelSize" } });
  for (let i = 1; i < totalCols; i++) {
    fmt.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: 90 }, fields: "pixelSize" } });
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

  // Block 1 header (margin matrix)
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: m1HdrRow, endRowIndex: m1HdrRow + 1, startColumnIndex: 0, endColumnIndex: totalCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.40, blue: 0.20 }, textFormat: { bold: true, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: m1HdrRow, endRowIndex: m1HdrRow + 1, startColumnIndex: 0, endColumnIndex: totalCols }, mergeType: "MERGE_ALL" } });

  // Matrix column headers
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: matrixHdrRow, endRowIndex: matrixHdrRow + 1, startColumnIndex: 0, endColumnIndex: totalCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });

  // Matrix data: numbers as ฿
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: matrixStart, endRowIndex: matrixEnd, startColumnIndex: 1, endColumnIndex: totalCols },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // Total row (B2C ИТОГО)
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: matrixEnd - 3, endRowIndex: matrixEnd - 2, startColumnIndex: 0, endColumnIndex: totalCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  // FOC row — gray
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: matrixEnd - 2, endRowIndex: matrixEnd - 1, startColumnIndex: 0, endColumnIndex: totalCols },
      cell: { userEnteredFormat: { textFormat: { italic: true, foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } } } },
      fields: "userEnteredFormat.textFormat",
    },
  });
  // Net row — colour by sign (conditional via per-cell)
  for (let r = matrixEnd - 1; r < matrixEnd; r++) {
    fmt.push({
      repeatCell: {
        range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat",
      },
    });
    for (let c = 1; c < totalCols; c++) {
      const v = netMonth[c - 1] ?? netAvg;
      const bg = v < 0 ? { red: 1.0, green: 0.85, blue: 0.85 } :
                 v < (TARGET_LOW - FOC) ? { red: 1.0, green: 0.95, blue: 0.80 } :
                                          { red: 0.85, green: 0.95, blue: 0.85 };
      fmt.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: c, endColumnIndex: c + 1 },
          cell: { userEnteredFormat: { backgroundColor: bg, textFormat: { bold: true } } },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      });
    }
  }

  // Block 2 header (B2B vs B2C revenue)
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: m2HdrRow, endRowIndex: m2HdrRow + 1, startColumnIndex: 0, endColumnIndex: totalCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.45, green: 0.36, blue: 0.08 }, textFormat: { bold: true, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: m2HdrRow, endRowIndex: m2HdrRow + 1, startColumnIndex: 0, endColumnIndex: totalCols }, mergeType: "MERGE_ALL" } });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: channelHdrRow, endRowIndex: channelHdrRow + 1, startColumnIndex: 0, endColumnIndex: totalCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // Channel data — first two rows ฿, third row %
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: channelStart, endRowIndex: channelEnd - 1, startColumnIndex: 1, endColumnIndex: totalCols },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: channelEnd - 1, endRowIndex: channelEnd, startColumnIndex: 1, endColumnIndex: totalCols },
      cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT", textFormat: { bold: true } } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment,textFormat)",
    },
  });

  // Block 3 (summary) + Block 4 (detail per-month)
  const yoyMeta = (globalThis as any).__yoyMeta;
  if (yoyMeta && overlappingPairs.length > 0) {
    // ── Block 3: SUMMARY ──
    const summaryCols = 5;
    fmt.push({
      repeatCell: {
        range: { sheetId, startRowIndex: yoyMeta.summaryHdrRow, endRowIndex: yoyMeta.summaryHdrRow + 1, startColumnIndex: 0, endColumnIndex: totalCols },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.55, green: 0.13, blue: 0.13 }, textFormat: { bold: true, foregroundColor: white } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
    fmt.push({ mergeCells: { range: { sheetId, startRowIndex: yoyMeta.summaryHdrRow, endRowIndex: yoyMeta.summaryHdrRow + 1, startColumnIndex: 0, endColumnIndex: totalCols }, mergeType: "MERGE_ALL" } });
    fmt.push({
      repeatCell: {
        range: { sheetId, startRowIndex: yoyMeta.summaryColHdrRow, endRowIndex: yoyMeta.summaryColHdrRow + 1, startColumnIndex: 0, endColumnIndex: summaryCols },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    });
    // Summary number formats: cols 1-2 = ฿, col 3 = %, col 4 = ฿
    fmt.push({
      repeatCell: {
        range: { sheetId, startRowIndex: yoyMeta.summaryDataStart, endRowIndex: yoyMeta.summaryDataEnd, startColumnIndex: 1, endColumnIndex: 3 },
        cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    });
    fmt.push({
      repeatCell: {
        range: { sheetId, startRowIndex: yoyMeta.summaryDataStart, endRowIndex: yoyMeta.summaryDataEnd, startColumnIndex: 3, endColumnIndex: 4 },
        cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT", textFormat: { bold: true } } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment,textFormat)",
      },
    });
    fmt.push({
      repeatCell: {
        range: { sheetId, startRowIndex: yoyMeta.summaryDataStart, endRowIndex: yoyMeta.summaryDataEnd, startColumnIndex: 4, endColumnIndex: 5 },
        cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    });
    // Summary ИТОГО row
    fmt.push({
      repeatCell: {
        range: { sheetId, startRowIndex: yoyMeta.summaryDataEnd - 1, endRowIndex: yoyMeta.summaryDataEnd, startColumnIndex: 0, endColumnIndex: summaryCols },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
    // Per-row colour delta col (col 3) and abs delta col (col 4) for visual signal
    for (let r = yoyMeta.summaryDataStart; r < yoyMeta.summaryDataEnd; r++) {
      const row = rows[r];
      if (!row) continue;
      const delta = row[3];
      if (typeof delta !== "number") continue;
      const bg = delta < -10 ? { red: 1.0, green: 0.78, blue: 0.78 } :
                 delta <   0 ? { red: 1.0, green: 0.90, blue: 0.78 } :
                 delta <   5 ? { red: 1.0, green: 0.97, blue: 0.85 } :
                               { red: 0.80, green: 0.95, blue: 0.80 };
      fmt.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 3, endColumnIndex: 5 },
          cell: { userEnteredFormat: { backgroundColor: bg } },
          fields: "userEnteredFormat.backgroundColor",
        },
      });
    }

    // ── Block 4: DETAIL ──
    const detailTotalCols = 1 + overlappingPairs.length * 3;
    fmt.push({
      repeatCell: {
        range: { sheetId, startRowIndex: yoyMeta.detailHdrRow, endRowIndex: yoyMeta.detailHdrRow + 1, startColumnIndex: 0, endColumnIndex: totalCols },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.45, green: 0.10, blue: 0.10 }, textFormat: { bold: true, foregroundColor: white } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
    fmt.push({ mergeCells: { range: { sheetId, startRowIndex: yoyMeta.detailHdrRow, endRowIndex: yoyMeta.detailHdrRow + 1, startColumnIndex: 0, endColumnIndex: totalCols }, mergeType: "MERGE_ALL" } });
    fmt.push({
      repeatCell: {
        range: { sheetId, startRowIndex: yoyMeta.detailColHdrRow, endRowIndex: yoyMeta.detailColHdrRow + 1, startColumnIndex: 0, endColumnIndex: detailTotalCols },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    });
    for (let i = 0; i < overlappingPairs.length; i++) {
      const baseCol = 1 + i * 3;
      fmt.push({
        repeatCell: {
          range: { sheetId, startRowIndex: yoyMeta.detailDataStart, endRowIndex: yoyMeta.detailDataEnd, startColumnIndex: baseCol, endColumnIndex: baseCol + 2 },
          cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
      fmt.push({
        repeatCell: {
          range: { sheetId, startRowIndex: yoyMeta.detailDataStart, endRowIndex: yoyMeta.detailDataEnd, startColumnIndex: baseCol + 2, endColumnIndex: baseCol + 3 },
          cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT", textFormat: { bold: true } } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment,textFormat)",
        },
      });
    }
    fmt.push({
      repeatCell: {
        range: { sheetId, startRowIndex: yoyMeta.detailDataEnd - 1, endRowIndex: yoyMeta.detailDataEnd, startColumnIndex: 0, endColumnIndex: detailTotalCols },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
    for (let r = yoyMeta.detailDataStart; r < yoyMeta.detailDataEnd; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let i = 0; i < overlappingPairs.length; i++) {
        const baseCol = 1 + i * 3;
        const delta = row[baseCol + 2];
        if (typeof delta !== "number") continue;
        const bg = delta < -10 ? { red: 1.0, green: 0.78, blue: 0.78 } :
                   delta <   0 ? { red: 1.0, green: 0.90, blue: 0.78 } :
                   delta <   5 ? { red: 1.0, green: 0.97, blue: 0.85 } :
                                 { red: 0.80, green: 0.95, blue: 0.80 };
        fmt.push({
          repeatCell: {
            range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: baseCol + 2, endColumnIndex: baseCol + 3 },
            cell: { userEnteredFormat: { backgroundColor: bg } },
            fields: "userEnteredFormat.backgroundColor",
          },
        });
      }
    }
  }

  await sheets("POST", ":batchUpdate", { requests: fmt });
  console.log(`\n✓ "${TAB}" written.`);
  console.log(`→ https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);

  // Console summary
  console.log("Сводка B2C-маржи по месяцам:");
  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    const total = totalMonth[i];
    const net = netMonth[i];
    const flag = net < 0 ? "✗" : net < (TARGET_LOW - FOC) ? "⚠" : "✓";
    console.log(`  ${ymLabel(m)}: ${total.toLocaleString("ru-RU")} ฿ маржи, после FOC ${net.toLocaleString("ru-RU")} ฿ ${flag}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
