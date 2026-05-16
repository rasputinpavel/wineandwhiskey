/**
 * b2b_reserve.ts
 *
 * Считает B2B-резерв — сколько бутылок каких SKU нужно держать на складе
 * сверх B2C-матрицы, чтобы покрыть постоянных B2B-клиентов.
 *
 * Логика:
 *   - Берём окно последних 6 месяцев (или PERIOD_MONTHS).
 *   - Для каждого B2B-клиента считаем: сколько чеков, активных месяцев, средний чек.
 *   - "Постоянным" считаем клиента с ≥ MIN_ACTIVE_MONTHS активных месяцев из периода.
 *   - Для каждого постоянного клиента — топ SKU по бутылкам, со средним расходом/мес.
 *   - Recommended reserve = round_up(avg_per_month_per_SKU × COVER_WEEKS / 4.345).
 *
 * Anonymous bank-transfer receipts (без customer_id) — отдельный блок,
 * пока не идентифицированы.
 *
 * Usage: npx tsx 03_automation/b2b_reserve.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { classifyReceipt } from "./lib/b2b.js";
import { loadB2BOverrides, canonicalize } from "./lib/b2b_overrides.js";

const SHEET_ID = "10EfJl0cfWj1GLoFXq9nHfZ4ZrlLcQloXs4ANRbt8HBg";
const TAB      = "B2B-резерв";
const PERIOD_MONTHS    = 6;     // window for "regular customer" heuristic
const MIN_ACTIVE_MONTHS = 3;    // ≥3 months out of 6 → considered regular
const COVER_WEEKS      = 4;     // how many weeks of B2B demand to keep on shelf as reserve
const MIN_UNITS_PER_MONTH = 0.5; // SKU must move ≥0.5 bottles/mo to be in reserve

const LOYVERSE_TOKEN       = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

// ─── Sheets ───────────────────────────────────────────────────────────────

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

async function loy<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const url = `https://api.loyverse.com/v1.0${path}${path.includes("?") ? "&" : "?"}limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` } });
    if (!r.ok) throw new Error(`${r.status}`);
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

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nB2B reserve calculator\n");

  const todayBkk = bangkokDate(new Date());
  const toIso = todayBkk.toISOString().slice(0, 10);
  const fromIso = new Date(todayBkk.getTime() - PERIOD_MONTHS * 30 * 86_400_000).toISOString().slice(0, 10);
  console.log(`Window: ${fromIso} → ${toIso} (${PERIOD_MONTHS} months)`);
  console.log(`Regular = ≥${MIN_ACTIVE_MONTHS} active months in period`);
  console.log(`Cover = ${COVER_WEEKS} weeks of B2B demand kept on shelf\n`);

  console.log("[1/3] Fetching items + receipts...");
  const items: any[] = await loy("/items", "items");
  const itemName = new Map<string, string>();
  for (const it of items) itemName.set(it.id, it.item_name ?? it.name ?? "—");

  const minUtc = new Date(`${fromIso}T00:00:00+07:00`).toISOString();
  const maxUtc = new Date(`${toIso}T23:59:59+07:00`).toISOString();
  const receipts: any[] = await loy(`/receipts?receipt_type=SALE&created_at_min=${minUtc}&created_at_max=${maxUtc}`, "receipts");
  console.log(`  ${receipts.length} receipts.`);

  const custIds = new Set<string>();
  for (const r of receipts) if (r.customer_id) custIds.add(r.customer_id);
  const custNames = await fetchCustomerNames(custIds);

  const overrides = await loadB2BOverrides();
  console.log(`  ${overrides.size} manual B2B-tag overrides loaded.`);

  console.log("[2/3] Classifying B2B and aggregating per customer × SKU...");
  // Per-customer: month set + per-SKU bottle count
  interface CustData {
    monthsActive: Set<string>;
    chequeCount: number;
    totalRev: number;
    totalCost: number;
    skuQty: Map<string, number>;     // item_id → bottles over period
  }
  const byCustomer = new Map<string, CustData>();
  let anonChecks = 0, anonRev = 0;

  for (const r of receipts) {
    let customerName = r.customer_id ? (custNames.get(r.customer_id) ?? "") : "";
    if (!customerName) {
      const override = overrides.get(String(r.receipt_number ?? ""));
      if (override) customerName = override;
    } else {
      customerName = canonicalize(customerName);
    }
    const cls = classifyReceipt({ payments: r.payments, customerName });
    if (!cls.isB2B) continue;

    const dt = bangkokDate(new Date(r.created_at));
    const ym = ymKey(dt);
    let rev = 0, cost = 0;
    for (const li of r.line_items ?? []) { rev += Number(li.total_money ?? 0); cost += Number(li.cost_total ?? 0); }

    if (!customerName) {
      // anonymous bank-transfer
      anonChecks++; anonRev += rev;
      continue;
    }

    let cd = byCustomer.get(customerName);
    if (!cd) {
      cd = { monthsActive: new Set(), chequeCount: 0, totalRev: 0, totalCost: 0, skuQty: new Map() };
      byCustomer.set(customerName, cd);
    }
    cd.monthsActive.add(ym);
    cd.chequeCount++;
    cd.totalRev += rev;
    cd.totalCost += cost;
    for (const li of r.line_items ?? []) {
      if (!li.item_id) continue;
      cd.skuQty.set(li.item_id, (cd.skuQty.get(li.item_id) ?? 0) + Number(li.quantity ?? 0));
    }
  }

  // Pick regular customers
  const regulars = [...byCustomer.entries()]
    .filter(([_, d]) => d.monthsActive.size >= MIN_ACTIVE_MONTHS)
    .sort((a, b) => b[1].totalRev - a[1].totalRev);
  console.log(`  Regular customers: ${regulars.length} (out of ${byCustomer.size} B2B clients)`);
  console.log(`  Anonymous bank-transfer: ${anonChecks} checks, ${Math.round(anonRev).toLocaleString("ru-RU")} ฿`);

  console.log("[3/3] Building reserve recommendations...");

  // Aggregate SKU-level reserve across all regular customers
  // (one customer might want 3 Czar's Vodka/mo, another 2 — total reserve = 5/mo).
  interface SkuReserve {
    itemId: string;
    skuName: string;
    bottlesPerMonth: number;     // total across all regular B2B customers
    coverBottles: number;        // = ceil(bottlesPerMonth * COVER_WEEKS / 4.345)
    bottlesByCustomer: Map<string, number>;  // who needs how much
  }
  const skuReserve = new Map<string, SkuReserve>();

  for (const [custName, d] of regulars) {
    for (const [itemId, totalQty] of d.skuQty) {
      const perMonth = totalQty / PERIOD_MONTHS;
      if (perMonth < MIN_UNITS_PER_MONTH) continue;
      let r = skuReserve.get(itemId);
      if (!r) {
        r = {
          itemId,
          skuName: itemName.get(itemId) ?? itemId.slice(0, 8),
          bottlesPerMonth: 0,
          coverBottles: 0,
          bottlesByCustomer: new Map(),
        };
        skuReserve.set(itemId, r);
      }
      r.bottlesPerMonth += perMonth;
      r.bottlesByCustomer.set(custName, perMonth);
    }
  }
  for (const r of skuReserve.values()) {
    r.coverBottles = Math.ceil(r.bottlesPerMonth * COVER_WEEKS / 4.345);
  }
  const reserveSorted = [...skuReserve.values()].sort((a, b) => b.bottlesPerMonth - a.bottlesPerMonth);
  const reserveTotalBottles = reserveSorted.reduce((s, r) => s + r.coverBottles, 0);
  console.log(`  Reserve: ${reserveSorted.length} SKU, ${reserveTotalBottles} bottles total\n`);

  // ─── Build sheet ──────────────────────────────────────────────────────
  const sheetId = await ensureTab(TAB);
  await clearTab(sheetId);
  const rows: any[][] = [];

  rows.push([`B2B-резерв · ${fromIso} → ${toIso} · регулярные клиенты ≥${MIN_ACTIVE_MONTHS} активных мес из ${PERIOD_MONTHS} · покрытие ${COVER_WEEKS} нед`]);
  rows.push([]);

  // ─── Block 1: Regular customers summary
  rows.push(["РЕГУЛЯРНЫЕ B2B КЛИЕНТЫ"]);
  const c1HdrRow = rows.length - 1;
  rows.push(["Клиент", "Активных мес", "Чеков", "Выручка ฿", "Маржа ฿", "Ср. чек ฿"]);
  const c1ColRow = rows.length - 1;
  const c1Start = rows.length;
  for (const [name, d] of regulars) {
    rows.push([
      name,
      d.monthsActive.size,
      d.chequeCount,
      Math.round(d.totalRev),
      Math.round(d.totalRev - d.totalCost),
      Math.round(d.totalRev / d.chequeCount),
    ]);
  }
  // Total row
  const sumRev = regulars.reduce((s, [, d]) => s + d.totalRev, 0);
  const sumCost = regulars.reduce((s, [, d]) => s + d.totalCost, 0);
  const sumChecks = regulars.reduce((s, [, d]) => s + d.chequeCount, 0);
  rows.push(["ИТОГО", "", sumChecks, Math.round(sumRev), Math.round(sumRev - sumCost), sumChecks > 0 ? Math.round(sumRev / sumChecks) : 0]);
  const c1End = rows.length;

  // Anonymous note
  rows.push([]);
  rows.push([`Аноним. bank-transfer (без customer_id): ${anonChecks} чеков, ${Math.round(anonRev).toLocaleString("ru-RU")} ฿ выручки. Идентифицируй на листе «B2B без customer» и заводи в Loyverse customers.`]);

  // ─── Block 2: SKU reserve
  rows.push([]);
  rows.push(["B2B-РЕЗЕРВ ПО SKU (что держать на складе СВЕРХ B2C-матрицы)"]);
  const c2HdrRow = rows.length - 1;
  rows.push(["№", "SKU", "Бут./мес (B2B)", `Резерв (${COVER_WEEKS} нед)`, "Кто берёт", "Бутылок/мес по клиентам"]);
  const c2ColRow = rows.length - 1;
  const c2Start = rows.length;
  reserveSorted.forEach((r, i) => {
    const customers = [...r.bottlesByCustomer.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([c, v]) => `${c}: ${(Math.round(v * 10) / 10).toFixed(1)}`)
      .join("\n");
    rows.push([
      i + 1,
      r.skuName,
      Math.round(r.bottlesPerMonth * 10) / 10,
      r.coverBottles,
      r.bottlesByCustomer.size,
      customers,
    ]);
  });
  rows.push(["", "ИТОГО SKU/бутылок:", reserveSorted.length, reserveTotalBottles, "", ""]);
  const c2End = rows.length;

  // ─── Block 3: Per-customer SKU detail (top 5 SKU each)
  rows.push([]);
  rows.push(["ДЕТАЛИ: ТОП-SKU У КАЖДОГО РЕГУЛЯРНОГО КЛИЕНТА"]);
  const c3HdrRow = rows.length - 1;
  rows.push(["Клиент", "SKU", "Бутылок (за период)", "Бут./мес"]);
  const c3ColRow = rows.length - 1;
  const c3Start = rows.length;
  for (const [name, d] of regulars) {
    const top = [...d.skuQty.entries()]
      .map(([id, qty]) => ({ id, qty, name: itemName.get(id) ?? id, perMonth: qty / PERIOD_MONTHS }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
    for (let i = 0; i < top.length; i++) {
      rows.push([
        i === 0 ? name : "",
        top[i].name,
        Math.round(top[i].qty),
        Math.round(top[i].perMonth * 10) / 10,
      ]);
    }
  }
  const c3End = rows.length;

  // Notes
  rows.push([]);
  rows.push(["Заметки:"]);
  rows.push([`  · «Регулярный» клиент = ≥${MIN_ACTIVE_MONTHS} активных месяцев в окне ${PERIOD_MONTHS} мес. Sporadic клиенты исключены — их заказы не предсказуемы.`]);
  rows.push([`  · Резерв = ceil(B2B-velocity × ${COVER_WEEKS} нед / 4.345). Это сколько нужно держать на полке СВЕРХ B2C-плана матрицы.`]);
  rows.push([`  · Если SKU есть и в B2C-матрице, и в этом резерве — покупай ОБА количества (B2C + B2B).`]);
  rows.push([`  · Минимальный порог: SKU должен идти ≥${MIN_UNITS_PER_MONTH} бут/мес от B2B, иначе не в резерве (шум).`]);

  await writeRows(sheetId, 0, 0, rows);

  // ─── Formatting ────────────────────────────────────────────────────────
  const FMT_BAHT = { type: "CURRENCY", pattern: "#,##0\\ \"฿\"" };
  const FMT_INT  = { type: "NUMBER",   pattern: "#,##0" };
  const FMT_DEC  = { type: "NUMBER",   pattern: "#,##0.0" };
  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  const fmt: any[] = [];
  fmt.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });
  const widths = [320, 100, 110, 110, 100, 600];
  for (let i = 0; i < widths.length; i++) {
    fmt.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: widths[i] }, fields: "pixelSize" } });
  }
  // Title
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
      cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 }, mergeType: "MERGE_ALL" } });

  // Block 1
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c1HdrRow, endRowIndex: c1HdrRow + 1, startColumnIndex: 0, endColumnIndex: 6 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.45, green: 0.36, blue: 0.08 }, textFormat: { bold: true, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: c1HdrRow, endRowIndex: c1HdrRow + 1, startColumnIndex: 0, endColumnIndex: 6 }, mergeType: "MERGE_ALL" } });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c1ColRow, endRowIndex: c1ColRow + 1, startColumnIndex: 0, endColumnIndex: 6 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c1Start, endRowIndex: c1End, startColumnIndex: 1, endColumnIndex: 3 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c1Start, endRowIndex: c1End, startColumnIndex: 3, endColumnIndex: 6 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // ИТОГО row
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c1End - 1, endRowIndex: c1End, startColumnIndex: 0, endColumnIndex: 6 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // Block 2
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c2HdrRow, endRowIndex: c2HdrRow + 1, startColumnIndex: 0, endColumnIndex: 6 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.55, green: 0.13, blue: 0.13 }, textFormat: { bold: true, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: c2HdrRow, endRowIndex: c2HdrRow + 1, startColumnIndex: 0, endColumnIndex: 6 }, mergeType: "MERGE_ALL" } });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c2ColRow, endRowIndex: c2ColRow + 1, startColumnIndex: 0, endColumnIndex: 6 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // Number format for cols 0 (#) — center, 2 (бут/мес) — DEC, 3 (резерв) — INT bold, 4 (кто берёт) — INT center
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c2Start, endRowIndex: c2End, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { horizontalAlignment: "CENTER", textFormat: { foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } } } },
      fields: "userEnteredFormat(horizontalAlignment,textFormat)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c2Start, endRowIndex: c2End, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: { numberFormat: FMT_DEC, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c2Start, endRowIndex: c2End, startColumnIndex: 3, endColumnIndex: 4 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "CENTER", textFormat: { bold: true } } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment,textFormat)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c2Start, endRowIndex: c2End, startColumnIndex: 4, endColumnIndex: 5 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c2Start, endRowIndex: c2End, startColumnIndex: 5, endColumnIndex: 6 },
      cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP", textFormat: { fontSize: 9 } } },
      fields: "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)",
    },
  });
  // ИТОГО row in block 2
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c2End - 1, endRowIndex: c2End, startColumnIndex: 0, endColumnIndex: 6 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // Block 3
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c3HdrRow, endRowIndex: c3HdrRow + 1, startColumnIndex: 0, endColumnIndex: 4 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.40, blue: 0.20 }, textFormat: { bold: true, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: c3HdrRow, endRowIndex: c3HdrRow + 1, startColumnIndex: 0, endColumnIndex: 4 }, mergeType: "MERGE_ALL" } });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c3ColRow, endRowIndex: c3ColRow + 1, startColumnIndex: 0, endColumnIndex: 4 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c3Start, endRowIndex: c3End, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: c3Start, endRowIndex: c3End, startColumnIndex: 3, endColumnIndex: 4 },
      cell: { userEnteredFormat: { numberFormat: FMT_DEC, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });

  await sheets("POST", ":batchUpdate", { requests: fmt });
  console.log(`✓ "${TAB}" written.`);
  console.log(`→ https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);
}
main().catch(e => { console.error(e); process.exit(1); });
