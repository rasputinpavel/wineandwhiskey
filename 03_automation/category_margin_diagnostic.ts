/**
 * category_margin_diagnostic.ts
 *
 * Считает по каждой категории Loyverse:
 *   - количество SKU
 *   - общая выручка / закуп / маржа за период (15 мес.)
 *   - месячная выручка/маржа = total / period_months
 *   - GP% (gross margin %)
 *   - подсветка: насколько каждая категория покрывает FOC = 100K/мес
 *
 * Пишет в лист "Маржа по категориям". Сейчас отвечает на вопрос:
 * «Из чего состоит моя текущая маржа в магазине? Хватает ли её на FOC + личный доход?»
 *
 * Usage:
 *   npx tsx 03_automation/category_margin_diagnostic.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SHEET_ID = "10EfJl0cfWj1GLoFXq9nHfZ4ZrlLcQloXs4ANRbt8HBg";
const TAB      = "Маржа по категориям";
const PERIOD_MONTHS = 15;
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

async function loyverseFetch<T>(path: string, key: string): Promise<T[]> {
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

// ─── Bucketing: Loyverse cat name → high-level group ──────────────────────

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

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nCategory Margin Diagnostic\n");

  const todayBkk = new Date(Date.now() + 7 * 3_600_000);
  const toIso    = todayBkk.toISOString().slice(0, 10);
  const fromIso  = new Date(todayBkk.getTime() - PERIOD_MONTHS * 30 * 86_400_000).toISOString().slice(0, 10);
  console.log(`Period: ${fromIso} → ${toIso}\n`);

  console.log("[1/3] Fetching Loyverse data...");
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

  console.log(`[2/3] Fetching receipts...`);
  const minUtc = new Date(`${fromIso}T00:00:00+07:00`).toISOString();
  const maxUtc = new Date(`${toIso}T23:59:59+07:00`).toISOString();
  const receipts: any[] = await loyverseFetch(
    `/receipts?receipt_type=SALE&created_at_min=${minUtc}&created_at_max=${maxUtc}`,
    "receipts",
  );
  console.log(`  ${receipts.length} receipts.`);

  console.log("[3/3] Aggregating by group...");
  interface Agg { units: number; revenue: number; cost: number; skus: Set<string>; }
  const acc = new Map<Group, Agg>();
  function getAgg(g: Group): Agg {
    if (!acc.has(g)) acc.set(g, { units: 0, revenue: 0, cost: 0, skus: new Set() });
    return acc.get(g)!;
  }
  for (const r of receipts) {
    for (const li of r.line_items ?? []) {
      const id = li.item_id; if (!id) continue;
      const catId = itemCat.get(id); if (!catId) continue;
      const group = catGroup.get(catId); if (!group) continue;
      const a = getAgg(group);
      a.units    += li.quantity ?? 0;
      a.revenue  += li.total_money ?? 0;
      a.cost     += li.cost_total  ?? 0;
      a.skus.add(id);
    }
  }

  // Order in which to render — biggest revenue first within categories of interest
  const groupOrder: Group[] = ["Красное вино", "Белое вино", "Игристое", "Пиво", "Крепкий алкоголь", "Закуски (Food)", "Аксессуары", "Прочее (региональные / приватные)", "Архив / прочее"];

  let totalRev15m = 0, totalCost15m = 0;
  for (const a of acc.values()) { totalRev15m += a.revenue; totalCost15m += a.cost; }
  const totalProfit15m = totalRev15m - totalCost15m;
  const totalRevMonth  = totalRev15m / PERIOD_MONTHS;
  const totalProfitMonth = totalProfit15m / PERIOD_MONTHS;

  console.log(`\nИТОГО за 15 мес: выручка ${Math.round(totalRev15m).toLocaleString("ru-RU")} ฿, маржа ${Math.round(totalProfit15m).toLocaleString("ru-RU")} ฿`);
  console.log(`В среднем в месяц: выручка ${Math.round(totalRevMonth).toLocaleString("ru-RU")} ฿, маржа ${Math.round(totalProfitMonth).toLocaleString("ru-RU")} ฿\n`);

  // ─── Build sheet ──────────────────────────────────────────────────────
  const sheetId = await ensureTab(TAB);
  await clearTab(sheetId);

  const rows: any[][] = [];

  // Title
  rows.push([`Маржа по категориям · ${fromIso} → ${toIso} (${PERIOD_MONTHS} мес.) · в среднем за месяц`]);

  // Big-picture summary
  rows.push([]);
  rows.push(["Индикатор", "Значение"]);
  const ksiHdrRow = rows.length - 1;
  rows.push(["Выручка магазина / мес",    Math.round(totalRevMonth)]);
  rows.push(["Маржа магазина / мес",      Math.round(totalProfitMonth)]);
  rows.push(["GP% магазина",              totalRev15m > 0 ? Math.round((totalProfit15m / totalRev15m) * 1000) / 10 : 0]);
  rows.push(["Постоянные расходы (FOC)",  FOC]);
  rows.push(["Цель прибыли · низкий сезон (Apr-Oct)",   TARGET_LOW]);
  rows.push(["Цель прибыли · высокий сезон (Nov-Mar)",  TARGET_HIGH]);
  rows.push(["Разрыв до низкого сезона",  Math.round(TARGET_LOW  - totalProfitMonth)]);
  rows.push(["Разрыв до высокого сезона", Math.round(TARGET_HIGH - totalProfitMonth)]);
  const ksiEndRow = rows.length;

  // Per-group breakdown
  rows.push([]);
  rows.push(["Группа", "SKU", "Бут./мес", "Выручка/мес", "Закуп/мес", "Маржа/мес", "GP%", "Доля маржи"]);
  const breakHdrRow = rows.length - 1;

  // Sort by monthly margin desc within visible groups
  const visible = groupOrder.filter(g => acc.has(g));
  visible.sort((a, b) => (acc.get(b)!.revenue - acc.get(b)!.cost) - (acc.get(a)!.revenue - acc.get(a)!.cost));

  for (const g of visible) {
    const a = acc.get(g)!;
    const profit15m = a.revenue - a.cost;
    const revMonth  = a.revenue   / PERIOD_MONTHS;
    const costMonth = a.cost      / PERIOD_MONTHS;
    const profitMonth = profit15m / PERIOD_MONTHS;
    const unitsMonth = a.units    / PERIOD_MONTHS;
    const gp = a.revenue > 0 ? (profit15m / a.revenue) * 100 : 0;
    const share = totalProfit15m > 0 ? (profit15m / totalProfit15m) * 100 : 0;
    rows.push([
      g, a.skus.size,
      Math.round(unitsMonth * 10) / 10,
      Math.round(revMonth),
      Math.round(costMonth),
      Math.round(profitMonth),
      Math.round(gp * 10) / 10,
      Math.round(share * 10) / 10,
    ]);
  }
  rows.push([
    "ИТОГО",
    visible.reduce((s, g) => s + acc.get(g)!.skus.size, 0),
    Math.round((visible.reduce((s, g) => s + acc.get(g)!.units, 0) / PERIOD_MONTHS) * 10) / 10,
    Math.round(totalRevMonth),
    Math.round((totalRev15m - totalProfit15m) / PERIOD_MONTHS),
    Math.round(totalProfitMonth),
    totalRev15m > 0 ? Math.round((totalProfit15m / totalRev15m) * 1000) / 10 : 0,
    100,
  ]);
  const breakEndRow = rows.length;

  // Coverage analysis
  rows.push([]);
  rows.push(["Покрытие FOC и личного дохода"]);
  const covHdrRow = rows.length - 1;
  rows.push([`Маржа всего магазина: ${Math.round(totalProfitMonth).toLocaleString("ru-RU")} ฿/мес`]);
  rows.push([`FOC = ${FOC.toLocaleString("ru-RU")} ฿/мес → остаётся после FOC: ${Math.round(totalProfitMonth - FOC).toLocaleString("ru-RU")} ฿`]);
  rows.push([`Низкий сезон: цель личного дохода ${(TARGET_LOW - FOC).toLocaleString("ru-RU")} ฿ → ${(totalProfitMonth - FOC) >= (TARGET_LOW - FOC) ? "✓ покрывается" : "✗ разрыв " + Math.round((TARGET_LOW - FOC) - (totalProfitMonth - FOC)).toLocaleString("ru-RU") + " ฿"}`]);
  rows.push([`Высокий сезон: цель личного дохода ${(TARGET_HIGH - FOC).toLocaleString("ru-RU")} ฿ → ${(totalProfitMonth - FOC) >= (TARGET_HIGH - FOC) ? "✓ покрывается" : "✗ разрыв " + Math.round((TARGET_HIGH - FOC) - (totalProfitMonth - FOC)).toLocaleString("ru-RU") + " ฿"}`]);
  rows.push([]);
  rows.push(["Допущения:"]);
  rows.push(["  · цифры — средние за 15 месяцев. Сезонность (Nov-Mar выше) НЕ учтена в средней."]);
  rows.push(["  · «Маржа» = (выручка − закуп) от продаж по факту последних 15 мес. Это gross profit ДО вычета FOC."]);
  rows.push(["  · продажи могут быть выше/ниже этого числа в любой конкретный месяц — это база для планирования, не прогноз."]);

  await writeRows(sheetId, 0, 0, rows);

  // ─── Formatting ──────────────────────────────────────────────────────
  const FMT_INT  = { type: "NUMBER",   pattern: "#,##0" };
  const FMT_BAHT = { type: "CURRENCY", pattern: "#,##0\\ \"฿\"" };
  const FMT_PCT  = { type: "NUMBER",   pattern: "0.0\"%\"" };
  const FMT_DEC  = { type: "NUMBER",   pattern: "#,##0.0" };
  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };

  const fmt: any[] = [];
  fmt.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });

  const widths = [320, 90, 90, 130, 130, 130, 80, 100];
  for (let i = 0; i < widths.length; i++) {
    fmt.push({ updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: widths[i] }, fields: "pixelSize",
    }});
  }

  // Title
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
      cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: "MERGE_ALL" } });

  // KSI block
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: ksiHdrRow, endRowIndex: ksiHdrRow + 1, startColumnIndex: 0, endColumnIndex: 2 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.40, blue: 0.20 }, textFormat: { bold: true, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: ksiHdrRow + 1, endRowIndex: ksiEndRow, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT", textFormat: { bold: true } } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment,textFormat)",
    },
  });
  // GP row uses % format
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: ksiHdrRow + 3, endRowIndex: ksiHdrRow + 4, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: FMT_PCT } },
      fields: "userEnteredFormat.numberFormat",
    },
  });
  // Highlight gap rows red if positive (gap exists)
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: ksiHdrRow + 7, endRowIndex: ksiEndRow, startColumnIndex: 0, endColumnIndex: 2 },
      cell: { userEnteredFormat: { backgroundColor: { red: 1.0, green: 0.92, blue: 0.92 } } },
      fields: "userEnteredFormat.backgroundColor",
    },
  });

  // Breakdown header
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: breakHdrRow, endRowIndex: breakHdrRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.45, green: 0.36, blue: 0.08 }, textFormat: { bold: true, foregroundColor: white }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // Breakdown numbers
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: breakHdrRow + 1, endRowIndex: breakEndRow, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: breakHdrRow + 1, endRowIndex: breakEndRow, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: { numberFormat: FMT_DEC, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: breakHdrRow + 1, endRowIndex: breakEndRow, startColumnIndex: 3, endColumnIndex: 6 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: breakHdrRow + 1, endRowIndex: breakEndRow, startColumnIndex: 6, endColumnIndex: 8 },
      cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // ИТОГО row
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: breakEndRow - 1, endRowIndex: breakEndRow, startColumnIndex: 0, endColumnIndex: 8 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // Coverage block
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: covHdrRow, endRowIndex: covHdrRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
      cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: covHdrRow, endRowIndex: covHdrRow + 1, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: "MERGE_ALL" } });
  // Wrap coverage / assumption rows
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: covHdrRow + 1, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: 8 },
      cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP" } },
      fields: "userEnteredFormat(wrapStrategy,verticalAlignment)",
    },
  });
  for (let r = covHdrRow + 1; r < rows.length; r++) {
    fmt.push({ mergeCells: { range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: "MERGE_ALL" } });
  }

  await sheets("POST", ":batchUpdate", { requests: fmt });
  console.log(`✓ "${TAB}" written.\n→ https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
