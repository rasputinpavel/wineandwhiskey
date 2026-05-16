/**
 * inventory_segmentation.ts
 *
 * Классифицирует все SKU по 5 группам A/B/C/D/E на основе:
 *   - velocity B2C (из low-season 2025: Apr–Sep) — "нормальный спрос"
 *   - текущего стока (Loyverse inventory_levels)
 *   - даты последней B2C-продажи (для определения "зависших")
 *
 * Группы:
 *   A — velocity ≥ 0.5 бут/мес И сток < velocity × 2 недели  → ДЫРА, срочно докупить
 *   B — velocity ≥ 0.5 бут/мес И сток ≥ velocity × 2 недели  → норма
 *   C — velocity 0.3–0.5/мес                                  → средний, держать на 4 нед
 *   D — velocity 0.1–0.3/мес И сток ≥ 3                       → хвост, распродавать
 *   E — velocity < 0.1/мес ИЛИ последняя продажа > 4 мес назад, при стоке > 0  → зависшее
 *
 * Не учитываем SKU без сток и без velocity (мусор).
 *
 * Usage: npx tsx 03_automation/inventory_segmentation.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { classifyReceipt } from "./lib/b2b.js";

const SHEET_ID = "10EfJl0cfWj1GLoFXq9nHfZ4ZrlLcQloXs4ANRbt8HBg";
const TAB      = "Остатки A-E";

// Baseline: low-season 2025 (Apr–Sep) — same period as now, no spring/winter inflation
const BASELINE_FROM = "2025-04-01";
const BASELINE_TO   = "2025-09-30";
const BASELINE_MONTHS = 6;
const STALE_MONTHS = 4; // no sales for this many months → group E

// Group thresholds (bottles/month)
const VEL_A_B = 0.5;
const VEL_C   = 0.3;
const VEL_D   = 0.1;
const COVER_A_WEEKS = 2;  // anything below = group A

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
  const CHUNK = 1000;
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

// ─── Category bucket ──────────────────────────────────────────────────────

type Bucket = "Красное вино" | "Белое вино" | "Игристое" | "Крепкий" | "Пиво" | "Закуски" | "Прочее";

function classifyCat(name: string): Bucket | null {
  const n = name.toLowerCase();
  if (/red\s*wine|красн/.test(n)) return "Красное вино";
  if (/white\s*wine|бел/.test(n)) return "Белое вино";
  if (/sparkling/.test(n)) return "Игристое";
  if (/whiskey|whisky|vodka|^gin$|^rum$|tequila|cognac|armagnac|calvados|sidr|grappa|liquor|liqueur|sherry|fortified|sake/.test(n)) return "Крепкий";
  if (/^beer$|пиво/.test(n)) return "Пиво";
  if (/^food$/.test(n)) return "Закуски";
  return null; // skip RUSSIA / Consigment / Accessories / archive / etc.
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nInventory segmentation A-E\n");

  console.log(`Baseline: ${BASELINE_FROM} → ${BASELINE_TO} (${BASELINE_MONTHS} mo, low-season 2025)`);
  console.log(`Stale threshold: no B2C sales for ${STALE_MONTHS}+ months → group E`);
  console.log(`Velocity bands (bot/month): A/B ≥ ${VEL_A_B}, C ≥ ${VEL_C}, D ≥ ${VEL_D}, E < ${VEL_D}`);
  console.log(`Group A trigger: stock < velocity × ${COVER_A_WEEKS} weeks\n`);

  console.log("[1/4] Fetching Loyverse data...");
  const [cats, items, levels]: any[] = await Promise.all([
    loy("/categories", "categories"),
    loy("/items", "items"),
    loy("/inventory", "inventory_levels"),
  ]);

  const catBucket = new Map<string, Bucket>();
  for (const c of cats) {
    const b = classifyCat(c.name);
    if (b) catBucket.set(c.id, b);
  }

  const itemMeta = new Map<string, { name: string; bucket: Bucket | null; cost: number; price: number }>();
  const variantToItem = new Map<string, string>();
  for (const it of items) {
    const bucket = catBucket.get(it.category_id) ?? null;
    const variants = it.variants ?? [];
    let cost = 0, price = 0;
    if (variants[0]) {
      cost = Number(variants[0].cost ?? 0);
      price = Number(variants[0].default_price ?? 0);
    }
    itemMeta.set(it.id, { name: it.item_name ?? "—", bucket, cost, price });
    for (const v of variants) variantToItem.set(v.variant_id, it.id);
  }

  const itemStock = new Map<string, number>();
  for (const lvl of levels) {
    const itemId = variantToItem.get(lvl.variant_id);
    if (!itemId) continue;
    const stock = Number(lvl.in_stock ?? 0);
    if (stock <= 0) continue;
    itemStock.set(itemId, (itemStock.get(itemId) ?? 0) + stock);
  }

  console.log(`  ${items.length} items · ${itemStock.size} with positive stock`);

  // Fetch baseline B2C velocity (Apr-Sep 2025) — receipts in that window, B2C only
  console.log(`[2/4] Fetching baseline receipts (${BASELINE_FROM} → ${BASELINE_TO})...`);
  const minUtcBL = new Date(`${BASELINE_FROM}T00:00:00+07:00`).toISOString();
  const maxUtcBL = new Date(`${BASELINE_TO}T23:59:59+07:00`).toISOString();
  const baseReceipts: any[] = await loy(`/receipts?receipt_type=SALE&created_at_min=${minUtcBL}&created_at_max=${maxUtcBL}`, "receipts");
  console.log(`  ${baseReceipts.length} baseline receipts`);

  // For "stale" detection: also pull last-sale dates from a wider window (last 8 months including now)
  const todayBkk = new Date(Date.now() + 7 * 3_600_000);
  const recentFrom = new Date(todayBkk.getTime() - 8 * 30 * 86_400_000).toISOString().slice(0, 10);
  console.log(`[3/4] Fetching recent receipts for last-sale date (${recentFrom} → today)...`);
  const recentReceipts: any[] = await loy(
    `/receipts?receipt_type=SALE&created_at_min=${new Date(`${recentFrom}T00:00:00+07:00`).toISOString()}&created_at_max=${todayBkk.toISOString()}`,
    "receipts",
  );
  console.log(`  ${recentReceipts.length} recent receipts`);

  // Resolve customer names (union of both windows)
  const custIds = new Set<string>();
  for (const r of [...baseReceipts, ...recentReceipts]) if (r.customer_id) custIds.add(r.customer_id);
  const custNames = await fetchCustomerNames(custIds);

  // Aggregate baseline B2C sales
  console.log("[4/4] Computing velocities + last-sale dates + classifying...");
  interface Agg { units: number; revenue: number; cost: number; }
  const baseB2C = new Map<string, Agg>();
  for (const r of baseReceipts) {
    const cn = r.customer_id ? (custNames.get(r.customer_id) ?? "") : "";
    if (classifyReceipt({ payments: r.payments, customerName: cn }).isB2B) continue;
    for (const li of r.line_items ?? []) {
      const id = li.item_id; if (!id) continue;
      const cur = baseB2C.get(id) ?? { units: 0, revenue: 0, cost: 0 };
      cur.units   += Number(li.quantity ?? 0);
      cur.revenue += Number(li.total_money ?? 0);
      cur.cost    += Number(li.cost_total ?? 0);
      baseB2C.set(id, cur);
    }
  }

  // Last B2C sale date per item (from recent window)
  const lastB2CSale = new Map<string, Date>();
  for (const r of recentReceipts) {
    const cn = r.customer_id ? (custNames.get(r.customer_id) ?? "") : "";
    if (classifyReceipt({ payments: r.payments, customerName: cn }).isB2B) continue;
    const dt = new Date(r.created_at);
    for (const li of r.line_items ?? []) {
      const id = li.item_id; if (!id) continue;
      const prev = lastB2CSale.get(id);
      if (!prev || dt > prev) lastB2CSale.set(id, dt);
    }
  }

  // Build candidate set: items that EITHER have stock OR had baseline B2C sales
  const candidateIds = new Set<string>([...itemStock.keys(), ...baseB2C.keys()]);

  interface SKU {
    itemId: string;
    name: string;
    bucket: Bucket;
    velocityBaseline: number;       // B2C bot/month from baseline window
    avgRetail: number;              // baseline B2C revenue / units (or fallback to default_price)
    avgCost: number;                // baseline B2C cost / units (or fallback to item.cost)
    marginPct: number;              // (retail-cost)/retail
    stock: number;
    monthsSinceLastSale: number | null; // null if no recent B2C sales tracked
    group: "A" | "B" | "C" | "D" | "E" | "—";
    targetCover4w: number;          // velocity * 4 / 4.345
    needToBuy: number;              // for A: target - stock
    frozenCapital: number;          // for D/E: stock × cost = заморожено
    expectedMargin30d: number;      // velocity × (retail-cost) — потенциальная маржа в месяц
  }

  const skus: SKU[] = [];
  for (const itemId of candidateIds) {
    const meta = itemMeta.get(itemId);
    if (!meta) continue;
    if (!meta.bucket) continue; // skip RUSSIA / accessories / archive / etc.
    const stock = Math.floor(itemStock.get(itemId) ?? 0);
    const agg = baseB2C.get(itemId);
    const units = agg?.units ?? 0;
    const velocity = units / BASELINE_MONTHS;
    const avgRetail = agg && agg.units > 0 ? agg.revenue / agg.units : meta.price;
    const avgCost   = agg && agg.units > 0 ? agg.cost / agg.units : meta.cost;
    const marginPct = avgRetail > 0 ? (avgRetail - avgCost) / avgRetail : 0;
    const targetCover4w = Math.ceil(velocity * 4 / 4.345);

    // Last B2C sale date
    const lastDt = lastB2CSale.get(itemId);
    const monthsSince = lastDt ? (todayBkk.getTime() - lastDt.getTime()) / (30 * 86_400_000) : null;

    // Classify
    let group: SKU["group"];
    if (velocity >= VEL_A_B) {
      const coverWeeks = velocity > 0 ? (stock / velocity) * (52 / 12) : 99;
      group = coverWeeks < COVER_A_WEEKS ? "A" : "B";
    } else if (velocity >= VEL_C) {
      group = "C";
    } else if (velocity >= VEL_D && stock >= 3) {
      group = "D";
    } else if ((velocity < VEL_D || (monthsSince !== null && monthsSince >= STALE_MONTHS)) && stock > 0) {
      group = "E";
    } else if (stock === 0 && velocity < VEL_D) {
      // Out-of-stock, low velocity — neither dyra nor frozen. Skip.
      group = "—";
    } else {
      group = "—";
    }
    if (group === "—") continue;

    const needToBuy = group === "A" ? Math.max(0, targetCover4w - stock) : 0;
    const frozenCapital = (group === "D" || group === "E") ? stock * avgCost : 0;
    const expectedMargin30d = velocity * (avgRetail - avgCost);

    skus.push({
      itemId, name: meta.name, bucket: meta.bucket,
      velocityBaseline: velocity, avgRetail, avgCost, marginPct,
      stock, monthsSinceLastSale: monthsSince,
      group, targetCover4w, needToBuy, frozenCapital, expectedMargin30d,
    });
  }

  // Sort: by group A→B→C→D→E, then by velocity desc within
  const groupOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };
  skus.sort((a, b) => {
    if (groupOrder[a.group] !== groupOrder[b.group]) return groupOrder[a.group] - groupOrder[b.group];
    return b.velocityBaseline - a.velocityBaseline;
  });

  // ─── Build sheet ──────────────────────────────────────────────────────
  const sheetId = await ensureTab(TAB);
  await clearTab(sheetId);

  const rows: any[][] = [];
  rows.push([`Остатки A-E · baseline B2C velocity ${BASELINE_FROM} → ${BASELINE_TO} (${BASELINE_MONTHS} мес) · сток на сегодня`]);
  rows.push([]);

  // Summary by group
  rows.push(["СВОДКА ПО ГРУППАМ"]);
  const sHdrRow = rows.length - 1;
  rows.push(["Группа", "Описание", "SKU", "Бутылок на складе", "Замороженный капитал ฿", "Маржа/мес если продастся ฿", "К докупу бут (A)", "Сумма докупки ฿ (A)"]);
  const sColRow = rows.length - 1;
  const sStart = rows.length;

  const groupDescs: Record<string, string> = {
    A: "Дыра в бестселлере (срочно докупить)",
    B: "Бестселлер в норме",
    C: "Средний ассортимент",
    D: "Медленный хвост",
    E: "Зависшее (списать / акция)",
  };
  for (const g of ["A", "B", "C", "D", "E"] as const) {
    const inG = skus.filter(s => s.group === g);
    const skuCount = inG.length;
    const bottles = inG.reduce((s, x) => s + x.stock, 0);
    const frozen = Math.round(inG.reduce((s, x) => s + x.frozenCapital, 0));
    const margin = Math.round(inG.reduce((s, x) => s + x.expectedMargin30d, 0));
    const needBuyBottles = inG.reduce((s, x) => s + x.needToBuy, 0);
    const needBuyMoney = Math.round(inG.reduce((s, x) => s + x.needToBuy * x.avgCost, 0));
    rows.push([g, groupDescs[g], skuCount, bottles, frozen, margin, needBuyBottles, needBuyMoney]);
  }
  rows.push(["ИТОГО", "",
    skus.length,
    skus.reduce((s, x) => s + x.stock, 0),
    Math.round(skus.reduce((s, x) => s + x.frozenCapital, 0)),
    Math.round(skus.reduce((s, x) => s + x.expectedMargin30d, 0)),
    skus.reduce((s, x) => s + x.needToBuy, 0),
    Math.round(skus.reduce((s, x) => s + x.needToBuy * x.avgCost, 0)),
  ]);
  const sEnd = rows.length;

  // Per-bucket × group breakdown
  rows.push([]);
  rows.push(["ПО КАТЕГОРИЯМ × ГРУППАМ (SKU count)"]);
  const bHdrRow = rows.length - 1;
  rows.push(["Категория", "A", "B", "C", "D", "E", "ИТОГО"]);
  const bColRow = rows.length - 1;
  const bStart = rows.length;
  const buckets: Bucket[] = ["Красное вино", "Белое вино", "Игристое", "Крепкий", "Пиво", "Закуски"];
  for (const b of buckets) {
    const inB = skus.filter(s => s.bucket === b);
    const a = inB.filter(s => s.group === "A").length;
    const bb = inB.filter(s => s.group === "B").length;
    const c = inB.filter(s => s.group === "C").length;
    const d = inB.filter(s => s.group === "D").length;
    const e = inB.filter(s => s.group === "E").length;
    rows.push([b, a, bb, c, d, e, a + bb + c + d + e]);
  }
  const bEnd = rows.length;

  // Detail
  rows.push([]);
  rows.push(["ДЕТАЛЬНО ПО SKU (отсортировано: A→B→C→D→E, внутри по velocity desc)"]);
  const dHdrRow = rows.length - 1;
  rows.push(["№", "Группа", "Категория", "SKU", "Velocity B2C (бут/мес)", "Сток", "Запас (нед)", "Закуп ฿/бут", "Розница ฿/бут", "Маржа %", "Замороженный кап. ฿", "Маржа/мес ฿", "Купить бут.", "Сумма закупа ฿", "Последняя B2C продажа (мес назад)"]);
  const dColRow = rows.length - 1;
  const dStart = rows.length;

  for (let i = 0; i < skus.length; i++) {
    const s = skus[i];
    const coverWeeks = s.velocityBaseline > 0 ? (s.stock / s.velocityBaseline) * (52 / 12) : null;
    rows.push([
      i + 1,
      s.group,
      s.bucket,
      s.name,
      Math.round(s.velocityBaseline * 100) / 100,
      s.stock,
      coverWeeks !== null ? (Math.round(coverWeeks * 10) / 10) : "∞",
      Math.round(s.avgCost),
      Math.round(s.avgRetail),
      Math.round(s.marginPct * 1000) / 10,
      Math.round(s.frozenCapital),
      Math.round(s.expectedMargin30d),
      s.needToBuy || "",
      s.needToBuy ? Math.round(s.needToBuy * s.avgCost) : "",
      s.monthsSinceLastSale !== null ? (Math.round(s.monthsSinceLastSale * 10) / 10) : "—",
    ]);
  }
  const dEnd = rows.length;

  rows.push([]);
  rows.push(["Заметки:"]);
  rows.push([`  · Velocity = бутылок в месяц по B2C-чекам в окне ${BASELINE_FROM} → ${BASELINE_TO} (${BASELINE_MONTHS} мес).`]);
  rows.push(["  · «Запас (нед)» = сток / velocity × 52/12. Показывает на сколько недель текущего стока хватит при baseline-скорости."]);
  rows.push(["  · «Замороженный капитал» считается только для D/E — это деньги, лежащие на полке без оборота."]);
  rows.push(["  · «Купить бут.» = только для группы A (дыра): сколько докупить чтобы выйти на 4-недельный запас."]);
  rows.push(["  · Группа E включает SKU где либо velocity < 0.1/мес, либо нет B2C-продаж более 4 месяцев — но сток > 0."]);

  await writeRows(sheetId, 0, 0, rows);

  // ─── Formatting ────────────────────────────────────────────────────────
  const FMT_BAHT = { type: "CURRENCY", pattern: "#,##0\\ \"฿\"" };
  const FMT_INT  = { type: "NUMBER",   pattern: "#,##0" };
  const FMT_DEC  = { type: "NUMBER",   pattern: "#,##0.00" };
  const FMT_PCT  = { type: "NUMBER",   pattern: "0.0\"%\"" };
  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  const fmt: any[] = [];
  fmt.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });
  // 15 cols total in detail
  const widths = [50, 70, 110, 360, 110, 60, 80, 90, 90, 70, 130, 110, 90, 110, 130];
  for (let i = 0; i < widths.length; i++) {
    fmt.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: widths[i] }, fields: "pixelSize" } });
  }

  // Title
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 15 },
      cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 15 }, mergeType: "MERGE_ALL" } });

  // Summary block
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: sHdrRow, endRowIndex: sHdrRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.40, blue: 0.20 }, textFormat: { bold: true, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: sHdrRow, endRowIndex: sHdrRow + 1, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: "MERGE_ALL" } });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: sColRow, endRowIndex: sColRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // numbers
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: sStart, endRowIndex: sEnd, startColumnIndex: 2, endColumnIndex: 4 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: sStart, endRowIndex: sEnd, startColumnIndex: 4, endColumnIndex: 6 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: sStart, endRowIndex: sEnd, startColumnIndex: 6, endColumnIndex: 7 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: sStart, endRowIndex: sEnd, startColumnIndex: 7, endColumnIndex: 8 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // group color tags in summary
  const groupColors: Record<string, any> = {
    A: { red: 1.0, green: 0.78, blue: 0.78 },  // red
    B: { red: 0.85, green: 0.95, blue: 0.85 }, // green
    C: { red: 1.0, green: 0.97, blue: 0.85 },  // yellow
    D: { red: 0.92, green: 0.92, blue: 0.92 }, // gray
    E: { red: 1.0, green: 0.85, blue: 0.85 },  // light red
  };
  for (let i = 0; i < 5; i++) {
    const r = sStart + i;
    fmt.push({
      repeatCell: {
        range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { backgroundColor: groupColors["ABCDE"[i]], textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    });
  }
  // ИТОГО summary row
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: sEnd - 1, endRowIndex: sEnd, startColumnIndex: 0, endColumnIndex: 8 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // Bucket × group block
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: bHdrRow, endRowIndex: bHdrRow + 1, startColumnIndex: 0, endColumnIndex: 7 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.45, green: 0.36, blue: 0.08 }, textFormat: { bold: true, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: bHdrRow, endRowIndex: bHdrRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: bColRow, endRowIndex: bColRow + 1, startColumnIndex: 0, endColumnIndex: 7 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: bStart, endRowIndex: bEnd, startColumnIndex: 1, endColumnIndex: 7 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });

  // Detail block
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dHdrRow, endRowIndex: dHdrRow + 1, startColumnIndex: 0, endColumnIndex: 15 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.55, green: 0.13, blue: 0.13 }, textFormat: { bold: true, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: dHdrRow, endRowIndex: dHdrRow + 1, startColumnIndex: 0, endColumnIndex: 15 }, mergeType: "MERGE_ALL" } });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dColRow, endRowIndex: dColRow + 1, startColumnIndex: 0, endColumnIndex: 15 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // formats per column
  // 0=№ center, 1=group center+bg, 2=cat, 3=name, 4=velocity dec, 5=stock int, 6=cover dec
  // 7-8=cost/retail BAHT, 9=margin% pct, 10=frozen BAHT, 11=margin/mo BAHT, 12=buy int, 13=buy money BAHT, 14=months dec
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: dStart, endRowIndex: dEnd, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { horizontalAlignment: "CENTER", textFormat: { foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } } } }, fields: "userEnteredFormat(horizontalAlignment,textFormat)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: dStart, endRowIndex: dEnd, startColumnIndex: 4, endColumnIndex: 5 }, cell: { userEnteredFormat: { numberFormat: FMT_DEC, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: dStart, endRowIndex: dEnd, startColumnIndex: 5, endColumnIndex: 7 }, cell: { userEnteredFormat: { numberFormat: FMT_DEC, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: dStart, endRowIndex: dEnd, startColumnIndex: 7, endColumnIndex: 9 }, cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: dStart, endRowIndex: dEnd, startColumnIndex: 9, endColumnIndex: 10 }, cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: dStart, endRowIndex: dEnd, startColumnIndex: 10, endColumnIndex: 12 }, cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: dStart, endRowIndex: dEnd, startColumnIndex: 12, endColumnIndex: 13 }, cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: dStart, endRowIndex: dEnd, startColumnIndex: 13, endColumnIndex: 14 }, cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: dStart, endRowIndex: dEnd, startColumnIndex: 14, endColumnIndex: 15 }, cell: { userEnteredFormat: { numberFormat: FMT_DEC, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } });

  // Per-row group colour for column "Группа"
  for (let i = 0; i < skus.length; i++) {
    const s = skus[i];
    const r = dStart + i;
    fmt.push({
      repeatCell: {
        range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 1, endColumnIndex: 2 },
        cell: { userEnteredFormat: { backgroundColor: groupColors[s.group], textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    });
  }

  await sheets("POST", ":batchUpdate", { requests: fmt });
  console.log(`\n✓ "${TAB}" written.`);
  console.log(`→ https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);

  // Console summary
  console.log("Группы:");
  for (const g of ["A", "B", "C", "D", "E"] as const) {
    const inG = skus.filter(s => s.group === g);
    const frozen = Math.round(inG.reduce((s, x) => s + x.frozenCapital, 0));
    const buyMoney = Math.round(inG.reduce((s, x) => s + x.needToBuy * x.avgCost, 0));
    console.log(`  ${g}: ${inG.length} SKU · ${groupDescs[g]}${frozen ? ` · заморожено ${frozen.toLocaleString("ru-RU")} ฿` : ""}${buyMoney ? ` · докупить на ${buyMoney.toLocaleString("ru-RU")} ฿` : ""}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
