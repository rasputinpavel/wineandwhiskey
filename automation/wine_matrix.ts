/**
 * wine_matrix.ts
 * Builds wine assortment matrix from Loyverse sales data.
 * ABC classification uses weighted score: revenue 35% + frequency 35% + GP% 30%
 * Premium items (avg price ≥ PREMIUM_THRESHOLD) are separated from ABC scoring.
 *
 * Usage:
 *   npx tsx scripts/wine_matrix.ts                        # last 365 days
 *   npx tsx scripts/wine_matrix.ts 2025-04-01 2026-04-17  # custom range
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SHEET_ID             = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const MATRIX_TAB           = "Матрица";
const STOCK_TAB            = "Склад-C";
const PREMIUM_THRESHOLD    = 3000; // THB avg price per bottle → premium segment
const MIN_UNITS_FOR_AB     = 4;    // min bottles sold per year to be eligible for A or B
const LOYVERSE_TOKEN       = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

// ─── Google Sheets ─────────────────────────────────────────────────────────

let _token: string | null = null;
async function gToken() {
  if (_token) return _token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" }),
  });
  if (!r.ok) throw new Error(`OAuth2: ${await r.text()}`);
  _token = (await r.json()).access_token;
  return _token!;
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

async function writeValues(tab: string, range: string, values: any[][]) {
  await sheets("PUT", `/values/${encodeURIComponent(`${tab}!${range}`)}?valueInputOption=RAW`, {
    range: `${tab}!${range}`, majorDimension: "ROWS", values,
  });
}

// ─── Loyverse ──────────────────────────────────────────────────────────────

async function loyverseFetch<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const url = `https://api.loyverse.com/v1.0${path}${path.includes("?") ? "&" : "?"}limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);
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

// ─── Wine color detection ──────────────────────────────────────────────────

type WineColor = "Красное" | "Белое" | "Игристое" | "Розовое" | "Натуральное" | "Оранжевое" | "Петнат" | "Крепленое";

const WINE_COLOR_ORDER: WineColor[] = ["Красное", "Белое", "Розовое", "Игристое", "Петнат", "Оранжевое", "Натуральное", "Крепленое"];

function detectWineColor(categoryName: string): WineColor | null {
  const n = categoryName.toLowerCase();
  if (/красн|red.?wine|rouge|tinto/.test(n))                                      return "Красное";
  if (/бел|white.?wine|blanc|blanco/.test(n))                                     return "Белое";
  if (/игрист|шампан|sparkling|prosecco|cava|cr[eé]mant|sekt/.test(n))            return "Игристое";
  if (/ros[eéè]|розов/.test(n))                                                   return "Розовое";
  if (/pét.?nat|pet.?nat|петнат/.test(n))                                         return "Петнат";
  if (/orange.?wine|оранж/.test(n))                                               return "Оранжевое";
  if (/natural.?wine|натурал/.test(n))                                            return "Натуральное";
  if (/fortif|sherry|херес|портв|madeira|мадер|марсал|marsala|port/.test(n))      return "Крепленое";
  return null;
}

// ─── Types ─────────────────────────────────────────────────────────────────

type AbcClass = "A" | "B" | "C" | "P"; // P = premium

interface WineItem {
  name: string;
  color: WineColor;
  revenue: number;
  units: number;
  gp: number;
  gpPct: number;
  checks: number;
  avgPrice: number;
  stock: number;
  supplier: string;
  abc: AbcClass;
  score?: number; // combined weighted score (standard items only)
}

// ─── ABC classification with weighted score ────────────────────────────────
// Weights: frequency (units sold) 50%, GP% 30%, revenue 20%
// Each metric normalised to [0,1] within the group before weighting.
// Boundaries by share of positions: A = top 20%, B = next 30%, C = bottom 50%.
// Hard rule: items with units < MIN_UNITS_FOR_AB are always C.

function abcClassify(items: Omit<WineItem, "abc" | "score">[]): WineItem[] {
  if (items.length === 0) return [];

  const maxRev   = Math.max(...items.map(i => i.revenue));
  const maxUnits = Math.max(...items.map(i => i.units));
  const maxGP    = Math.max(...items.map(i => i.gpPct));

  const scored = items.map(item => ({
    ...item,
    score:
      (maxRev   > 0 ? item.revenue / maxRev   : 0) * 0.20 +
      (maxUnits > 0 ? item.units   / maxUnits  : 0) * 0.50 +
      (maxGP    > 0 ? item.gpPct   / maxGP     : 0) * 0.30,
  }));

  const sorted   = [...scored].sort((a, b) => b.score - a.score);
  const eligible = sorted.filter(i => i.units >= MIN_UNITS_FOR_AB).length;
  const cutA     = Math.ceil(eligible * 0.20);
  const cutB     = Math.ceil(eligible * 0.50);

  let eligibleSeen = 0;
  return sorted.map(item => {
    if (item.units < MIN_UNITS_FOR_AB) return { ...item, abc: "C" as AbcClass };
    eligibleSeen++;
    const abc: AbcClass = eligibleSeen <= cutA ? "A" : eligibleSeen <= cutB ? "B" : "C";
    return { ...item, abc };
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const bangkokNow = new Date(Date.now() + 7 * 3600_000);
  const toDate   = process.argv[3] ?? bangkokNow.toISOString().slice(0, 10);
  const fromDate = process.argv[2] ?? new Date(bangkokNow.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);

  console.log(`\nWine Matrix Builder`);
  console.log(`Period: ${fromDate} → ${toDate}`);
  console.log(`Premium threshold: ≥ ${PREMIUM_THRESHOLD.toLocaleString()} ฿\n`);

  // 1. Fetch categories
  console.log("[1/4] Fetching categories...");
  const categories: any[] = await loyverseFetch("/categories", "categories");
  const catMap  = new Map<string, string>(); // id → name
  const wineCats = new Map<string, WineColor>(); // id → color
  for (const c of categories) {
    catMap.set(c.id, c.name);
    const color = detectWineColor(c.name);
    if (color) wineCats.set(c.id, color);
  }
  console.log(`  ${categories.length} total, ${wineCats.size} wine categories:`);
  for (const [id, color] of wineCats) console.log(`    [${color}] ${catMap.get(id)}`);
  if (wineCats.size === 0) { console.error("\n  No wine categories found."); process.exit(1); }

  // 2. Fetch items, inventory, and suppliers in parallel
  console.log("\n[2/4] Fetching items + inventory + suppliers...");
  const [items, invLevels, suppliers] = await Promise.all([
    loyverseFetch<any>("/items", "items"),
    loyverseFetch<any>("/inventory", "inventory_levels"),
    loyverseFetch<any>("/suppliers", "suppliers"),
  ]);

  const supplierName = new Map<string, string>(); // supplier_id → name
  for (const s of suppliers) supplierName.set(s.id, s.name ?? s.supplier_name ?? "—");

  const itemCat      = new Map<string, string>(); // item_id → category_id
  const itemSupplier = new Map<string, string>(); // item_id → supplier name
  const variantItem  = new Map<string, string>(); // variant_id → item_id
  for (const item of items) {
    if (item.category_id) itemCat.set(item.id, item.category_id);
    if (item.primary_supplier_id) {
      itemSupplier.set(item.id, supplierName.get(item.primary_supplier_id) ?? "—");
    }
    for (const v of item.variants ?? []) variantItem.set(v.variant_id, item.id);
  }

  const itemStock = new Map<string, number>(); // item_id → total in_stock
  for (const lvl of invLevels) {
    const itemId = variantItem.get(lvl.variant_id);
    if (!itemId) continue;
    itemStock.set(itemId, (itemStock.get(itemId) ?? 0) + (lvl.in_stock ?? 0));
  }
  console.log(`  ${items.length} items · ${invLevels.length} inventory levels · ${suppliers.length} suppliers loaded.`);

  // 3. Fetch receipts and aggregate by item
  console.log(`\n[3/4] Fetching receipts ${fromDate} → ${toDate}...`);
  const receipts: any[] = await loyverseFetch(
    `/receipts?receipt_type=SALE&created_at_min=${new Date(fromDate).toISOString()}&created_at_max=${new Date(toDate + "T23:59:59").toISOString()}`,
    "receipts"
  );
  console.log(`  ${receipts.length} receipts fetched.`);

  interface Acc { name: string; revenue: number; units: number; gp: number; checks: number; }
  const acc = new Map<string, Acc>();
  for (const r of receipts) {
    for (const li of r.line_items ?? []) {
      const id = li.item_id as string;
      if (!id) continue;
      const cur = acc.get(id) ?? { name: li.item_name ?? id, revenue: 0, units: 0, gp: 0, checks: 0 };
      const rev  = li.total_money ?? 0;
      const cost = li.cost_total  ?? 0;
      cur.revenue += rev;
      cur.units   += li.quantity ?? 0;
      cur.gp      += rev - cost;
      cur.checks  += 1;
      acc.set(id, cur);
    }
  }

  // 4. Split by color, then by premium / standard
  console.log(`\n[4/4] Building matrix...`);

  // standard → ABC classify; premium → sort by revenue only
  const standard = new Map<WineColor, Omit<WineItem, "abc"|"score">[]>();
  const premium  = new Map<WineColor, Omit<WineItem, "abc"|"score">[]>();
  for (const c of WINE_COLOR_ORDER) {
    standard.set(c, []); premium.set(c, []);
  }

  let totalWine = 0;
  for (const [itemId, data] of acc) {
    const catId = itemCat.get(itemId);
    if (!catId) continue;
    const color = wineCats.get(catId);
    if (!color) continue;
    const avgPrice = data.units > 0 ? data.revenue / data.units : 0;
    const gpPct    = data.revenue > 0 ? (data.gp / data.revenue) * 100 : 0;
    const stock    = itemStock.get(itemId) ?? 0;
    const supplier = itemSupplier.get(itemId) ?? "—";
    const entry    = { name: data.name, color, revenue: data.revenue, units: data.units,
                       gp: data.gp, gpPct, checks: data.checks, avgPrice, stock, supplier };
    if (avgPrice >= PREMIUM_THRESHOLD) premium.get(color)!.push(entry);
    else                               standard.get(color)!.push(entry);
    totalWine++;
  }

  const classified = new Map<WineColor, { std: WineItem[]; prem: WineItem[] }>();
  for (const color of WINE_COLOR_ORDER) {
    const abcOrder: Record<AbcClass, number> = { A: 0, B: 1, C: 2, P: 3 };
    const std  = abcClassify(standard.get(color)!)
      .sort((a, b) => abcOrder[a.abc] - abcOrder[b.abc] || (b.score ?? 0) - (a.score ?? 0));
    const prem = premium.get(color)!
      .sort((a, b) => b.revenue - a.revenue)
      .map(i => ({ ...i, abc: "P" as AbcClass }));
    classified.set(color, { std, prem });
  }

  // Summary
  console.log(`  ${totalWine} wine items total.\n`);
  for (const color of WINE_COLOR_ORDER) {
    const { std, prem } = classified.get(color)!;
    const A = std.filter(i => i.abc === "A").length;
    const B = std.filter(i => i.abc === "B").length;
    const C = std.filter(i => i.abc === "C").length;
    const revStd  = Math.round(std.reduce((s, i)  => s + i.revenue, 0));
    const revPrem = Math.round(prem.reduce((s, i) => s + i.revenue, 0));
    console.log(`  ${color}: ${std.length} стандарт (A:${A} B:${B} C:${C}) · ${revStd.toLocaleString()} ฿`);
    if (prem.length) console.log(`  ${color}: ${prem.length} премиум · ${revPrem.toLocaleString()} ฿`);
  }

  // ── Write to Sheets ──────────────────────────────────────────────────────
  console.log(`\nWriting to Google Sheets...`);
  const sheetId = await ensureTab(MATRIX_TAB);
  await clearTab(sheetId);

  const colHeaders = ["#", "Название", "Класс", "Скор", "Выручка, ฿", "Штук", "Чеков", "GP, ฿", "GP%", "Ср. цена, ฿", "Остаток", "Поставщик"];
  const nCols = colHeaders.length;

  // ── Colour palette ──
  const dark      = { red: 0.15, green: 0.15, blue: 0.15 };
  const white     = { red: 1,    green: 1,    blue: 1    };

  const colorTheme: Record<WineColor, { header: any; headerFg: any; stripe: any; premHeader: any }> = {
    "Красное":    { header: { red: 0.48, green: 0.11, blue: 0.11 }, headerFg: white,
                    stripe: { red: 0.98, green: 0.93, blue: 0.93 }, premHeader: { red: 0.30, green: 0.07, blue: 0.07 } },
    "Белое":      { header: { red: 0.45, green: 0.36, blue: 0.08 }, headerFg: white,
                    stripe: { red: 0.99, green: 0.97, blue: 0.88 }, premHeader: { red: 0.30, green: 0.24, blue: 0.05 } },
    "Игристое":   { header: { red: 0.15, green: 0.35, blue: 0.55 }, headerFg: white,
                    stripe: { red: 0.88, green: 0.93, blue: 0.98 }, premHeader: { red: 0.09, green: 0.22, blue: 0.38 } },
    "Розовое":    { header: { red: 0.72, green: 0.28, blue: 0.42 }, headerFg: white,
                    stripe: { red: 0.99, green: 0.91, blue: 0.95 }, premHeader: { red: 0.50, green: 0.15, blue: 0.28 } },
    "Оранжевое":  { header: { red: 0.72, green: 0.42, blue: 0.10 }, headerFg: white,
                    stripe: { red: 0.99, green: 0.94, blue: 0.85 }, premHeader: { red: 0.50, green: 0.28, blue: 0.05 } },
    "Натуральное":{ header: { red: 0.22, green: 0.45, blue: 0.22 }, headerFg: white,
                    stripe: { red: 0.90, green: 0.96, blue: 0.90 }, premHeader: { red: 0.13, green: 0.30, blue: 0.13 } },
    "Петнат":     { header: { red: 0.35, green: 0.22, blue: 0.55 }, headerFg: white,
                    stripe: { red: 0.94, green: 0.90, blue: 0.99 }, premHeader: { red: 0.22, green: 0.13, blue: 0.38 } },
    "Крепленое":  { header: { red: 0.35, green: 0.25, blue: 0.12 }, headerFg: white,
                    stripe: { red: 0.96, green: 0.93, blue: 0.87 }, premHeader: { red: 0.22, green: 0.15, blue: 0.07 } },
  };

  const abcStyle: Record<AbcClass, { bg: any; fg: any }> = {
    A: { bg: { red: 0.20, green: 0.63, blue: 0.42 }, fg: white },
    B: { bg: { red: 0.98, green: 0.73, blue: 0.20 }, fg: dark  },
    C: { bg: { red: 0.87, green: 0.87, blue: 0.87 }, fg: { red: 0.4, green: 0.4, blue: 0.4 } },
    P: { bg: { red: 0.85, green: 0.70, blue: 0.20 }, fg: dark  }, // gold for premium
  };

  // ── Build rows ──
  const allRows: any[][] = [];
  const fmtRequests: any[] = [];

  // Global title
  allRows.push([`Винная матрица · ${fromDate} — ${toDate} · Премиум ≥ ${PREMIUM_THRESHOLD.toLocaleString()} ฿`, ...new Array(nCols - 1).fill("")]);
  allRows.push(colHeaders);

  // freeze top 2 rows
  fmtRequests.push({
    updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 2 } }, fields: "gridProperties.frozenRowCount" },
  });

  // column widths
  const colWidths = [40, 300, 60, 55, 110, 55, 55, 100, 55, 100, 60, 160];
  for (let i = 0; i < colWidths.length; i++) {
    fmtRequests.push({ updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: colWidths[i] }, fields: "pixelSize",
    }});
  }

  // title row formatting
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });

  // column header row
  fmtRequests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true, fontSize: 10 }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });

  let currentRow = 2;
  const spacerRows: number[] = [];

  // helper: record section block
  interface Block {
    color: WineColor;
    kind: "premium" | "standard";
    headerRow: number;
    dataStart: number;
    dataEnd: number;
    items: WineItem[];
  }
  const blocks: Block[] = [];

  for (const color of WINE_COLOR_ORDER) {
    const { std, prem } = classified.get(color)!;
    const theme = colorTheme[color];

    // ── Premium block (if any) ──
    if (prem.length > 0) {
      const premRev = Math.round(prem.reduce((s, i) => s + i.revenue, 0));
      allRows.push([
        `★ ${color.toUpperCase()} · ПРЕМИУМ · ${prem.length} позиций · ${premRev.toLocaleString()} ฿  (ср. цена ≥ ${PREMIUM_THRESHOLD.toLocaleString()} ฿)`,
        ...new Array(nCols - 1).fill(""),
      ]);
      const headerRow = currentRow++;
      const dataStart = currentRow;
      prem.forEach((item, idx) => {
        allRows.push([idx + 1, item.name, "★", "—", Math.round(item.revenue), Math.round(item.units),
          item.checks, Math.round(item.gp), +item.gpPct.toFixed(1), Math.round(item.avgPrice), item.stock, item.supplier]);
        currentRow++;
      });
      blocks.push({ color, kind: "premium", headerRow, dataStart, dataEnd: currentRow, items: prem });
      spacerRows.push(currentRow);
      allRows.push(new Array(nCols).fill("")); currentRow++;
    }

    // ── Standard ABC block ──
    if (std.length > 0) {
      const A = std.filter(i => i.abc === "A").length;
      const B = std.filter(i => i.abc === "B").length;
      const C = std.filter(i => i.abc === "C").length;
      const stdRev = Math.round(std.reduce((s, i) => s + i.revenue, 0));
      allRows.push([
        `${color.toUpperCase()} · ${std.length} позиций · A:${A}  B:${B}  C:${C} · ${stdRev.toLocaleString()} ฿`,
        ...new Array(nCols - 1).fill(""),
      ]);
      const headerRow = currentRow++;
      const dataStart = currentRow;
      std.forEach((item, idx) => {
        const showSupplier = item.abc === "A" || item.abc === "B";
        allRows.push([idx + 1, item.name, item.abc, +(item.score ?? 0).toFixed(3), Math.round(item.revenue), Math.round(item.units),
          item.checks, Math.round(item.gp), +item.gpPct.toFixed(1), Math.round(item.avgPrice), item.stock,
          showSupplier ? item.supplier : ""]);
        currentRow++;
      });
      blocks.push({ color, kind: "standard", headerRow, dataStart, dataEnd: currentRow, items: std });
      spacerRows.push(currentRow);
      allRows.push(new Array(nCols).fill("")); currentRow++;
    }
  }

  await writeValues(MATRIX_TAB, "A1", allRows);

  // Collapse spacer rows to 6px
  for (const r of spacerRows) {
    fmtRequests.push({ updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: r, endIndex: r + 1 },
      properties: { pixelSize: 6 }, fields: "pixelSize",
    }});
  }

  // ── Formatting per block ──
  for (const block of blocks) {
    const { color, kind, headerRow, dataStart, dataEnd, items } = block;
    const theme = colorTheme[color];
    const hdrBg = kind === "premium" ? theme.premHeader : theme.header;

    // Section header row
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: headerRow, endRowIndex: headerRow + 1, startColumnIndex: 0, endColumnIndex: nCols },
        cell: { userEnteredFormat: { backgroundColor: hdrBg, textFormat: { bold: true, fontSize: 11, foregroundColor: white } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
    fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: headerRow, endRowIndex: headerRow + 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });
    fmtRequests.push({ updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: headerRow, endIndex: headerRow + 1 },
      properties: { pixelSize: 32 }, fields: "pixelSize",
    }});

    // Data rows: alternating stripes
    for (let r = dataStart; r < dataEnd; r++) {
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: nCols },
          cell: { userEnteredFormat: {
            backgroundColor: (r - dataStart) % 2 === 0 ? white : theme.stripe,
            textFormat: { fontSize: 10 },
          }},
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      });
    }

    // Скор column (col 3) — 3 decimals, right-aligned, gray text
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 3, endColumnIndex: 4 },
        cell: { userEnteredFormat: { horizontalAlignment: "RIGHT", numberFormat: { type: "NUMBER", pattern: "0.000" },
          textFormat: { foregroundColor: { red: 0.55, green: 0.55, blue: 0.55 }, fontSize: 9 } } },
        fields: "userEnteredFormat(horizontalAlignment,numberFormat,textFormat)",
      },
    });
    // Numeric columns right-aligned + thousands format (cols 4+, skip GP% at 8)
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 4, endColumnIndex: nCols },
        cell: { userEnteredFormat: { horizontalAlignment: "RIGHT", numberFormat: { type: "NUMBER", pattern: "# ##0" } } },
        fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
      },
    });
    // GP% — one decimal (col 8)
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 8, endColumnIndex: 9 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.0" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
    // # column center (col 0)
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER", textFormat: { foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } } } },
        fields: "userEnteredFormat(horizontalAlignment,textFormat)",
      },
    });
    // Остаток column center (col 10)
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 10, endColumnIndex: 11 },
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    });
    // Поставщик column (col 11) — subtle gray italic for all, will be overridden for A/B
    fmtRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 11, endColumnIndex: 12 },
        cell: { userEnteredFormat: { textFormat: { italic: true, fontSize: 9,
          foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } } } },
        fields: "userEnteredFormat.textFormat",
      },
    });
    // A/B rows: supplier bold, darker
    for (let r = dataStart; r < dataEnd; r++) {
      const item = items[r - dataStart];
      if (!item || (item.abc !== "A" && item.abc !== "B" && item.abc !== "P")) continue;
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 11, endColumnIndex: 12 },
          cell: { userEnteredFormat: { textFormat: { italic: false, fontSize: 10, bold: false,
            foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 } } } },
          fields: "userEnteredFormat.textFormat",
        },
      });
    }

    // ── Out-of-stock highlight for A and top-B ──
    if (kind === "standard") {
      const bItems  = items.filter(i => i.abc === "B");
      const topBCut = Math.ceil(bItems.length / 2);
      let bSeen = 0;
      for (let r = dataStart; r < dataEnd; r++) {
        const item = items[r - dataStart];
        if (!item || item.stock > 0) { if (item?.abc === "B") bSeen++; continue; }
        const isTopB = item.abc === "B" && bSeen < topBCut;
        if (item.abc === "B") bSeen++;
        if (item.abc !== "A" && !isTopB) continue;

        // Row background: red for A, orange for top-B
        const rowBg = item.abc === "A"
          ? { red: 1.0, green: 0.82, blue: 0.82 }   // coral-red
          : { red: 1.0, green: 0.92, blue: 0.76 };   // peach-orange
        fmtRequests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: nCols },
            cell: { userEnteredFormat: { backgroundColor: rowBg } },
            fields: "userEnteredFormat.backgroundColor",
          },
        });
        // Остаток cell (col 10): bold red "0"
        fmtRequests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 10, endColumnIndex: 11 },
            cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 0.8, green: 0.1, blue: 0.1 } } } },
            fields: "userEnteredFormat.textFormat",
          },
        });
      }
    }

    // ABC / ★ badge coloring (col 2) — unchanged position
    for (let r = dataStart; r < dataEnd; r++) {
      const item = items[r - dataStart];
      if (!item) continue;
      const { bg, fg } = abcStyle[item.abc];
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 2, endColumnIndex: 3 },
          cell: { userEnteredFormat: { backgroundColor: bg, textFormat: { bold: true, foregroundColor: fg }, horizontalAlignment: "CENTER" } },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
        },
      });
    }
  }

  await sheets("POST", ":batchUpdate", { requests: fmtRequests });
  console.log(`  ✓ Матрица written.`);

  // ── Dead stock analysis (Склад-C) ─────────────────────────────────────────
  await writeDeadStockSheet(classified, fromDate, toDate);

  console.log(`\n✓ Done.`);
  console.log(`  → https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);
}

// ─── Dead stock sheet ──────────────────────────────────────────────────────

async function writeDeadStockSheet(
  classified: Map<WineColor, { std: WineItem[]; prem: WineItem[] }>,
  fromDate: string,
  toDate: string,
) {
  console.log(`\nBuilding dead stock analysis...`);

  const periodDays = Math.round(
    (new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86_400_000
  ) + 1;

  // Collect all C-segment items that have stock > 0
  interface DeadItem {
    color: WineColor;
    name: string;
    stock: number;
    units: number;       // sold in period
    avgCost: number;     // estimated cost per bottle
    avgPrice: number;
    stockCostValue: number;   // stock × avgCost  (замороженный капитал)
    stockRetailValue: number; // stock × avgPrice (упущенная выручка)
    daysOfStock: number | null; // null = truly dead (0 sales)
    supplier: string;
  }

  const deadItems: DeadItem[] = [];

  for (const color of WINE_COLOR_ORDER) {
    const { std } = classified.get(color)!;
    for (const item of std) {
      if (item.abc !== "C" || item.stock <= 0) continue;
      const avgCost        = item.units > 0 ? (item.revenue - item.gp) / item.units : item.avgPrice * 0.6;
      const stockCostValue = item.stock * avgCost;
      const stockRetailValue = item.stock * item.avgPrice;
      const dailyUnits     = item.units / periodDays;
      const daysOfStock    = item.units > 0 ? Math.round(item.stock / dailyUnits) : null;
      deadItems.push({ color, name: item.name, stock: item.stock, units: item.units,
        avgCost, avgPrice: item.avgPrice, stockCostValue, stockRetailValue, daysOfStock, supplier: item.supplier });
    }
  }

  // Sort: truly dead first (daysOfStock = null), then by daysOfStock desc, then by cost value desc
  deadItems.sort((a, b) => {
    if (a.daysOfStock === null && b.daysOfStock !== null) return -1;
    if (a.daysOfStock !== null && b.daysOfStock === null) return 1;
    if (a.daysOfStock === null && b.daysOfStock === null) return b.stockCostValue - a.stockCostValue;
    return (b.daysOfStock! - a.daysOfStock!) || (b.stockCostValue - a.stockCostValue);
  });

  const totalCostValue   = Math.round(deadItems.reduce((s, i) => s + i.stockCostValue, 0));
  const totalRetailValue = Math.round(deadItems.reduce((s, i) => s + i.stockRetailValue, 0));
  const totalUnits       = deadItems.reduce((s, i) => s + i.stock, 0);
  const trulyDead        = deadItems.filter(i => i.daysOfStock === null).length;
  const over180days      = deadItems.filter(i => i.daysOfStock !== null && i.daysOfStock > 180).length;

  // Summary by color
  const byColor = new Map<WineColor, { items: number; units: number; cost: number; retail: number }>();
  for (const c of WINE_COLOR_ORDER) byColor.set(c, { items: 0, units: 0, cost: 0, retail: 0 });
  for (const item of deadItems) {
    const b = byColor.get(item.color)!;
    b.items++; b.units += item.stock; b.cost += item.stockCostValue; b.retail += item.stockRetailValue;
  }

  // Console summary
  console.log(`  Period: ${periodDays} days`);
  console.log(`  C-segment with stock: ${deadItems.length} positions · ${totalUnits} bottles`);
  console.log(`  Truly dead (0 sales):  ${trulyDead} positions`);
  console.log(`  >180 days of stock:    ${over180days} positions`);
  console.log(`  Замороженный капитал:  ${totalCostValue.toLocaleString()} ฿ (cost)`);
  console.log(`  Розничная стоимость:   ${totalRetailValue.toLocaleString()} ฿`);

  // ── Write sheet ──
  const sheetId = await ensureTab(STOCK_TAB);
  await clearTab(sheetId);

  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1,    green: 1,    blue: 1    };
  const red   = { red: 0.80, green: 0.10, blue: 0.10 };
  const orange = { red: 0.95, green: 0.50, blue: 0.10 };

  const colHeaders = ["#", "Название", "Цвет", "Бут. на складе", "Продано за год", "Дней запаса",
    "Капитал, ฿", "Выручка если продать, ฿", "Ср. цена, ฿", "Поставщик"];
  const nCols = colHeaders.length;

  const allRows: any[][] = [];

  // ── Title ──
  allRows.push([`Зависший склад · Сегмент C · ${fromDate} — ${toDate}`, ...new Array(nCols - 1).fill("")]);

  // ── Summary block ──
  allRows.push(["", ...new Array(nCols - 1).fill("")]);
  allRows.push(["Итого позиций с остатком", deadItems.length, "", "Замороженный капитал (cost)", totalCostValue, "", "Розничная стоимость", totalRetailValue]);
  allRows.push(["Из них: не продавались ни разу", trulyDead, "", "Остаток, бутылок", totalUnits, "", "Срок > 180 дней", over180days]);
  allRows.push(["", ...new Array(nCols - 1).fill("")]);

  // ── By color summary ──
  allRows.push(["По категориям:", "", "", "Позиций", "Бутылок", "Капитал, ฿", "Розница, ฿", "", "", ""]);
  for (const c of WINE_COLOR_ORDER) {
    const b = byColor.get(c)!;
    if (b.items === 0) continue;
    allRows.push(["", c, "", b.items, b.units, Math.round(b.cost), Math.round(b.retail), "", "", ""]);
  }
  allRows.push(["", ...new Array(nCols - 1).fill("")]);

  // ── Detail header ──
  allRows.push(colHeaders);
  const detailHeaderRow = allRows.length - 1;

  // ── Detail rows ──
  const detailStartRow = allRows.length;
  deadItems.forEach((item, idx) => {
    allRows.push([
      idx + 1,
      item.name,
      item.color,
      item.stock,
      item.units,
      item.daysOfStock ?? "∞",
      Math.round(item.stockCostValue),
      Math.round(item.stockRetailValue),
      Math.round(item.avgPrice),
      item.supplier,
    ]);
  });

  await writeValues(STOCK_TAB, "A1", allRows);

  // ── Formatting ──
  const fmtReqs: any[] = [];

  // Freeze header row + detail col headers
  fmtReqs.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });

  // Column widths
  const colWidths = [40, 300, 90, 100, 110, 90, 130, 160, 90, 160];
  for (let i = 0; i < colWidths.length; i++) {
    fmtReqs.push({ updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: colWidths[i] }, fields: "pixelSize",
    }});
  }

  // Title row
  fmtReqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmtReqs.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });

  // Summary block background
  fmtReqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: detailHeaderRow, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.97, green: 0.97, blue: 0.97 } } },
      fields: "userEnteredFormat.backgroundColor",
    },
  });
  // Summary number formatting
  fmtReqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 2, endRowIndex: detailHeaderRow, startColumnIndex: 1, endColumnIndex: nCols },
      cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "# ##0" } } },
      fields: "userEnteredFormat.numberFormat",
    },
  });

  // Detail column header row
  fmtReqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: detailHeaderRow, endRowIndex: detailHeaderRow + 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.25, green: 0.25, blue: 0.25 }, textFormat: { bold: true, fontSize: 10, foregroundColor: white }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });

  // Detail rows: alternating, numbers right-aligned
  for (let r = detailStartRow; r < allRows.length; r++) {
    const item = deadItems[r - detailStartRow];
    fmtReqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: nCols },
        cell: { userEnteredFormat: {
          backgroundColor: (r - detailStartRow) % 2 === 0 ? white : { red: 0.97, green: 0.97, blue: 0.97 },
          textFormat: { fontSize: 10 },
        }},
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });

    // Highlight truly dead (∞) in red, >180 days in orange
    if (!item) continue;
    const isDead    = item.daysOfStock === null;
    const isLong    = item.daysOfStock !== null && item.daysOfStock > 180;
    if (isDead || isLong) {
      const rowBg = isDead
        ? { red: 1.0, green: 0.88, blue: 0.88 }
        : { red: 1.0, green: 0.94, blue: 0.82 };
      fmtReqs.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: nCols },
          cell: { userEnteredFormat: { backgroundColor: rowBg } },
          fields: "userEnteredFormat.backgroundColor",
        },
      });
      // Highlight "Дней запаса" cell
      fmtReqs.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 5, endColumnIndex: 6 },
          cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: isDead ? red : orange } } },
          fields: "userEnteredFormat.textFormat",
        },
      });
    }
  }

  // Numeric columns right-aligned (cols 3-8)
  fmtReqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: detailStartRow, endRowIndex: allRows.length, startColumnIndex: 3, endColumnIndex: 9 },
      cell: { userEnteredFormat: { horizontalAlignment: "RIGHT", numberFormat: { type: "NUMBER", pattern: "# ##0" } } },
      fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
    },
  });
  // Дней запаса (col 5) - center
  fmtReqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: detailStartRow, endRowIndex: allRows.length, startColumnIndex: 5, endColumnIndex: 6 },
      cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat.horizontalAlignment",
    },
  });

  await sheets("POST", ":batchUpdate", { requests: fmtReqs });
  console.log(`  ✓ Склад-C written.`);
}

main().catch(e => { console.error(e); process.exit(1); });
