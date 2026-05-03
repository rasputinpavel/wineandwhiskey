/**
 * wine_breakdown.ts
 * Builds a 15-month sales breakdown for wine:
 *   - Whites grouped by grape variety
 *   - Reds grouped by country → region
 * Writes two tabs: "Белые-сорта" and "Красные-регионы".
 *
 * Usage:
 *   npx tsx 03_automation/wine_breakdown.ts             # last 15 months
 *   npx tsx 03_automation/wine_breakdown.ts 12          # last 12 months
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import {
  Grape, GRAPE_ORDER, detectGrape,
  RedCountry, RED_COUNTRY_ORDER, detectRedCountryRegion,
} from "./lib/wine_detect.js";

const SHEET_ID             = "10EfJl0cfWj1GLoFXq9nHfZ4ZrlLcQloXs4ANRbt8HBg";
const TAB_WHITE            = "Белые-сорта";
const TAB_RED              = "Красные-регионы";
const TAB_SPARKLING        = "Игристые";
const TAB_SPIRITS          = "Крепкие";
const TAB_PARETO           = "Парето-вино";
const TAB_OTHER            = "Прочее";
const TAB_BEER             = "Пиво";
const PARETO_THRESHOLD     = 0.80; // позиции, на которые приходится первые 80% проданных бутылок = массовые

// Categories to EXCLUDE from "Прочее" sheet (wines, spirits, cigars, archive,
// beer (separate sheet), private/regional buckets).
const OTHER_EXCLUDE_PATTERNS = [
  /white\s*wine|red\s*wine|sparkling\s*wine|rose\s*wine|orange\s*wine|natural\s*wine|p[ée]t[\s\-]?nat/i,
  /whiskey|whisky|vodka|^gin$|^rum$|tequila|cognac|armagnac|calvados|sidr|cidre|grappa|liquor|liqueur|sherry|fortified|sake/i,
  /cigar/i,
  /archive/i,
  /^beer$|пиво/i,
  /^russia$|^thailand\s+granmonte$|^lazada$|^wholesale$|^coke$|^gallothai$|^consigment$|^consignment$/i,
];

// Loyverse category name → human-readable spirit type label.
const SPIRIT_CATEGORIES: Array<{ match: RegExp; label: string }> = [
  { match: /^whiskey$|whisky/i,        label: "Виски" },
  { match: /^vodka$|водка/i,           label: "Водка" },
  { match: /^gin$|джин/i,              label: "Джин" },
  { match: /^rum$|ром/i,               label: "Ром" },
  { match: /tequila|текила/i,          label: "Текила" },
  { match: /cognac|armagnac|коньяк|арманьяк/i, label: "Коньяк / Арманьяк" },
  { match: /calvados|sidr|cidre|кальвадос|сидр/i, label: "Кальвадос / Сидр" },
  { match: /grappa|граппа/i,           label: "Граппа" },
  { match: /liquor|liqueur|ликёр|ликер/i, label: "Ликёры" },
  { match: /sherry|херес/i,            label: "Херес" },
  { match: /fortified|крепленое/i,     label: "Крепленые" },
  { match: /sake|саке/i,               label: "Саке" },
];
const PERIOD_MONTHS        = Number(process.argv[2] ?? 15);
const LOYVERSE_TOKEN       = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

// ─── Google Sheets boilerplate ─────────────────────────────────────────────

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

async function writeValues(tab: string, range: string, values: any[][]) {
  await sheets("PUT", `/values/${encodeURIComponent(`${tab}!${range}`)}?valueInputOption=RAW`, {
    range: `${tab}!${range}`, majorDimension: "ROWS", values,
  });
}

// Robust cell-by-cell write via batchUpdate.updateCells.
// The PUT /values endpoint occasionally drops cells in long writes; this avoids that.
async function writeRows(sheetId: number, startRow: number, startCol: number, rows: any[][]) {
  if (rows.length === 0) return;
  const maxCols = Math.max(...rows.map(r => r.length));
  const requests: any[] = [{
    updateCells: {
      start: { sheetId, rowIndex: startRow, columnIndex: startCol },
      rows: rows.map(row => ({
        values: Array.from({ length: maxCols }, (_, i) => {
          const v = row[i];
          if (v == null || v === "") return { userEnteredValue: { stringValue: "" } };
          if (typeof v === "number" && Number.isFinite(v)) return { userEnteredValue: { numberValue: v } };
          return { userEnteredValue: { stringValue: String(v) } };
        }),
      })),
      fields: "userEnteredValue",
    },
  }];
  // Sheets API limits requests by payload size; batch in chunks of 1000 rows just in case.
  const CHUNK = 1000;
  if (rows.length <= CHUNK) {
    await sheets("POST", ":batchUpdate", { requests });
    return;
  }
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await sheets("POST", ":batchUpdate", {
      requests: [{
        updateCells: {
          start: { sheetId, rowIndex: startRow + i, columnIndex: startCol },
          rows: chunk.map(row => ({
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
}

// ─── Loyverse ──────────────────────────────────────────────────────────────

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


// ─── Main ──────────────────────────────────────────────────────────────────

interface ItemAgg {
  itemId: string;
  name: string;
  units: number;
  revenue: number;
  cost: number;
}

async function main() {
  console.log(`\nWine Breakdown Builder · ${PERIOD_MONTHS} months\n`);

  const todayBkk = new Date(Date.now() + 7 * 3_600_000);
  const toDateIso = todayBkk.toISOString().slice(0, 10);
  const fromDate = new Date(todayBkk.getTime() - PERIOD_MONTHS * 30 * 86_400_000);
  const fromDateIso = fromDate.toISOString().slice(0, 10);
  console.log(`Period: ${fromDateIso} → ${toDateIso}\n`);

  // 1. Categories + items
  console.log("[1/3] Categories + items + receipts...");
  const [categories, items] = await Promise.all([
    loyverseFetch<any>("/categories", "categories"),
    loyverseFetch<any>("/items", "items"),
  ]);

  const whiteCatId     = categories.find(c => /white\s*wine|бел/i.test(c.name))?.id;
  const redCatId       = categories.find(c => /red\s*wine|красн/i.test(c.name))?.id;
  const sparklingCatId = categories.find(c => /sparkling/i.test(c.name))?.id;
  if (!whiteCatId || !redCatId) {
    console.error("White/Red wine categories not found.");
    process.exit(1);
  }

  // Map every spirit category id → label.
  const spiritCatLabel = new Map<string, string>();
  for (const cat of categories) {
    const rule = SPIRIT_CATEGORIES.find(r => r.match.test(cat.name));
    if (rule) spiritCatLabel.set(cat.id, rule.label);
  }
  console.log(`  Spirit categories: ${[...new Set(spiritCatLabel.values())].join(", ")}`);

  // "Прочее" sheet — every category that is not wine / spirit / cigar / archive / beer / private buckets.
  const otherCatName = new Map<string, string>();
  for (const cat of categories) {
    if (OTHER_EXCLUDE_PATTERNS.some(p => p.test(cat.name))) continue;
    otherCatName.set(cat.id, cat.name);
  }
  console.log(`  Other categories: ${[...otherCatName.values()].join(", ")}`);

  // Beer — separate sheet.
  const beerCatId = categories.find(c => /^beer$|пиво/i.test(c.name))?.id;

  const itemCat   = new Map<string, string>();
  const itemName  = new Map<string, string>();
  for (const item of items) {
    if (item.category_id) itemCat.set(item.id, item.category_id);
    itemName.set(item.id, item.item_name ?? item.name ?? "—");
  }

  // 2. Receipts
  const minUtc = new Date(`${fromDateIso}T00:00:00+07:00`).toISOString();
  const maxUtc = new Date(`${toDateIso}T23:59:59+07:00`).toISOString();
  const receipts: any[] = await loyverseFetch(
    `/receipts?receipt_type=SALE&created_at_min=${minUtc}&created_at_max=${maxUtc}`,
    "receipts",
  );
  console.log(`  ${receipts.length} receipts.`);

  // 3. Aggregate
  console.log("\n[2/3] Aggregating...");
  const acc = new Map<string, ItemAgg>();
  for (const r of receipts) {
    for (const li of r.line_items ?? []) {
      const id = li.item_id as string;
      if (!id) continue;
      const cat = itemCat.get(id);
      const isWine = cat === whiteCatId || cat === redCatId || cat === sparklingCatId;
      const isSpirit = cat && spiritCatLabel.has(cat);
      const isOther = cat && otherCatName.has(cat);
      const isBeer = cat && cat === beerCatId;
      if (!isWine && !isSpirit && !isOther && !isBeer) continue;
      const cur = acc.get(id) ?? { itemId: id, name: itemName.get(id) ?? li.item_name ?? id, units: 0, revenue: 0, cost: 0 };
      cur.units   += li.quantity ?? 0;
      cur.revenue += li.total_money ?? 0;
      cur.cost    += li.cost_total  ?? 0;
      acc.set(id, cur);
    }
  }

  // Split by colour
  const whites: (ItemAgg & { grape: Grape })[] = [];
  const reds:   (ItemAgg & { country: RedCountry; region: string })[] = [];
  const sparkling: ItemAgg[] = [];
  const spirits: (ItemAgg & { type: string })[] = [];
  const others: (ItemAgg & { category: string })[] = [];
  const beers: ItemAgg[] = [];
  for (const it of acc.values()) {
    if (it.units <= 0) continue;
    const cat = itemCat.get(it.itemId);
    if (cat === whiteCatId) {
      whites.push({ ...it, grape: detectGrape(it.name) });
    } else if (cat === redCatId) {
      const { country, region } = detectRedCountryRegion(it.name);
      reds.push({ ...it, country, region });
    } else if (sparklingCatId && cat === sparklingCatId) {
      sparkling.push(it);
    } else if (cat && spiritCatLabel.has(cat)) {
      spirits.push({ ...it, type: spiritCatLabel.get(cat)! });
    } else if (beerCatId && cat === beerCatId) {
      beers.push(it);
    } else if (cat && otherCatName.has(cat)) {
      others.push({ ...it, category: otherCatName.get(cat)! });
    }
  }
  console.log(`  Белых: ${whites.length} позиций · ${whites.reduce((s, w) => s + w.units, 0)} бут.`);
  console.log(`  Красных: ${reds.length} позиций · ${reds.reduce((s, r) => s + r.units, 0)} бут.`);
  console.log(`  Игристых: ${sparkling.length} позиций · ${sparkling.reduce((s, p) => s + p.units, 0)} бут.`);
  console.log(`  Крепких: ${spirits.length} позиций · ${spirits.reduce((s, p) => s + p.units, 0)} бут.`);
  console.log(`  Пива: ${beers.length} позиций · ${beers.reduce((s, p) => s + p.units, 0)} шт.`);
  console.log(`  Прочее: ${others.length} позиций · ${others.reduce((s, p) => s + p.units, 0)} шт.`);

  // 4. Write sheets
  console.log("\n[3/3] Writing to Sheets...");
  await writeWhiteSheet(whites, fromDateIso, toDateIso);
  await writeRedSheet(reds, fromDateIso, toDateIso);
  await writeSparklingSheet(sparkling, fromDateIso, toDateIso);
  await writeSpiritsSheet(spirits, fromDateIso, toDateIso);
  await writeParetoSheet(whites, reds, sparkling, fromDateIso, toDateIso);
  await writeOtherSheet(others, fromDateIso, toDateIso);
  await writeBeerSheet(beers, fromDateIso, toDateIso);
  console.log(`\n  → https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);
}

// ─── Sheet writers ─────────────────────────────────────────────────────────

const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
const white = { red: 1,    green: 1,    blue: 1    };

// Sheets number formats
const FMT_INT      = { type: "NUMBER",   pattern: "#,##0"            };
const FMT_BAHT     = { type: "CURRENCY", pattern: "#,##0\\ \"฿\""    }; // 1 234 ฿
const FMT_PCT      = { type: "NUMBER",   pattern: "0.0\"%\""         };

async function writeWhiteSheet(
  whites: (ItemAgg & { grape: Grape })[],
  fromDate: string,
  toDate: string,
) {
  const sheetId = await ensureTab(TAB_WHITE);
  await clearTab(sheetId);

  // Group by grape
  const byGrape = new Map<Grape, (ItemAgg & { grape: Grape })[]>();
  for (const g of GRAPE_ORDER) byGrape.set(g, []);
  for (const w of whites) byGrape.get(w.grape)!.push(w);

  const main = GRAPE_ORDER.filter(g => g !== "Прочее / Купаж");
  main.sort((a, b) => {
    const ua = byGrape.get(a)!.reduce((s, w) => s + w.units, 0);
    const ub = byGrape.get(b)!.reduce((s, w) => s + w.units, 0);
    return ub - ua;
  });
  const orderedGrapes = [...main, "Прочее / Купаж" as Grape];

  // Detail columns: №, Название, Бутылок, Розница, Закуп, Маржа %, Выручка
  const headers = ["№", "Название", "Бутылок", "Розница", "Закуп", "Маржа %", "Выручка"];
  const nCols = headers.length;
  const rows: any[][] = [];

  // Title
  rows.push([`Белые вина · разбивка по сортам · ${fromDate} → ${toDate}`]);

  // Summary table by grape: Сорт | Позиций | Бутылок | Выручка | % от штук
  rows.push([]);
  rows.push(["Сорт", "Позиций", "Бутылок", "Выручка", "% от штук"]);
  const summaryHdrRow = rows.length - 1;
  const totalUnitsAll = whites.reduce((s, w) => s + w.units, 0);
  for (const g of orderedGrapes) {
    const items = byGrape.get(g)!;
    if (items.length === 0) continue;
    const u = items.reduce((s, i) => s + i.units, 0);
    const rev = items.reduce((s, i) => s + i.revenue, 0);
    const pct = totalUnitsAll > 0 ? (u / totalUnitsAll) * 100 : 0;
    rows.push([g, items.length, u, Math.round(rev), Math.round(pct * 10) / 10]);
  }
  const summaryEndRow = rows.length;
  rows.push([]);

  // Detail header
  rows.push(headers);
  const detailHdrRow = rows.length - 1;

  interface Block { headerRow: number; dataStart: number; dataEnd: number; }
  const blocks: Block[] = [];

  for (const g of orderedGrapes) {
    const items = byGrape.get(g)!;
    if (items.length === 0) continue;
    items.sort((a, b) => b.units - a.units);
    const u = items.reduce((s, i) => s + i.units, 0);
    const rev = items.reduce((s, i) => s + i.revenue, 0);
    rows.push([`${g.toUpperCase()} · ${items.length} поз. · ${u} бут. · ${Math.round(rev).toLocaleString("ru-RU")} ฿`]);
    const headerRow = rows.length - 1;
    const dataStart = rows.length;
    items.forEach((it, idx) => {
      const retail = it.units > 0 ? Math.round(it.revenue / it.units) : 0;
      const cost   = it.units > 0 ? Math.round(it.cost    / it.units) : 0;
      const margin = it.revenue > 0 ? ((it.revenue - it.cost) / it.revenue) * 100 : 0;
      rows.push([idx + 1, it.name, it.units, retail, cost, Math.round(margin * 10) / 10, Math.round(it.revenue)]);
    });
    blocks.push({ headerRow, dataStart, dataEnd: rows.length });
    rows.push([]);
  }

  // ── Write values via updateCells (more reliable than PUT /values) ──
  await writeRows(sheetId, 0, 0, rows);

  // ── Formatting ──
  const fmtRequests: any[] = [];
  fmtRequests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
      fields: "gridProperties.frozenRowCount",
    },
  });
  // Column widths: №, Название, Бутылок, Розница, Закуп, Маржа %, Выручка
  const widths = [50, 380, 100, 120, 120, 100, 140];
  for (let i = 0; i < widths.length; i++) {
    fmtRequests.push({ updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: widths[i] }, fields: "pixelSize",
    }});
  }
  // Title
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.45, green: 0.36, blue: 0.08 }, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });
  // Summary header
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow, endRowIndex: summaryHdrRow + 1, startColumnIndex: 0, endColumnIndex: 5 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  // Summary numbers: cols 1-2 int, col 3 ฿, col 4 %
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow + 1, endRowIndex: summaryEndRow, startColumnIndex: 1, endColumnIndex: 3 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow + 1, endRowIndex: summaryEndRow, startColumnIndex: 3, endColumnIndex: 4 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow + 1, endRowIndex: summaryEndRow, startColumnIndex: 4, endColumnIndex: 5 },
      cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // Detail header
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: detailHdrRow, endRowIndex: detailHdrRow + 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // Section headers + data rows
  for (const block of blocks) {
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.headerRow, endRowIndex: block.headerRow + 1, startColumnIndex: 0, endColumnIndex: nCols },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.55, green: 0.45, blue: 0.10 }, textFormat: { bold: true, foregroundColor: white } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
    fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: block.headerRow, endRowIndex: block.headerRow + 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });
    // Бутылок (col 2): int
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 2, endColumnIndex: 3 },
        cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    });
    // Розница, Закуп (cols 3-4): ฿
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 3, endColumnIndex: 5 },
        cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    });
    // Маржа % (col 5)
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 5, endColumnIndex: 6 },
        cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    });
    // Выручка (col 6): ฿
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 6, endColumnIndex: 7 },
        cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    });
    // # column center
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER", textFormat: { foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } } } },
        fields: "userEnteredFormat(horizontalAlignment,textFormat)",
      },
    });
    // Alternating stripes
    for (let r = block.dataStart; r < block.dataEnd; r++) {
      if ((r - block.dataStart) % 2 === 0) continue;
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: nCols },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.99, green: 0.97, blue: 0.88 } } },
          fields: "userEnteredFormat.backgroundColor",
        },
      });
    }
  }
  await sheets("POST", ":batchUpdate", { requests: fmtRequests });
  console.log(`  ✓ "${TAB_WHITE}" written.`);
}

async function writeRedSheet(
  reds: (ItemAgg & { country: RedCountry; region: string })[],
  fromDate: string,
  toDate: string,
) {
  const sheetId = await ensureTab(TAB_RED);
  await clearTab(sheetId);

  // Group: country → region → items
  const byCountry = new Map<RedCountry, Map<string, (ItemAgg & { country: RedCountry; region: string })[]>>();
  for (const r of reds) {
    if (!byCountry.has(r.country)) byCountry.set(r.country, new Map());
    const inner = byCountry.get(r.country)!;
    if (!inner.has(r.region)) inner.set(r.region, []);
    inner.get(r.region)!.push(r);
  }
  // Order countries by total units desc, then "Прочее" at end
  const countries = [...byCountry.keys()];
  countries.sort((a, b) => {
    if (a === "Прочее / Не определено") return 1;
    if (b === "Прочее / Не определено") return -1;
    const orderA = RED_COUNTRY_ORDER.indexOf(a);
    const orderB = RED_COUNTRY_ORDER.indexOf(b);
    const ua = sumUnits(byCountry.get(a)!);
    const ub = sumUnits(byCountry.get(b)!);
    if (ub !== ua) return ub - ua;
    return orderA - orderB;
  });

  const totalUnitsAll = reds.reduce((s, r) => s + r.units, 0);
  // Detail columns: №, Название, Бутылок, Розница, Закуп, Маржа %, Выручка
  const headers = ["№", "Название", "Бутылок", "Розница", "Закуп", "Маржа %", "Выручка"];
  const nCols = headers.length;
  const rows: any[][] = [];

  // Title
  rows.push([`Красные вина · разбивка по странам и регионам · ${fromDate} → ${toDate}`]);
  // Summary by country: Страна | Позиций | Бутылок | Выручка | % от штук
  rows.push([]);
  rows.push(["Страна", "Позиций", "Бутылок", "Выручка", "% от штук"]);
  const summaryHdrRow = rows.length - 1;
  for (const c of countries) {
    const inner = byCountry.get(c)!;
    const items = [...inner.values()].flat();
    const u = items.reduce((s, i) => s + i.units, 0);
    const rev = items.reduce((s, i) => s + i.revenue, 0);
    const pct = totalUnitsAll > 0 ? (u / totalUnitsAll) * 100 : 0;
    rows.push([c, items.length, u, Math.round(rev), Math.round(pct * 10) / 10]);
  }
  const summaryEndRow = rows.length;
  rows.push([]);

  // Detail header
  rows.push(headers);
  const detailHdrRow = rows.length - 1;

  interface Block { kind: "country" | "region" | "data"; row: number; rowEnd?: number; }
  const blocks: Block[] = [];

  for (const c of countries) {
    const inner = byCountry.get(c)!;
    const allItems = [...inner.values()].flat();
    const cu = allItems.reduce((s, i) => s + i.units, 0);
    const cr = allItems.reduce((s, i) => s + i.revenue, 0);
    rows.push([`${c.toUpperCase()} · ${allItems.length} поз. · ${cu} бут. · ${Math.round(cr).toLocaleString("ru-RU")} ฿`]);
    blocks.push({ kind: "country", row: rows.length - 1 });

    const regions = [...inner.entries()].sort((a, b) => {
      const ua = a[1].reduce((s, i) => s + i.units, 0);
      const ub = b[1].reduce((s, i) => s + i.units, 0);
      return ub - ua;
    });
    for (const [region, items] of regions) {
      items.sort((a, b) => b.units - a.units);
      const ru = items.reduce((s, i) => s + i.units, 0);
      const rr = items.reduce((s, i) => s + i.revenue, 0);
      rows.push([`  ${region} · ${items.length} поз. · ${ru} бут. · ${Math.round(rr).toLocaleString("ru-RU")} ฿`]);
      blocks.push({ kind: "region", row: rows.length - 1 });
      const dataStart = rows.length;
      items.forEach((it, idx) => {
        const retail = it.units > 0 ? Math.round(it.revenue / it.units) : 0;
        const cost   = it.units > 0 ? Math.round(it.cost    / it.units) : 0;
        const margin = it.revenue > 0 ? ((it.revenue - it.cost) / it.revenue) * 100 : 0;
        rows.push([idx + 1, it.name, it.units, retail, cost, Math.round(margin * 10) / 10, Math.round(it.revenue)]);
      });
      blocks.push({ kind: "data", row: dataStart, rowEnd: rows.length });
    }
    rows.push([]);
  }

  await writeRows(sheetId, 0, 0, rows);

  // ── Formatting ──
  const fmtRequests: any[] = [];
  fmtRequests.push({
    updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" },
  });
  const widths = [50, 420, 100, 120, 120, 100, 140];
  for (let i = 0; i < widths.length; i++) {
    fmtRequests.push({ updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: widths[i] }, fields: "pixelSize",
    }});
  }
  // Title
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.48, green: 0.11, blue: 0.11 }, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });
  // Summary header
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow, endRowIndex: summaryHdrRow + 1, startColumnIndex: 0, endColumnIndex: 5 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow + 1, endRowIndex: summaryEndRow, startColumnIndex: 1, endColumnIndex: 3 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow + 1, endRowIndex: summaryEndRow, startColumnIndex: 3, endColumnIndex: 4 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow + 1, endRowIndex: summaryEndRow, startColumnIndex: 4, endColumnIndex: 5 },
      cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // Detail header
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: detailHdrRow, endRowIndex: detailHdrRow + 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // Section formatting
  for (const b of blocks) {
    if (b.kind === "country") {
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.row + 1, startColumnIndex: 0, endColumnIndex: nCols },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.55, green: 0.13, blue: 0.13 }, textFormat: { bold: true, fontSize: 11, foregroundColor: white } } },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      });
      fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: b.row, endRowIndex: b.row + 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });
    } else if (b.kind === "region") {
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.row + 1, startColumnIndex: 0, endColumnIndex: nCols },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.92, green: 0.84, blue: 0.84 }, textFormat: { bold: true, fontSize: 10 } } },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      });
      fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: b.row, endRowIndex: b.row + 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });
    } else if (b.kind === "data" && b.rowEnd != null) {
      // Бутылок (col 2): int
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.rowEnd, startColumnIndex: 2, endColumnIndex: 3 },
          cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
      // Розница, Закуп (cols 3-4): ฿
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.rowEnd, startColumnIndex: 3, endColumnIndex: 5 },
          cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
      // Маржа % (col 5)
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.rowEnd, startColumnIndex: 5, endColumnIndex: 6 },
          cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
      // Выручка (col 6): ฿
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.rowEnd, startColumnIndex: 6, endColumnIndex: 7 },
          cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
      // # column center
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.rowEnd, startColumnIndex: 0, endColumnIndex: 1 },
          cell: { userEnteredFormat: { horizontalAlignment: "CENTER", textFormat: { foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } } } },
          fields: "userEnteredFormat(horizontalAlignment,textFormat)",
        },
      });
      // Stripes
      for (let r = b.row; r < b.rowEnd; r++) {
        if ((r - b.row) % 2 === 0) continue;
        fmtRequests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: nCols },
            cell: { userEnteredFormat: { backgroundColor: { red: 0.98, green: 0.93, blue: 0.93 } } },
            fields: "userEnteredFormat.backgroundColor",
          },
        });
      }
    }
  }
  await sheets("POST", ":batchUpdate", { requests: fmtRequests });
  console.log(`  ✓ "${TAB_RED}" written.`);
}

async function writeSparklingSheet(items: ItemAgg[], fromDate: string, toDate: string) {
  const sheetId = await ensureTab(TAB_SPARKLING);
  await clearTab(sheetId);

  // Sort by units desc
  items.sort((a, b) => b.units - a.units);

  const headers = ["№", "Название", "Бутылок", "Розница", "Закуп", "Маржа %", "Выручка"];
  const nCols = headers.length;
  const rows: any[][] = [];

  // Title
  const totalUnits = items.reduce((s, i) => s + i.units, 0);
  const totalRev   = items.reduce((s, i) => s + i.revenue, 0);
  rows.push([`Игристые вина · ${fromDate} → ${toDate} · ${items.length} поз. · ${totalUnits} бут. · ${Math.round(totalRev).toLocaleString("ru-RU")} ฿`]);
  rows.push([]);
  rows.push(headers);
  const hdrRow = rows.length - 1;
  const dataStart = rows.length;
  items.forEach((it, idx) => {
    const retail = it.units > 0 ? Math.round(it.revenue / it.units) : 0;
    const cost   = it.units > 0 ? Math.round(it.cost    / it.units) : 0;
    const margin = it.revenue > 0 ? ((it.revenue - it.cost) / it.revenue) * 100 : 0;
    rows.push([idx + 1, it.name, it.units, retail, cost, Math.round(margin * 10) / 10, Math.round(it.revenue)]);
  });
  const dataEnd = rows.length;

  await writeRows(sheetId, 0, 0, rows);

  // ── Formatting ──
  const fmtRequests: any[] = [];
  fmtRequests.push({
    updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 3 } }, fields: "gridProperties.frozenRowCount" },
  });
  const widths = [50, 420, 100, 120, 120, 100, 140];
  for (let i = 0; i < widths.length; i++) {
    fmtRequests.push({ updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: widths[i] }, fields: "pixelSize",
    }});
  }
  // Title (sparkling = blue/champagne theme)
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.15, green: 0.35, blue: 0.55 }, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });
  // Header row
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: hdrRow, endRowIndex: hdrRow + 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // Data formats
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 3, endColumnIndex: 5 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 5, endColumnIndex: 6 },
      cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 6, endColumnIndex: 7 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // # column center
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { horizontalAlignment: "CENTER", textFormat: { foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } } } },
      fields: "userEnteredFormat(horizontalAlignment,textFormat)",
    },
  });
  // Stripes
  for (let r = dataStart; r < dataEnd; r++) {
    if ((r - dataStart) % 2 === 0) continue;
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: nCols },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.92, green: 0.95, blue: 0.99 } } },
        fields: "userEnteredFormat.backgroundColor",
      },
    });
  }
  await sheets("POST", ":batchUpdate", { requests: fmtRequests });
  console.log(`  ✓ "${TAB_SPARKLING}" written.`);
}

async function writeBeerSheet(items: ItemAgg[], fromDate: string, toDate: string) {
  const sheetId = await ensureTab(TAB_BEER);
  await clearTab(sheetId);

  items.sort((a, b) => b.units - a.units);

  const headers = ["№", "Название", "Шт.", "Розница", "Закуп", "Маржа %", "Выручка"];
  const nCols = headers.length;
  const rows: any[][] = [];

  const totalUnits = items.reduce((s, i) => s + i.units, 0);
  const totalRev   = items.reduce((s, i) => s + i.revenue, 0);
  rows.push([`Пиво · ${fromDate} → ${toDate} · ${items.length} поз. · ${Math.round(totalUnits)} шт. · ${Math.round(totalRev).toLocaleString("ru-RU")} ฿`]);
  rows.push([]);
  rows.push(headers);
  const hdrRow = rows.length - 1;
  const dataStart = rows.length;
  items.forEach((it, idx) => {
    const retail = it.units > 0 ? Math.round(it.revenue / it.units) : 0;
    const cost   = it.units > 0 ? Math.round(it.cost    / it.units) : 0;
    const margin = it.revenue > 0 ? ((it.revenue - it.cost) / it.revenue) * 100 : 0;
    rows.push([idx + 1, it.name, it.units, retail, cost, Math.round(margin * 10) / 10, Math.round(it.revenue)]);
  });
  const dataEnd = rows.length;

  await writeRows(sheetId, 0, 0, rows);

  // ── Formatting (amber/beer theme) ──
  const fmtRequests: any[] = [];
  fmtRequests.push({
    updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 3 } }, fields: "gridProperties.frozenRowCount" },
  });
  const widths = [50, 420, 100, 120, 120, 100, 140];
  for (let i = 0; i < widths.length; i++) {
    fmtRequests.push({ updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: widths[i] }, fields: "pixelSize",
    }});
  }
  // Title
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.65, green: 0.40, blue: 0.10 }, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });
  // Header row
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: hdrRow, endRowIndex: hdrRow + 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // Data formats
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 3, endColumnIndex: 5 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 5, endColumnIndex: 6 },
      cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 6, endColumnIndex: 7 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // # column center
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { horizontalAlignment: "CENTER", textFormat: { foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } } } },
      fields: "userEnteredFormat(horizontalAlignment,textFormat)",
    },
  });
  // Stripes
  for (let r = dataStart; r < dataEnd; r++) {
    if ((r - dataStart) % 2 === 0) continue;
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: nCols },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.99, green: 0.95, blue: 0.85 } } },
        fields: "userEnteredFormat.backgroundColor",
      },
    });
  }
  // Highlight negative-margin rows in red
  items.forEach((it, idx) => {
    const margin = it.revenue > 0 ? ((it.revenue - it.cost) / it.revenue) * 100 : 0;
    if (margin >= 0) return;
    const r = dataStart + idx;
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 5, endColumnIndex: 6 },
        cell: { userEnteredFormat: { backgroundColor: { red: 1.0, green: 0.85, blue: 0.85 }, textFormat: { bold: true, foregroundColor: { red: 0.7, green: 0.05, blue: 0.05 } } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
  });
  await sheets("POST", ":batchUpdate", { requests: fmtRequests });
  console.log(`  ✓ "${TAB_BEER}" written.`);
}

async function writeSpiritsSheet(
  items: (ItemAgg & { type: string })[],
  fromDate: string,
  toDate: string,
) {
  const sheetId = await ensureTab(TAB_SPIRITS);
  await clearTab(sheetId);

  // Group by type
  const byType = new Map<string, (ItemAgg & { type: string })[]>();
  for (const it of items) {
    if (!byType.has(it.type)) byType.set(it.type, []);
    byType.get(it.type)!.push(it);
  }
  // Sort types by total units desc
  const types = [...byType.keys()].sort((a, b) => {
    const ua = byType.get(a)!.reduce((s, i) => s + i.units, 0);
    const ub = byType.get(b)!.reduce((s, i) => s + i.units, 0);
    return ub - ua;
  });

  const totalUnitsAll = items.reduce((s, i) => s + i.units, 0);
  const headers = ["№", "Название", "Бутылок", "Розница", "Закуп", "Маржа %", "Выручка"];
  const nCols = headers.length;
  const rows: any[][] = [];

  // Title
  rows.push([`Крепкие напитки · разбивка по типу · ${fromDate} → ${toDate}`]);
  // Summary
  rows.push([]);
  rows.push(["Тип", "Позиций", "Бутылок", "Выручка", "% от штук"]);
  const summaryHdrRow = rows.length - 1;
  for (const t of types) {
    const arr = byType.get(t)!;
    const u = arr.reduce((s, i) => s + i.units, 0);
    const rev = arr.reduce((s, i) => s + i.revenue, 0);
    const pct = totalUnitsAll > 0 ? (u / totalUnitsAll) * 100 : 0;
    rows.push([t, arr.length, u, Math.round(rev), Math.round(pct * 10) / 10]);
  }
  const summaryEndRow = rows.length;
  rows.push([]);

  // Detail header
  rows.push(headers);
  const detailHdrRow = rows.length - 1;

  interface Block { headerRow: number; dataStart: number; dataEnd: number; }
  const blocks: Block[] = [];

  for (const t of types) {
    const arr = byType.get(t)!;
    arr.sort((a, b) => b.units - a.units);
    const u = arr.reduce((s, i) => s + i.units, 0);
    const rev = arr.reduce((s, i) => s + i.revenue, 0);
    rows.push([`${t.toUpperCase()} · ${arr.length} поз. · ${u} бут. · ${Math.round(rev).toLocaleString("ru-RU")} ฿`]);
    const headerRow = rows.length - 1;
    const dataStart = rows.length;
    arr.forEach((it, idx) => {
      const retail = it.units > 0 ? Math.round(it.revenue / it.units) : 0;
      const cost   = it.units > 0 ? Math.round(it.cost    / it.units) : 0;
      const margin = it.revenue > 0 ? ((it.revenue - it.cost) / it.revenue) * 100 : 0;
      rows.push([idx + 1, it.name, it.units, retail, cost, Math.round(margin * 10) / 10, Math.round(it.revenue)]);
    });
    blocks.push({ headerRow, dataStart, dataEnd: rows.length });
    rows.push([]);
  }

  await writeRows(sheetId, 0, 0, rows);

  // ── Formatting (amber/whisky theme) ──
  const fmtRequests: any[] = [];
  fmtRequests.push({
    updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" },
  });
  const widths = [50, 420, 100, 120, 120, 100, 140];
  for (let i = 0; i < widths.length; i++) {
    fmtRequests.push({ updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: widths[i] }, fields: "pixelSize",
    }});
  }
  // Title
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.45, green: 0.25, blue: 0.10 }, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });
  // Summary header
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow, endRowIndex: summaryHdrRow + 1, startColumnIndex: 0, endColumnIndex: 5 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow + 1, endRowIndex: summaryEndRow, startColumnIndex: 1, endColumnIndex: 3 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow + 1, endRowIndex: summaryEndRow, startColumnIndex: 3, endColumnIndex: 4 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow + 1, endRowIndex: summaryEndRow, startColumnIndex: 4, endColumnIndex: 5 },
      cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // Detail header
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: detailHdrRow, endRowIndex: detailHdrRow + 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // Section blocks
  for (const block of blocks) {
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.headerRow, endRowIndex: block.headerRow + 1, startColumnIndex: 0, endColumnIndex: nCols },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.55, green: 0.32, blue: 0.12 }, textFormat: { bold: true, fontSize: 11, foregroundColor: white } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
    fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: block.headerRow, endRowIndex: block.headerRow + 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });
    // Бутылок (col 2)
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 2, endColumnIndex: 3 },
        cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    });
    // Розница, Закуп
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 3, endColumnIndex: 5 },
        cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    });
    // Маржа %
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 5, endColumnIndex: 6 },
        cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    });
    // Выручка
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 6, endColumnIndex: 7 },
        cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    });
    // # column
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER", textFormat: { foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } } } },
        fields: "userEnteredFormat(horizontalAlignment,textFormat)",
      },
    });
    // Stripes
    for (let r = block.dataStart; r < block.dataEnd; r++) {
      if ((r - block.dataStart) % 2 === 0) continue;
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: nCols },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.99, green: 0.95, blue: 0.85 } } },
          fields: "userEnteredFormat.backgroundColor",
        },
      });
    }
  }
  await sheets("POST", ":batchUpdate", { requests: fmtRequests });
  console.log(`  ✓ "${TAB_SPIRITS}" written.`);
}

async function writeParetoSheet(
  whites: ItemAgg[],
  reds: ItemAgg[],
  sparkling: ItemAgg[],
  fromDate: string,
  toDate: string,
) {
  const sheetId = await ensureTab(TAB_PARETO);
  await clearTab(sheetId);

  // Three sections: red / white / sparkling. Each section: split by Pareto threshold (cumulative 80% of bottles).
  const sections: Array<{ title: string; items: ItemAgg[]; color: { red: number; green: number; blue: number } }> = [
    { title: "КРАСНЫЕ ВИНА",  items: reds,      color: { red: 0.55, green: 0.13, blue: 0.13 } },
    { title: "БЕЛЫЕ ВИНА",    items: whites,    color: { red: 0.55, green: 0.45, blue: 0.10 } },
    { title: "ИГРИСТЫЕ ВИНА", items: sparkling, color: { red: 0.15, green: 0.35, blue: 0.55 } },
  ];

  const headers = ["Группа", "Позиций", "Бутылок", "% бут.", "Выручка", "Закуп", "Прибыль", "% прибыли", "Маржа %"];
  const nCols = headers.length;
  const rows: any[][] = [];

  rows.push([`Парето · Массовые vs Единичные · порог ${Math.round(PARETO_THRESHOLD * 100)}% бутылок · ${fromDate} → ${toDate}`]);

  interface Block { kind: "section" | "header" | "data" | "total"; row: number; rowEnd?: number; color?: any; }
  const blocks: Block[] = [];

  for (const section of sections) {
    if (section.items.length === 0) continue;
    rows.push([]);

    // Sort by units desc, walk cumulative until > threshold
    const sorted = [...section.items].sort((a, b) => b.units - a.units);
    const totalUnits   = sorted.reduce((s, i) => s + i.units, 0);
    const totalRev     = sorted.reduce((s, i) => s + i.revenue, 0);
    const totalCost    = sorted.reduce((s, i) => s + i.cost, 0);
    const totalProfit  = totalRev - totalCost;

    const mass: ItemAgg[] = [];
    const tail: ItemAgg[] = [];
    let cum = 0;
    for (const it of sorted) {
      const before = cum;
      cum += it.units;
      // Item is "mass" if its inclusion brings us up to the threshold;
      // once cumulative share AFTER inclusion exceeds threshold, switch to tail.
      if (before / totalUnits < PARETO_THRESHOLD) mass.push(it);
      else tail.push(it);
    }

    function summarize(arr: ItemAgg[]) {
      const u    = arr.reduce((s, i) => s + i.units, 0);
      const rev  = arr.reduce((s, i) => s + i.revenue, 0);
      const cost = arr.reduce((s, i) => s + i.cost, 0);
      const profit = rev - cost;
      return {
        n: arr.length,
        units: u,
        revenue: rev,
        cost,
        profit,
        unitsPct: totalUnits > 0 ? (u / totalUnits) * 100 : 0,
        profitPct: totalProfit !== 0 ? (profit / totalProfit) * 100 : 0,
        marginPct: rev > 0 ? (profit / rev) * 100 : 0,
      };
    }
    const m = summarize(mass);
    const t = summarize(tail);
    const all = summarize(sorted);

    // Section title
    rows.push([`${section.title} · ${all.n} поз. · ${all.units} бут. · выручка ${Math.round(all.revenue).toLocaleString("ru-RU")} ฿ · прибыль ${Math.round(all.profit).toLocaleString("ru-RU")} ฿`]);
    blocks.push({ kind: "section", row: rows.length - 1, color: section.color });

    rows.push(headers);
    blocks.push({ kind: "header", row: rows.length - 1 });

    const dataStart = rows.length;
    rows.push([
      `Массовые (топ ${m.n} поз. = ${Math.round(m.unitsPct)}% бут.)`,
      m.n, m.units, Math.round(m.unitsPct * 10) / 10,
      Math.round(m.revenue), Math.round(m.cost), Math.round(m.profit),
      Math.round(m.profitPct * 10) / 10, Math.round(m.marginPct * 10) / 10,
    ]);
    rows.push([
      `Единичные (хвост ${t.n} поз. = ${Math.round(t.unitsPct)}% бут.)`,
      t.n, t.units, Math.round(t.unitsPct * 10) / 10,
      Math.round(t.revenue), Math.round(t.cost), Math.round(t.profit),
      Math.round(t.profitPct * 10) / 10, Math.round(t.marginPct * 10) / 10,
    ]);
    blocks.push({ kind: "data", row: dataStart, rowEnd: rows.length });
    rows.push([
      "ИТОГО",
      all.n, all.units, 100,
      Math.round(all.revenue), Math.round(all.cost), Math.round(all.profit),
      100, Math.round(all.marginPct * 10) / 10,
    ]);
    blocks.push({ kind: "total", row: rows.length - 1 });
  }

  await writeRows(sheetId, 0, 0, rows);

  // ── Formatting ──
  const fmtRequests: any[] = [];
  fmtRequests.push({
    updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" },
  });
  // Column widths: Группа, Позиций, Бутылок, % бут., Выручка, Закуп, Прибыль, % прибыли, Маржа %
  const widths = [320, 90, 100, 90, 140, 140, 140, 110, 110];
  for (let i = 0; i < widths.length; i++) {
    fmtRequests.push({ updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: widths[i] }, fields: "pixelSize",
    }});
  }
  // Title
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.15, green: 0.15, blue: 0.15 }, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });

  for (const b of blocks) {
    if (b.kind === "section") {
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.row + 1, startColumnIndex: 0, endColumnIndex: nCols },
          cell: { userEnteredFormat: { backgroundColor: b.color, textFormat: { bold: true, fontSize: 11, foregroundColor: white } } },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      });
      fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: b.row, endRowIndex: b.row + 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });
    } else if (b.kind === "header") {
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.row + 1, startColumnIndex: 0, endColumnIndex: nCols },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
        },
      });
    } else if (b.kind === "data" && b.rowEnd != null) {
      // Позиций, Бутылок (cols 1-2): int
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.rowEnd, startColumnIndex: 1, endColumnIndex: 3 },
          cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
      // % бут. (col 3)
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.rowEnd, startColumnIndex: 3, endColumnIndex: 4 },
          cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
      // Выручка, Закуп, Прибыль (cols 4-6): ฿
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.rowEnd, startColumnIndex: 4, endColumnIndex: 7 },
          cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
      // % прибыли, Маржа % (cols 7-8)
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.rowEnd, startColumnIndex: 7, endColumnIndex: 9 },
          cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
      // Highlight row 0 (mass) green-ish, row 1 (tail) gray
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.row + 1, startColumnIndex: 0, endColumnIndex: nCols },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.88, green: 0.96, blue: 0.88 } } },
          fields: "userEnteredFormat.backgroundColor",
        },
      });
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row + 1, endRowIndex: b.row + 2, startColumnIndex: 0, endColumnIndex: nCols },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.97, green: 0.97, blue: 0.97 } } },
          fields: "userEnteredFormat.backgroundColor",
        },
      });
    } else if (b.kind === "total") {
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.row + 1, startColumnIndex: 0, endColumnIndex: nCols },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true } } },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      });
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.row + 1, startColumnIndex: 1, endColumnIndex: 3 },
          cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.row + 1, startColumnIndex: 3, endColumnIndex: 4 },
          cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.row + 1, startColumnIndex: 4, endColumnIndex: 7 },
          cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: b.row, endRowIndex: b.row + 1, startColumnIndex: 7, endColumnIndex: 9 },
          cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      });
    }
  }
  await sheets("POST", ":batchUpdate", { requests: fmtRequests });
  console.log(`  ✓ "${TAB_PARETO}" written.`);
}

async function writeOtherSheet(
  items: (ItemAgg & { category: string })[],
  fromDate: string,
  toDate: string,
) {
  const sheetId = await ensureTab(TAB_OTHER);
  await clearTab(sheetId);

  // Group by category
  const byCat = new Map<string, (ItemAgg & { category: string })[]>();
  for (const it of items) {
    if (!byCat.has(it.category)) byCat.set(it.category, []);
    byCat.get(it.category)!.push(it);
  }
  const cats = [...byCat.keys()].sort((a, b) => {
    const ua = byCat.get(a)!.reduce((s, i) => s + i.units, 0);
    const ub = byCat.get(b)!.reduce((s, i) => s + i.units, 0);
    return ub - ua;
  });

  const totalUnitsAll = items.reduce((s, i) => s + i.units, 0);
  const headers = ["№", "Название", "Шт.", "Розница", "Закуп", "Маржа %", "Выручка"];
  const nCols = headers.length;
  const rows: any[][] = [];

  // Title
  rows.push([`Прочее (закуски, аксессуары, прочее) · ${fromDate} → ${toDate}`]);
  // Summary
  rows.push([]);
  rows.push(["Категория", "Позиций", "Шт.", "Выручка", "% от шт."]);
  const summaryHdrRow = rows.length - 1;
  for (const c of cats) {
    const arr = byCat.get(c)!;
    const u = arr.reduce((s, i) => s + i.units, 0);
    const rev = arr.reduce((s, i) => s + i.revenue, 0);
    const pct = totalUnitsAll > 0 ? (u / totalUnitsAll) * 100 : 0;
    rows.push([c, arr.length, u, Math.round(rev), Math.round(pct * 10) / 10]);
  }
  const summaryEndRow = rows.length;
  rows.push([]);

  // Detail header
  rows.push(headers);
  const detailHdrRow = rows.length - 1;

  interface Block { headerRow: number; dataStart: number; dataEnd: number; }
  const blocks: Block[] = [];

  for (const c of cats) {
    const arr = byCat.get(c)!;
    arr.sort((a, b) => b.units - a.units);
    const u = arr.reduce((s, i) => s + i.units, 0);
    const rev = arr.reduce((s, i) => s + i.revenue, 0);
    rows.push([`${c.toUpperCase()} · ${arr.length} поз. · ${u} шт. · ${Math.round(rev).toLocaleString("ru-RU")} ฿`]);
    const headerRow = rows.length - 1;
    const dataStart = rows.length;
    arr.forEach((it, idx) => {
      const retail = it.units > 0 ? Math.round(it.revenue / it.units) : 0;
      const cost   = it.units > 0 ? Math.round(it.cost    / it.units) : 0;
      const margin = it.revenue > 0 ? ((it.revenue - it.cost) / it.revenue) * 100 : 0;
      rows.push([idx + 1, it.name, it.units, retail, cost, Math.round(margin * 10) / 10, Math.round(it.revenue)]);
    });
    blocks.push({ headerRow, dataStart, dataEnd: rows.length });
    rows.push([]);
  }

  await writeRows(sheetId, 0, 0, rows);

  // ── Formatting (green/forest theme for snacks) ──
  const fmtRequests: any[] = [];
  fmtRequests.push({
    updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" },
  });
  const widths = [50, 460, 80, 120, 120, 100, 140];
  for (let i = 0; i < widths.length; i++) {
    fmtRequests.push({ updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: widths[i] }, fields: "pixelSize",
    }});
  }
  // Title
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.40, blue: 0.20 }, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });
  // Summary header
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow, endRowIndex: summaryHdrRow + 1, startColumnIndex: 0, endColumnIndex: 5 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow + 1, endRowIndex: summaryEndRow, startColumnIndex: 1, endColumnIndex: 3 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow + 1, endRowIndex: summaryEndRow, startColumnIndex: 3, endColumnIndex: 4 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: summaryHdrRow + 1, endRowIndex: summaryEndRow, startColumnIndex: 4, endColumnIndex: 5 },
      cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // Detail header
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: detailHdrRow, endRowIndex: detailHdrRow + 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // Section blocks
  for (const block of blocks) {
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.headerRow, endRowIndex: block.headerRow + 1, startColumnIndex: 0, endColumnIndex: nCols },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.30, green: 0.50, blue: 0.30 }, textFormat: { bold: true, fontSize: 11, foregroundColor: white } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
    fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: block.headerRow, endRowIndex: block.headerRow + 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });
    // Шт. (col 2): int
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 2, endColumnIndex: 3 },
        cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    });
    // Розница, Закуп
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 3, endColumnIndex: 5 },
        cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    });
    // Маржа %
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 5, endColumnIndex: 6 },
        cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    });
    // Выручка
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 6, endColumnIndex: 7 },
        cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
      },
    });
    // # column center
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: block.dataStart, endRowIndex: block.dataEnd, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER", textFormat: { foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } } } },
        fields: "userEnteredFormat(horizontalAlignment,textFormat)",
      },
    });
    // Stripes
    for (let r = block.dataStart; r < block.dataEnd; r++) {
      if ((r - block.dataStart) % 2 === 0) continue;
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: nCols },
          cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.97, blue: 0.93 } } },
          fields: "userEnteredFormat.backgroundColor",
        },
      });
    }
  }
  await sheets("POST", ":batchUpdate", { requests: fmtRequests });
  console.log(`  ✓ "${TAB_OTHER}" written.`);
}

function sumUnits(inner: Map<string, (ItemAgg & any)[]>): number {
  let s = 0;
  for (const arr of inner.values()) for (const i of arr) s += i.units;
  return s;
}

main().catch(e => { console.error(e); process.exit(1); });
