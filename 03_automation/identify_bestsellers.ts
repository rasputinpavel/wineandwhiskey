/**
 * identify_bestsellers.ts
 * Identifies bestseller positions across all alcohol categories.
 *
 * A bestseller is a position that customers come back for, that must always
 * be in stock. To qualify, an item must pass all four filters:
 *   1. Velocity        — sells ≥ min_bottles_per_month on average
 *   2. Consistency     — sold in ≥ min_weeks_with_sales_pct of all weeks
 *   3. Recency         — last sale within max_days_since_last_sale
 *   4. (B2B is included in volume but flagged as % share)
 *
 * Parameters are read from "Параметры" tab in the target sheet:
 *   period_months, min_bottles_per_month, min_weeks_with_sales_pct,
 *   max_days_since_last_sale, target_weeks_of_stock
 *
 * Output: "Бестселлеры" tab.
 *
 * Usage:
 *   npx tsx 03_automation/identify_bestsellers.ts
 */

import dotenv from "dotenv";
import { classifyReceipt } from "./lib/b2b.js";
import { loyverseFetch } from "./lib/loyverse.js";
dotenv.config({ path: ".env.local" });

const SHEET_ID             = "10EfJl0cfWj1GLoFXq9nHfZ4ZrlLcQloXs4ANRbt8HBg";
const PARAMS_TAB           = "Параметры";
const BESTSELLERS_TAB      = "Бестселлеры";
const LOYVERSE_TOKEN       = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

// Default parameters (used if Параметры tab is missing or has no value)
const DEFAULTS = {
  period_months: 15,
  min_bottles_per_month: 3,
  min_weeks_with_sales_pct: 50,
  max_days_since_last_sale: 30,
  target_weeks_of_stock: 4,
};

// Categories that are NOT alcohol (excluded from bestsellers)
const NON_ALCOHOL_PATTERNS = [
  /закус/i, /snack/i, /food/i, /еда/i, /бокал/i, /glass/i,
  /посуд/i, /сувенир/i, /доставк/i, /delivery/i, /serv/i, /услуг/i,
  /пакет/i, /bag/i, /штопор/i,
];
function isNonAlcohol(categoryName: string): boolean {
  return NON_ALCOHOL_PATTERNS.some(p => p.test(categoryName));
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
    requests: [{ updateCells: { range: { sheetId }, fields: "userEnteredValue,userEnteredFormat" } }],
  });
}

async function readRange(tab: string, range: string): Promise<any[][]> {
  const r = await sheets("GET", `/values/${encodeURIComponent(`${tab}!${range}`)}`);
  return r.values ?? [];
}

async function writeValues(tab: string, range: string, values: any[][]) {
  await sheets("PUT", `/values/${encodeURIComponent(`${tab}!${range}`)}?valueInputOption=RAW`, {
    range: `${tab}!${range}`, majorDimension: "ROWS", values,
  });
}

// ─── Parameters tab ────────────────────────────────────────────────────────

interface Params {
  period_months: number;
  min_bottles_per_month: number;
  min_weeks_with_sales_pct: number;
  max_days_since_last_sale: number;
  target_weeks_of_stock: number;
}

async function loadParams(): Promise<Params> {
  // Ensure tab exists
  const meta = await sheets("GET", "");
  const has = (meta.sheets ?? []).some((s: any) => s.properties.title === PARAMS_TAB);
  if (!has) {
    await ensureTab(PARAMS_TAB);
    await writeValues(PARAMS_TAB, "A1:B6", [
      ["Параметр", "Значение"],
      ["period_months", DEFAULTS.period_months],
      ["min_bottles_per_month", DEFAULTS.min_bottles_per_month],
      ["min_weeks_with_sales_pct", DEFAULTS.min_weeks_with_sales_pct],
      ["max_days_since_last_sale", DEFAULTS.max_days_since_last_sale],
      ["target_weeks_of_stock", DEFAULTS.target_weeks_of_stock],
    ]);
    console.log("  Created Параметры tab with defaults.");
    return { ...DEFAULTS };
  }

  const rows = await readRange(PARAMS_TAB, "A2:B100");
  const out: Params = { ...DEFAULTS };
  for (const [k, v] of rows) {
    if (!k || v === "" || v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (k in out) (out as any)[k] = n;
  }
  return out;
}

// ─── Loyverse ──────────────────────────────────────────────────────────────

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

// ─── Helpers ───────────────────────────────────────────────────────────────

function bangkokToday(): Date {
  return new Date(Date.now() + 7 * 3_600_000);
}

function isoWeekKey(date: Date): string {
  // ISO week-year + week number; uniquely identifies a week across years.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// ─── Main ──────────────────────────────────────────────────────────────────

interface ItemAgg {
  itemId: string;
  name: string;
  sku: string;
  category: string;
  supplier: string;
  units: number;
  unitsLast3m: number;
  revenue: number;
  cost: number;
  weeksWithSales: Set<string>;
  lastSaleDate: string;
  b2bUnits: number;
  stock: number;
  avgPrice: number;
}

async function main() {
  console.log("\nBestsellers Identifier\n");

  const params = await loadParams();
  console.log("Parameters:");
  for (const [k, v] of Object.entries(params)) console.log(`  ${k} = ${v}`);

  const todayBkk = bangkokToday();
  const toDateIso = todayBkk.toISOString().slice(0, 10);
  const fromDate = new Date(todayBkk.getTime() - params.period_months * 30 * 86_400_000);
  const fromDateIso = fromDate.toISOString().slice(0, 10);

  console.log(`\nPeriod: ${fromDateIso} → ${toDateIso} (${params.period_months} months)\n`);

  // 1. Fetch metadata
  console.log("[1/4] Fetching categories, items, inventory, suppliers...");
  const [categories, items, invLevels, suppliers] = await Promise.all([
    loyverseFetch<any>("/categories", "categories"),
    loyverseFetch<any>("/items", "items"),
    loyverseFetch<any>("/inventory", "inventory_levels"),
    loyverseFetch<any>("/suppliers", "suppliers"),
  ]);

  const catMap = new Map<string, string>();
  for (const c of categories) catMap.set(c.id, c.name);

  const supplierName = new Map<string, string>();
  for (const s of suppliers) supplierName.set(s.id, s.name ?? s.supplier_name ?? "—");

  const itemCat       = new Map<string, string>();
  const itemSupplier  = new Map<string, string>();
  const variantItem   = new Map<string, string>();
  const itemSku       = new Map<string, string>();
  const itemName      = new Map<string, string>();
  for (const item of items) {
    if (item.category_id) itemCat.set(item.id, item.category_id);
    if (item.primary_supplier_id) {
      itemSupplier.set(item.id, supplierName.get(item.primary_supplier_id) ?? "—");
    }
    itemName.set(item.id, item.item_name ?? item.name ?? "—");
    for (const v of item.variants ?? []) {
      variantItem.set(v.variant_id, item.id);
      if (v.sku && !itemSku.has(item.id)) itemSku.set(item.id, v.sku);
    }
  }

  const itemStock = new Map<string, number>();
  for (const lvl of invLevels) {
    const itemId = variantItem.get(lvl.variant_id);
    if (!itemId) continue;
    itemStock.set(itemId, (itemStock.get(itemId) ?? 0) + (lvl.in_stock ?? 0));
  }
  console.log(`  ${categories.length} categories · ${items.length} items · ${invLevels.length} inv levels · ${suppliers.length} suppliers`);

  // 2. Fetch receipts
  console.log(`\n[2/4] Fetching receipts ${fromDateIso} → ${toDateIso}...`);
  const minUtc = new Date(`${fromDateIso}T00:00:00+07:00`).toISOString();
  const maxUtc = new Date(`${toDateIso}T23:59:59+07:00`).toISOString();
  const receipts: any[] = await loyverseFetch(
    `/receipts?receipt_type=SALE&created_at_min=${minUtc}&created_at_max=${maxUtc}`,
    "receipts",
  );
  console.log(`  ${receipts.length} receipts fetched.`);

  // 3. Resolve customer names (for B2B detection)
  console.log("\n[3/4] Resolving customers...");
  const customerIds = new Set<string>();
  for (const r of receipts) if (r.customer_id) customerIds.add(r.customer_id);
  const customerNames = await fetchCustomerNames(customerIds);
  console.log(`  ${customerNames.size}/${customerIds.size} customer names resolved.`);

  // 4. Aggregate
  console.log("\n[4/4] Aggregating sales...");
  const threeMonthsAgo = new Date(todayBkk.getTime() - 90 * 86_400_000);
  const acc = new Map<string, ItemAgg>();
  for (const r of receipts) {
    if (r.cancelled_at) continue;                       // voided — never a sale
    const sign = r.receipt_type === "REFUND" ? -1 : 1;  // refunds reduce net sales
    const created = new Date(r.created_at);
    const bkkDate = new Date(created.getTime() + 7 * 3_600_000);
    const isLast3m = bkkDate >= threeMonthsAgo;
    const customerName = r.customer_id ? (customerNames.get(r.customer_id) ?? "") : "";
    // Full B2B rule: bank-transfer OR known customer name (was name-only).
    const isB2B = classifyReceipt({ payments: r.payments, customerName }).isB2B;
    const weekKey = isoWeekKey(bkkDate);
    const dateIso = bkkDate.toISOString().slice(0, 10);

    for (const li of r.line_items ?? []) {
      const id = li.item_id as string;
      if (!id) continue;
      const catId = itemCat.get(id);
      const catName = catId ? (catMap.get(catId) ?? "—") : "—";
      if (isNonAlcohol(catName)) continue;

      const cur = acc.get(id) ?? {
        itemId: id,
        name: itemName.get(id) ?? li.item_name ?? id,
        sku: itemSku.get(id) ?? "",
        category: catName,
        supplier: itemSupplier.get(id) ?? "—",
        units: 0,
        unitsLast3m: 0,
        revenue: 0,
        cost: 0,
        weeksWithSales: new Set<string>(),
        lastSaleDate: "",
        b2bUnits: 0,
        stock: itemStock.get(id) ?? 0,
        avgPrice: 0,
      };
      const qty  = (li.quantity ?? 0) * sign;
      const rev  = (li.total_money ?? 0) * sign;
      const cost = (li.cost_total  ?? 0) * sign;
      cur.units    += qty;
      cur.revenue  += rev;
      cur.cost     += cost;
      if (sign > 0) cur.weeksWithSales.add(weekKey);
      if (isLast3m) cur.unitsLast3m += qty;
      if (isB2B) cur.b2bUnits += qty;
      if (!cur.lastSaleDate || dateIso > cur.lastSaleDate) cur.lastSaleDate = dateIso;
      acc.set(id, cur);
    }
  }
  console.log(`  ${acc.size} alcohol items with sales.`);

  // 5. Apply filters
  const totalWeeks = Math.max(1, Math.round(params.period_months * 4.345));
  const minBottles = params.min_bottles_per_month * params.period_months;
  const last3mMonths = Math.min(3, params.period_months);

  const candidates = [...acc.values()].map(a => {
    const bottlesPerMonth   = a.units / params.period_months;
    const bottlesPerMonth3m = a.unitsLast3m / last3mMonths;
    const weeksWithSalesPct = (a.weeksWithSales.size / totalWeeks) * 100;
    const daysSinceLastSale = a.lastSaleDate
      ? Math.floor((todayBkk.getTime() - new Date(a.lastSaleDate).getTime()) / 86_400_000)
      : 9999;
    const b2bPct  = a.units > 0 ? (a.b2bUnits / a.units) * 100 : 0;
    const gpPct   = a.revenue > 0 ? ((a.revenue - a.cost) / a.revenue) * 100 : 0;
    const avgPrice = a.units > 0 ? a.revenue / a.units : 0;

    // weeks of stock (use 3m velocity if available, else 15m)
    const velocityPerWeek = bottlesPerMonth3m > 0
      ? bottlesPerMonth3m / 4.345
      : bottlesPerMonth / 4.345;
    const daysOfStock = velocityPerWeek > 0
      ? Math.round((a.stock / velocityPerWeek) * 7)
      : 9999;
    const minStock = Math.ceil(velocityPerWeek * params.target_weeks_of_stock);
    const reorder = a.stock < minStock;

    return {
      ...a,
      bottlesPerMonth,
      bottlesPerMonth3m,
      weeksWithSalesPct,
      daysSinceLastSale,
      b2bPct,
      gpPct,
      avgPrice,
      daysOfStock,
      minStock,
      reorder,
      isBestseller:
        a.units >= minBottles &&
        weeksWithSalesPct >= params.min_weeks_with_sales_pct &&
        daysSinceLastSale <= params.max_days_since_last_sale,
    };
  });

  const bestsellers = candidates
    .filter(c => c.isBestseller)
    .sort((a, b) => b.bottlesPerMonth - a.bottlesPerMonth);

  console.log(`\n  ${bestsellers.length} bestsellers (out of ${candidates.length} candidates).`);

  // 6. Write to Sheets
  console.log("\nWriting to Google Sheets...");
  const sheetId = await ensureTab(BESTSELLERS_TAB);
  await clearTab(sheetId);

  const headers = [
    "#", "Название", "SKU", "Категория", "Поставщик",
    "Бут/мес (15м)", "Бут/мес (3м)", "% недель", "Дней с продажи",
    "% B2B", "Остаток", "Дней запаса", "Min-stock (4 нед)", "Дозаказать?",
    "Ср.цена ฿", "GP%", "Выручка ฿", "Штук всего",
  ];
  const titleRow = [
    `Бестселлеры · ${fromDateIso} → ${toDateIso} · период ${params.period_months}м · ≥${params.min_bottles_per_month} бут/мес · ≥${params.min_weeks_with_sales_pct}% недель · последняя продажа ≤${params.max_days_since_last_sale}д`,
    ...new Array(headers.length - 1).fill(""),
  ];

  const rows: any[][] = [titleRow, headers];
  bestsellers.forEach((b, i) => {
    rows.push([
      i + 1,
      b.name,
      b.sku,
      b.category,
      b.supplier,
      Math.round(b.bottlesPerMonth * 10) / 10,
      Math.round(b.bottlesPerMonth3m * 10) / 10,
      Math.round(b.weeksWithSalesPct),
      b.daysSinceLastSale,
      Math.round(b.b2bPct),
      b.stock,
      b.daysOfStock >= 9999 ? "—" : b.daysOfStock,
      b.minStock,
      b.reorder ? "ДА" : "",
      Math.round(b.avgPrice),
      Math.round(b.gpPct),
      Math.round(b.revenue),
      b.units,
    ]);
  });

  await writeValues(BESTSELLERS_TAB, "A1", rows);

  // Formatting
  const nCols = headers.length;
  const fmtRequests: any[] = [];

  // Freeze header rows
  fmtRequests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 2 } },
      fields: "gridProperties.frozenRowCount",
    },
  });

  // Title row
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.15, green: 0.15, blue: 0.15 },
          textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmtRequests.push({
    mergeCells: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      mergeType: "MERGE_ALL",
    },
  });

  // Header row
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: nCols },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.92, green: 0.92, blue: 0.92 },
          textFormat: { bold: true, fontSize: 10 },
          horizontalAlignment: "CENTER",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });

  // Conditional format: "Дозаказать?" = ДА → red background
  fmtRequests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId, startRowIndex: 2, endRowIndex: 2 + bestsellers.length, startColumnIndex: 13, endColumnIndex: 14 }],
        booleanRule: {
          condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "ДА" }] },
          format: {
            backgroundColor: { red: 0.96, green: 0.78, blue: 0.78 },
            textFormat: { bold: true, foregroundColor: { red: 0.6, green: 0, blue: 0 } },
          },
        },
      },
      index: 0,
    },
  });

  // Column widths
  const widths = [40, 280, 90, 140, 140, 90, 90, 80, 90, 70, 70, 90, 110, 100, 90, 70, 100, 90];
  for (let i = 0; i < widths.length; i++) {
    fmtRequests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: widths[i] },
        fields: "pixelSize",
      },
    });
  }

  await sheets("POST", ":batchUpdate", { requests: fmtRequests });

  console.log(`\nDone. ${bestsellers.length} bestsellers written to "${BESTSELLERS_TAB}" tab.`);
  console.log(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
}

main().catch(e => { console.error(e); process.exit(1); });
