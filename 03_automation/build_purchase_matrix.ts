/**
 * build_purchase_matrix.ts
 * Builds a monthly purchase matrix for wine within a budget cap.
 *
 * Pipeline:
 *   1. Read parameters from Sheet tab "Параметры-матрица" (creates with defaults if missing).
 *   2. Pull last N months of sales from Loyverse → per-item velocity, cost, retail, margin.
 *   3. For each candidate compute target_units (= velocity_per_month × weeks/4.345).
 *   4. Score each item: w_margin × margin_norm + w_velocity × velocity_norm.
 *   5. Greedy selection respecting type budget caps (red/white/sparkling shares from sales)
 *      and subgroup minimums (≥1 position per region/grape if budget allows). Balance
 *      bonus = w_balance × (1 − subgroup_fill).
 *   6. For each picked item, look up Supabase price-service catalogue → list suppliers + prices.
 *   7. Write matrix to "Закупочная матрица" tab.
 *
 * Usage: npx tsx 03_automation/build_purchase_matrix.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import {
  Grape, detectGrape,
  RedCountry, detectRedCountryRegion,
} from "./lib/wine_detect.js";

const SHEET_ID             = "10EfJl0cfWj1GLoFXq9nHfZ4ZrlLcQloXs4ANRbt8HBg";
const PARAMS_TAB           = "Параметры-матрица";
const MATRIX_TAB           = "Закупочная матрица";
const LOYVERSE_TOKEN       = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const SUPABASE_URL         = process.env.SUPABASE_URL!;
const SUPABASE_KEY         = process.env.SUPABASE_SERVICE_KEY!;

// ─── Defaults ──────────────────────────────────────────────────────────────

interface MatrixParams {
  budget: number;                  // ฿
  target_weeks_of_stock: number;   // how many weeks of cover to buy per item
  w_margin: number;                // weight of margin in score
  w_velocity: number;              // weight of velocity in score
  w_balance: number;               // weight of balance bonus during greedy fill
  period_months: number;           // sales window for velocity/margin calc
  enforce_type_caps: number;       // 1 = hard cap per type (red/white/sparkling), 0 = free pool
  enforce_country_caps: number;    // 1 = hard cap per (type, subgroup) — country/grape, 0 = no cap
  min_margin_pct: number;          // skip items with margin below this % (0 = no filter)
  // Core / Probe split
  probe_budget_pct: number;        // % of total budget reserved for "probe" experimental SKUs
  core_min_velocity: number;       // min bottles/month to enter the core matrix
  core_min_target_units: number;   // min order qty per SKU in core (for supplier negotiation leverage)
  core_min_unit_retail: number;    // min avg retail price (฿) — cuts off bottom-shelf SKUs
  probe_min_margin_pct: number;    // min margin % for a probe candidate (filter weak experiments)
}

const DEFAULTS: MatrixParams = {
  budget: 300_000,
  target_weeks_of_stock: 4,
  w_margin: 1,
  w_velocity: 1,
  w_balance: 1,
  period_months: 15,
  enforce_type_caps: 1,
  enforce_country_caps: 1,
  min_margin_pct: 20,
  probe_budget_pct: 15,
  core_min_velocity: 0.5,
  core_min_target_units: 3,
  core_min_unit_retail: 600,
  probe_min_margin_pct: 30,
};

// ─── Sheets boilerplate ────────────────────────────────────────────────────

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

async function readRange(tab: string, range: string): Promise<any[][]> {
  const r = await sheets("GET", `/values/${encodeURIComponent(`${tab}!${range}`)}`);
  return r.values ?? [];
}

async function writeValuesPlain(tab: string, range: string, values: any[][]) {
  await sheets("PUT", `/values/${encodeURIComponent(`${tab}!${range}`)}?valueInputOption=RAW`, {
    range: `${tab}!${range}`, majorDimension: "ROWS", values,
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

// ─── Number formats ────────────────────────────────────────────────────────

const FMT_INT  = { type: "NUMBER",   pattern: "#,##0" };
const FMT_BAHT = { type: "CURRENCY", pattern: "#,##0\\ \"฿\"" };
const FMT_PCT  = { type: "NUMBER",   pattern: "0.0\"%\"" };

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

// ─── Parameters ────────────────────────────────────────────────────────────

async function ensureParamsTab(): Promise<void> {
  const meta = await sheets("GET", "");
  const has = (meta.sheets ?? []).some((s: any) => s.properties.title === PARAMS_TAB);
  if (has) return;
  const sheetId = await ensureTab(PARAMS_TAB);

  const paramRows = [
    ["Параметр", "Значение", "Описание"],
    ["budget",                DEFAULTS.budget,                "Общий бюджет закупки, ฿. Делится на основной пул и эксперимент."],
    ["target_weeks_of_stock", DEFAULTS.target_weeks_of_stock, "Недель запаса (4 = месяц)"],
    ["w_margin",              DEFAULTS.w_margin,              "Вес маржинальности в скоринге"],
    ["w_velocity",            DEFAULTS.w_velocity,            "Вес оборачиваемости (velocity) в скоринге"],
    ["w_balance",             DEFAULTS.w_balance,             "Вес сбалансированности (бонус для недо-наполненных подгрупп)"],
    ["period_months",         DEFAULTS.period_months,         "Период истории продаж для расчёта velocity (мес)"],
    ["enforce_type_caps",     DEFAULTS.enforce_type_caps,     "1 = жёсткий лимит по типам (red/white/spark), 0 = свободный пул"],
    ["enforce_country_caps",  DEFAULTS.enforce_country_caps,  "1 = жёсткий лимит по подгруппе (страна для красных, сорт для белых), 0 = только soft-бонус через w_balance"],
    ["min_margin_pct",        DEFAULTS.min_margin_pct,        "Минимальная маржа позиции в %. Всё что ниже — отбрасывается на этапе фильтра"],
    ["probe_budget_pct",      DEFAULTS.probe_budget_pct,      "% бюджета на эксперимент. Например 15 → core = 85%, probe = 15%"],
    ["core_min_velocity",     DEFAULTS.core_min_velocity,     "Min бут/мес для попадания в core. 0.5 = ≥ ~7-8 бут за 15 мес"],
    ["core_min_target_units", DEFAULTS.core_min_target_units, "Min объём заказа в core (для спецусловий с поставщиком). 3 = не берём по 1-2 бут"],
    ["core_min_unit_retail",  DEFAULTS.core_min_unit_retail,  "Min средняя розничная цена для core, ฿. Отрезает дешёвый низ ассортимента"],
    ["probe_min_margin_pct",  DEFAULTS.probe_min_margin_pct,  "Min маржа для probe-кандидата в %. Слабые эксперименты не берём"],
  ];
  await writeValuesPlain(PARAMS_TAB, `A1:C${paramRows.length}`, paramRows);

  // Methodology block
  const docRows: any[][] = [
    [], [],
    ["МЕТОДОЛОГИЯ"],
    ["Бюджет делится на ДВА пула: ОСНОВА (core) и ЭКСПЕРИМЕНТ (probe). У них разные цели и разные правила отбора."],
    [],
    ["ОСНОВА (core_budget = budget × (100 − probe_budget_pct) / 100):"],
    ["Цель: оборачиваемость и прибыль. Берём проверенные SKU с предсказуемым спросом, заказываем партиями (≥ core_min_target_units штук), чтобы у поставщика была причина дать спецусловия."],
    ["В core попадают позиции, которые ОДНОВРЕМЕННО:"],
    ["  • velocity ≥ core_min_velocity (бут/мес)"],
    ["  • средняя розничная цена ≥ core_min_unit_retail (отрезает «дешёвый низ»)"],
    ["  • target_units ≥ core_min_target_units (иначе мелкий заказ — нет причин брать)"],
    ["  • маржа ≥ min_margin_pct"],
    [],
    ["ЭКСПЕРИМЕНТ (probe_budget = budget × probe_budget_pct / 100):"],
    ["Цель: найти будущих чемпионов для следующих закупок. Берём по 1-2 бутылки от перспективных, но ещё не доказавших velocity SKU. Через 2-3 месяца смотрим — кто из probe вышел в высокую velocity, тех переводим в core."],
    ["В probe попадают позиции, которые НЕ прошли в core, но имеют:"],
    ["  • маржу ≥ probe_min_margin_pct (отсев слабых экспериментов)"],
    ["  • velocity > 0 (хоть кто-то это покупает)"],
    [],
    ["Алгоритм пошагово:"],
    ["1. Загружаем продажи из Loyverse за period_months месяцев. Категории: Red Wine / White Wine / Sparkling Wine."],
    ["2. Для каждой позиции считаем: velocity_per_month = units / period_months, unit_cost (ср. закуп), unit_retail, margin = (revenue−cost)/revenue."],
    ["3. Базовый фильтр: отбрасываются позиции с margin ≤ 0 и margin < min_margin_pct/100."],
    ["4. target_units = ceil(velocity_per_month × target_weeks_of_stock / 4.345). Это объём, который мы покупаем — ровно столько, сколько уйдёт за заданное число недель по текущей скорости продаж."],
    ["5. Разбиваем кандидатов на core / probe по правилам выше. Что не попало никуда — отбрасывается."],
    ["6. Для каждого пула отдельно: нормализуем margin и velocity внутри типа (red/white/spark), считаем score = w_margin × margin_norm + w_velocity × velocity_norm."],
    ["7. Бюджеты по типам = pool_budget × (доля продаж типа в бутылках). Применяется при enforce_type_caps = 1."],
    ["8. Бюджеты по подгруппам внутри типа = type_budget × (доля подгруппы). Применяется при enforce_country_caps = 1. Действует только в core."],
    ["9. ФАЗА 1 в core (покрытие). Из каждой подгруппы берём топ-1 по скору. Гарантирует ≥ 1 позиции каждого региона/сорта."],
    ["10. ФАЗА 2 в core (жадная заливка). Кандидаты сортируются по effective_score / unit_cost (макс возврат на ฿) и берутся по очереди, пока бюджет/кэпы позволяют. effective_score = score + w_balance × deficit (бонус для недо-наполненных подгрупп)."],
    ["11. ФАЗА 3 в core (релаксация). Если потрачено < 95% core_budget — снимаем кэпы и добиваем."],
    ["12. PROBE-фаза. Кандидаты сортируются по margin_pct (≠ score — здесь маржа важнее velocity, потому что velocity у пробников по определению низкая). Берётся по 1 (если target_units = 1) или min(target_units, 2) бутылок, пока probe_budget не исчерпан."],
    [],
    ["Что значит каждая ручка:"],
    ["• budget — общий лимит закупа. По умолчанию 300 000 ฿."],
    ["• probe_budget_pct — какая доля бюджета режется на эксперимент. 15 = на core пойдёт 85%, на probe 15%."],
    ["• target_weeks_of_stock — глубина запаса. 4 = на месяц."],
    ["• w_margin / w_velocity — веса в скоре core. Поднять w_margin → больше премиум-маржинальных. Поднять w_velocity → больше топовых бестселлеров."],
    ["• w_balance — соft-бонус для недо-наполненных подгрупп при жадной заливке."],
    ["• enforce_type_caps — 1: бюджет красного/белого/игристого жёстко равен их историческому весу. 0: типы конкурируют за общий пул."],
    ["• enforce_country_caps — 1: бюджет каждой страны/сорта внутри типа жёстко ограничен. 0: подгруппы конкурируют свободно."],
    ["• min_margin_pct — общий порог маржи. Всё что ниже — отбрасывается на самом первом фильтре, до деления на core/probe."],
    ["• core_min_velocity — порог попадания в core по velocity. 0.5 ≈ 7-8 бут за 15 мес. Это и есть граница «предсказуемого спроса»."],
    ["• core_min_target_units — минимальная партия в core. 3 = не берём по 1-2, иначе нет смысла торговаться с поставщиком."],
    ["• core_min_unit_retail — минимальная средняя розничная цена для core. Отрезает дешёвый низ. По умолчанию 600 ฿."],
    ["• probe_min_margin_pct — порог маржи для эксперимента. Дефолт 30 — слабые эксперименты не берём."],
    ["• period_months — окно истории. Чем длиннее — тем стабильнее, но менее реактивно к свежим трендам."],
    [],
    ["Что считается прибылью в матрице:"],
    ["expected_profit на позицию = (unit_retail − unit_cost) × target_units."],
    ["Это ожидаемая прибыль за месяц, исходя из того что весь target_units будет продан по текущей розничной цене и текущему закупу. Суммируется отдельно по core и probe."],
    [],
    ["Как пользоваться:"],
    ["1. Меняем числа в столбце B (Значение)."],
    ["2. Запускаем npx tsx 03_automation/build_purchase_matrix.ts (или нажимаем кнопку «Пересчитать матрицу» из меню Sheets, если настроен webhook)."],
    ["3. Смотрим новый расклад на листе «Закупочная матрица». Сводки сверху показывают core / probe / итого."],
  ];
  // Write methodology starting after paramRows + blank rows
  await writeValuesPlain(PARAMS_TAB, `A${paramRows.length + 1}:C${paramRows.length + docRows.length}`, docRows);

  // Format params table + methodology
  const fmt: any[] = [];
  fmt.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 220 }, fields: "pixelSize" } });
  fmt.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 110 }, fields: "pixelSize" } });
  fmt.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 700 }, fields: "pixelSize" } });
  // Header
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.15, green: 0.15, blue: 0.15 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  // Param values right-align
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: paramRows.length, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0.##" }, horizontalAlignment: "RIGHT", textFormat: { bold: true } } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment,textFormat)",
    },
  });
  // Description column wrap
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: paramRows.length + docRows.length, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP" } },
      fields: "userEnteredFormat(wrapStrategy,verticalAlignment)",
    },
  });
  // Methodology block — first heading row bold dark
  const methodHeaderRow = paramRows.length + 2; // skip 2 blank rows
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: methodHeaderRow, endRowIndex: methodHeaderRow + 1, startColumnIndex: 0, endColumnIndex: 3 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.45, green: 0.36, blue: 0.08 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 11 } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({
    mergeCells: { range: { sheetId, startRowIndex: methodHeaderRow, endRowIndex: methodHeaderRow + 1, startColumnIndex: 0, endColumnIndex: 3 }, mergeType: "MERGE_ALL" },
  });
  // Methodology body — wrap col A
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: methodHeaderRow + 1, endRowIndex: paramRows.length + docRows.length, startColumnIndex: 0, endColumnIndex: 3 },
      cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP", textFormat: { fontSize: 10 } } },
      fields: "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)",
    },
  });
  // Merge body rows across columns (since description sits in column A only)
  for (let r = methodHeaderRow + 1; r < paramRows.length + docRows.length; r++) {
    fmt.push({
      mergeCells: { range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 }, mergeType: "MERGE_ALL" },
    });
  }
  await sheets("POST", ":batchUpdate", { requests: fmt });
  console.log(`  Created ${PARAMS_TAB} with defaults + methodology.`);
}

async function loadParams(): Promise<MatrixParams> {
  await ensureParamsTab();
  const rows = await readRange(PARAMS_TAB, "A2:B100");
  const out: MatrixParams = { ...DEFAULTS };
  for (const [k, v] of rows) {
    if (!k || v === "" || v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (k in out) (out as any)[k] = n;
  }
  return out;
}

// ─── Wine candidate types ──────────────────────────────────────────────────

type WineType = "Красное" | "Белое" | "Игристое";

type Bucket = "core" | "probe";

interface Candidate {
  itemId: string;
  name: string;
  type: WineType;
  subgroup: string;          // country (red), grape (white), "Игристое" (sparkling)
  units: number;             // total bottles sold over period
  velocityPerMonth: number;
  unitCost: number;          // avg ฿
  unitRetail: number;        // avg ฿
  marginPct: number;         // 0..1
  loyverseSupplier: string;
  bucket: Bucket;            // core (regular) or probe (experimental)
  currentStock: number;      // bottles already on the shelf — we don't reorder these
  // computed:
  targetUnits: number;       // bottles to BUY (= max(0, monthlyTarget − stock))
  totalCost: number;
  expectedProfit: number;
  marginNorm: number;        // 0..1 within type (re-normalized within bucket)
  velocityNorm: number;      // 0..1 within type (re-normalized within bucket)
  baseScore: number;
}

interface Supplier { name: string; price: number; year?: number; volume?: string; itemName: string; }

// ─── Supabase supplier lookup ──────────────────────────────────────────────

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Strip noise from item name to improve fuzzy match.
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\d.,]+\s*(?:ml|cl|l|кл|мл|л)\b/g, "")  // 750ml, 0.75
    .replace(/\b(?:doc|docg|aoc|aop|igp|igt|dop|brut|extra\s+dry|reserva|riserva|crianza|gran\s+reserva|nv|vintage)\b/gi, "")
    .replace(/\b(20|19)\d{2}\b/g, "")                  // years
    .replace(/[^a-zа-яё\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Take the most distinctive 2-3 words for ILIKE search.
function searchKey(s: string): string {
  const words = normalizeName(s).split(" ").filter(w => w.length >= 4);
  return words.slice(0, 3).join(" ");
}

async function findSuppliers(name: string): Promise<Supplier[]> {
  const key = searchKey(name);
  if (!key) return [];
  const tokens = key.split(" ");
  // Use websearch_to_tsquery via plain ILIKE on each token.
  // We pick rows that contain ALL tokens.
  let q = sb.from("wine_items").select("name,supplier_name,price,year,volume").limit(50);
  for (const t of tokens) q = q.ilike("name", `%${t}%`);
  const { data, error } = await q;
  if (error) {
    console.warn(`  Supabase lookup failed for "${name}": ${error.message}`);
    return [];
  }
  if (!data) return [];
  const out: Supplier[] = [];
  for (const row of data) {
    if (!row.supplier_name || !row.price) continue;
    out.push({
      name: row.supplier_name,
      itemName: row.name ?? "",
      price: Number(row.price),
      year: row.year ?? undefined,
      volume: row.volume ?? undefined,
    });
  }
  // Deduplicate by supplier+itemName+year+volume (catches accidental dup rows in same price-list).
  const seen = new Set<string>();
  const dedup: Supplier[] = [];
  for (const s of out.sort((a, b) => a.price - b.price)) {
    const k = `${s.name}|${s.itemName}|${s.year ?? ""}|${s.volume ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(s);
  }
  return dedup.slice(0, 6);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nPurchase Matrix Builder\n");

  // 1. Params
  const params = await loadParams();
  console.log("Parameters:");
  for (const [k, v] of Object.entries(params)) console.log(`  ${k} = ${v}`);

  const todayBkk = new Date(Date.now() + 7 * 3_600_000);
  const toIso    = todayBkk.toISOString().slice(0, 10);
  const fromIso  = new Date(todayBkk.getTime() - params.period_months * 30 * 86_400_000).toISOString().slice(0, 10);
  console.log(`\nPeriod: ${fromIso} → ${toIso}`);

  // 2. Loyverse data
  console.log("\n[1/4] Fetching Loyverse data...");
  const [categories, items, suppliers, invLevels] = await Promise.all([
    loyverseFetch<any>("/categories", "categories"),
    loyverseFetch<any>("/items", "items"),
    loyverseFetch<any>("/suppliers", "suppliers"),
    loyverseFetch<any>("/inventory", "inventory_levels"),
  ]);
  const whiteCatId     = categories.find(c => /white\s*wine|бел/i.test(c.name))?.id;
  const redCatId       = categories.find(c => /red\s*wine|красн/i.test(c.name))?.id;
  const sparklingCatId = categories.find(c => /sparkling/i.test(c.name))?.id;
  if (!whiteCatId || !redCatId || !sparklingCatId) {
    console.error("Wine categories not found.");
    process.exit(1);
  }
  const supplierNameById = new Map<string, string>();
  for (const s of suppliers) supplierNameById.set(s.id, s.name ?? s.supplier_name ?? "—");
  const itemMeta = new Map<string, { name: string; cat: string; supplier: string }>();
  const variantToItem = new Map<string, string>();
  for (const it of items) {
    itemMeta.set(it.id, {
      name: it.item_name ?? it.name ?? "—",
      cat: it.category_id ?? "",
      supplier: it.primary_supplier_id ? (supplierNameById.get(it.primary_supplier_id) ?? "—") : "—",
    });
    for (const v of it.variants ?? []) variantToItem.set(v.variant_id, it.id);
  }
  // Aggregate inventory across variants/stores to per-item totals.
  const itemStock = new Map<string, number>();
  for (const lvl of invLevels) {
    const itemId = variantToItem.get(lvl.variant_id);
    if (!itemId) continue;
    itemStock.set(itemId, (itemStock.get(itemId) ?? 0) + (lvl.in_stock ?? 0));
  }
  const wineItemIds = new Set([...itemMeta].filter(([_, m]) => m.cat === whiteCatId || m.cat === redCatId || m.cat === sparklingCatId).map(([id]) => id));
  const totalWineStock = [...wineItemIds].reduce((s, id) => s + (itemStock.get(id) ?? 0), 0);
  console.log(`  ${invLevels.length} inventory levels · ${Math.round(totalWineStock)} винных бутылок на складе`);

  // 3. Receipts
  const minUtc = new Date(`${fromIso}T00:00:00+07:00`).toISOString();
  const maxUtc = new Date(`${toIso}T23:59:59+07:00`).toISOString();
  const receipts: any[] = await loyverseFetch(
    `/receipts?receipt_type=SALE&created_at_min=${minUtc}&created_at_max=${maxUtc}`,
    "receipts",
  );
  console.log(`  ${receipts.length} receipts.`);

  // 4. Aggregate by item
  console.log("\n[2/4] Aggregating sales...");
  interface Agg { units: number; revenue: number; cost: number; }
  const acc = new Map<string, Agg>();
  for (const r of receipts) {
    for (const li of r.line_items ?? []) {
      const id = li.item_id as string;
      if (!id) continue;
      const meta = itemMeta.get(id);
      if (!meta) continue;
      if (meta.cat !== whiteCatId && meta.cat !== redCatId && meta.cat !== sparklingCatId) continue;
      const cur = acc.get(id) ?? { units: 0, revenue: 0, cost: 0 };
      cur.units   += li.quantity ?? 0;
      cur.revenue += li.total_money ?? 0;
      cur.cost    += li.cost_total  ?? 0;
      acc.set(id, cur);
    }
  }
  console.log(`  ${acc.size} wine items with sales.`);

  // 5. Build raw candidates (everything that passes basic filters)
  const weeksFactor = params.target_weeks_of_stock / 4.345;
  interface RawCandidate {
    itemId: string; name: string; type: WineType; subgroup: string;
    units: number; velocityPerMonth: number; unitCost: number; unitRetail: number;
    marginPct: number; loyverseSupplier: string;
    coreTargetUnits: number; currentStock: number; needToBuy: number;
  }
  const raw: RawCandidate[] = [];
  // Forecast monthly profit from CURRENT stock alone (what will sell next month without any new buy).
  let stockMonthlyProfit = 0;
  let stockMonthlyRevenue = 0;
  for (const [itemId, a] of acc) {
    if (a.units <= 0 || a.revenue <= 0) continue;
    const meta = itemMeta.get(itemId)!;
    let type: WineType;
    let subgroup: string;
    if (meta.cat === redCatId) {
      type = "Красное";
      subgroup = detectRedCountryRegion(meta.name).country;
    } else if (meta.cat === whiteCatId) {
      type = "Белое";
      subgroup = detectGrape(meta.name);
    } else {
      type = "Игристое";
      subgroup = "Игристое";
    }
    const velocityPerMonth = a.units / params.period_months;
    const coreTargetUnits = Math.max(0, Math.ceil(velocityPerMonth * weeksFactor));
    const currentStock = Math.max(0, Math.floor(itemStock.get(itemId) ?? 0));
    const needToBuy    = Math.max(0, coreTargetUnits - currentStock);
    const unitCost   = a.cost / a.units;
    const unitRetail = a.revenue / a.units;
    const marginPct  = (a.revenue - a.cost) / a.revenue;
    if (unitCost <= 0 || marginPct <= 0) continue;
    if (marginPct < params.min_margin_pct / 100) continue;
    // Stock contribution to next-month profit: bottles that will sell from existing stock,
    // capped by velocity (we won't sell more than the item moves per month).
    const willSellFromStock = Math.min(currentStock, velocityPerMonth);
    stockMonthlyProfit  += willSellFromStock * (unitRetail - unitCost);
    stockMonthlyRevenue += willSellFromStock * unitRetail;
    raw.push({ itemId, name: meta.name, type, subgroup, units: a.units, velocityPerMonth, unitCost, unitRetail, marginPct, loyverseSupplier: meta.supplier, coreTargetUnits, currentStock, needToBuy });
  }
  console.log(`  ${raw.length} raw candidates after base filters.`);
  console.log(`  Прогноз продаж со склада: ${Math.round(stockMonthlyRevenue).toLocaleString("ru-RU")} ฿ выручки → ${Math.round(stockMonthlyProfit).toLocaleString("ru-RU")} ฿ маржи (без новых закупок)`);

  // 6. Split into core vs probe
  //    Filters use the full monthly target (coreTargetUnits) but the actual order
  //    quantity is needToBuy = max(0, monthly_target − current_stock).
  //    If stock already covers the month, the SKU is dropped from the buy plan
  //    (no point ordering anything for it this cycle).
  const candidates: Candidate[] = [];
  let alreadyCoveredCount = 0;
  for (const r of raw) {
    const fitsCore =
      r.velocityPerMonth >= params.core_min_velocity &&
      r.coreTargetUnits  >= params.core_min_target_units &&
      r.unitRetail       >= params.core_min_unit_retail;
    let bucket: Bucket | null = null;
    let targetUnits = 0;
    if (fitsCore) {
      bucket = "core";
      targetUnits = r.needToBuy; // already accounts for stock
    } else if (r.marginPct >= params.probe_min_margin_pct / 100) {
      bucket = "probe";
      // Probe: 1-2 bottles experiment — but only if we don't already have stock.
      const probeWant = Math.max(1, Math.min(r.coreTargetUnits, 2));
      targetUnits = Math.max(0, probeWant - r.currentStock);
    }
    if (bucket === null) continue;
    if (targetUnits === 0) {
      alreadyCoveredCount++;
      continue;  // stock already meets monthly need, skip from buy plan
    }
    candidates.push({
      itemId: r.itemId, name: r.name, type: r.type, subgroup: r.subgroup,
      units: r.units, velocityPerMonth: r.velocityPerMonth,
      unitCost: r.unitCost, unitRetail: r.unitRetail, marginPct: r.marginPct,
      loyverseSupplier: r.loyverseSupplier, currentStock: r.currentStock,
      bucket, targetUnits,
      totalCost: r.unitCost * targetUnits,
      expectedProfit: (r.unitRetail - r.unitCost) * targetUnits,
      marginNorm: 0, velocityNorm: 0, baseScore: 0,
    });
  }
  const coreCandidates  = candidates.filter(c => c.bucket === "core");
  const probeCandidates = candidates.filter(c => c.bucket === "probe");
  console.log(`  Core candidates:   ${coreCandidates.length}`);
  console.log(`  Probe candidates:  ${probeCandidates.length}`);
  console.log(`  Уже на складе (не закупаем): ${alreadyCoveredCount} SKU`);

  // 7. Normalize within type within bucket, compute score
  for (const bucket of ["core", "probe"] as Bucket[]) {
    const inBucket = candidates.filter(c => c.bucket === bucket);
    for (const t of ["Красное", "Белое", "Игристое"] as WineType[]) {
      const inType = inBucket.filter(c => c.type === t);
      const maxMargin   = Math.max(...inType.map(c => c.marginPct), 0.0001);
      const maxVelocity = Math.max(...inType.map(c => c.velocityPerMonth), 0.0001);
      for (const c of inType) {
        c.marginNorm   = c.marginPct / maxMargin;
        c.velocityNorm = c.velocityPerMonth / maxVelocity;
        c.baseScore    = params.w_margin * c.marginNorm + params.w_velocity * c.velocityNorm;
      }
    }
  }

  // 8. Budget split
  const probeBudget = params.budget * params.probe_budget_pct / 100;
  const coreBudget  = params.budget - probeBudget;
  console.log(`  Core budget: ${Math.round(coreBudget).toLocaleString("ru-RU")} ฿ · Probe budget: ${Math.round(probeBudget).toLocaleString("ru-RU")} ฿`);

  // 9. Type budget allocation within CORE (probe is small enough to skip caps)
  const typeUnits = { "Красное": 0, "Белое": 0, "Игристое": 0 };
  for (const c of coreCandidates) typeUnits[c.type] += c.units;
  const totalUnits = typeUnits["Красное"] + typeUnits["Белое"] + typeUnits["Игристое"];
  const typeShare: Record<WineType, number> = {
    "Красное":  totalUnits > 0 ? typeUnits["Красное"]  / totalUnits : 0,
    "Белое":    totalUnits > 0 ? typeUnits["Белое"]    / totalUnits : 0,
    "Игристое": totalUnits > 0 ? typeUnits["Игристое"] / totalUnits : 0,
  };
  const typeBudget: Record<WineType, number> = {
    "Красное":  coreBudget * typeShare["Красное"],
    "Белое":    coreBudget * typeShare["Белое"],
    "Игристое": coreBudget * typeShare["Игристое"],
  };
  const typeSpent: Record<WineType, number> = { "Красное": 0, "Белое": 0, "Игристое": 0 };

  // Subgroup caps within core
  const subgroupUnits = new Map<string, number>();
  const subgroupBudget = new Map<string, number>();
  const subgroupSpent  = new Map<string, number>();
  const subgroupTargetUnits = new Map<string, number>();
  for (const c of coreCandidates) {
    const k = `${c.type}|${c.subgroup}`;
    subgroupUnits.set(k, (subgroupUnits.get(k) ?? 0) + c.units);
  }
  for (const [k, u] of subgroupUnits) {
    const type = k.split("|")[0] as WineType;
    if (typeUnits[type] === 0) continue;
    const share = u / typeUnits[type];
    subgroupBudget.set(k, typeBudget[type] * share);
    subgroupSpent.set(k, 0);
    const sub = k.split("|")[1];
    const inSub = coreCandidates.filter(c => c.type === type && c.subgroup === sub);
    const avgCost = inSub.length > 0 ? inSub.reduce((s, c) => s + c.unitCost, 0) / inSub.length : 1;
    subgroupTargetUnits.set(k, (typeBudget[type] * share) / Math.max(avgCost, 1));
  }

  // 10. CORE greedy selection
  console.log("\n[3/4] Core greedy selection...");
  const picked = new Set<string>();
  const subgroupPicked = new Map<string, number>();
  let coreSpent = 0;
  let coreProfit = 0;

  function effectiveScore(c: Candidate): number {
    const k = `${c.type}|${c.subgroup}`;
    const target = subgroupTargetUnits.get(k) ?? 0;
    const current = subgroupPicked.get(k) ?? 0;
    const deficit = target > 0 ? Math.max(0, 1 - current / target) : 0;
    return c.baseScore + params.w_balance * deficit;
  }

  function tryPickCore(c: Candidate, ignoreTypeCap = false, ignoreCountryCap = false): boolean {
    if (picked.has(c.itemId)) return false;
    if (coreSpent + c.totalCost > coreBudget) return false;
    if (params.enforce_type_caps && !ignoreTypeCap) {
      if (typeSpent[c.type] + c.totalCost > typeBudget[c.type]) return false;
    }
    const k = `${c.type}|${c.subgroup}`;
    if (params.enforce_country_caps && !ignoreCountryCap) {
      const cap = subgroupBudget.get(k) ?? 0;
      if ((subgroupSpent.get(k) ?? 0) + c.totalCost > cap) return false;
    }
    picked.add(c.itemId);
    coreSpent += c.totalCost;
    coreProfit += c.expectedProfit;
    typeSpent[c.type] += c.totalCost;
    subgroupSpent.set(k, (subgroupSpent.get(k) ?? 0) + c.totalCost);
    subgroupPicked.set(k, (subgroupPicked.get(k) ?? 0) + c.targetUnits);
    return true;
  }

  // Phase 1: coverage — top-1 from each core subgroup
  const bySubgroup = new Map<string, Candidate[]>();
  for (const c of coreCandidates) {
    const k = `${c.type}|${c.subgroup}`;
    if (!bySubgroup.has(k)) bySubgroup.set(k, []);
    bySubgroup.get(k)!.push(c);
  }
  for (const arr of bySubgroup.values()) {
    arr.sort((a, b) => b.baseScore - a.baseScore);
    for (const c of arr) {
      if (tryPickCore(c, false, true)) break;
    }
  }
  console.log(`  Phase 1 (coverage): ${[...picked].length} positions, ${Math.round(coreSpent).toLocaleString("ru-RU")} ฿`);

  // Phase 2: greedy fill of core
  let safety = coreCandidates.length * 2;
  while (safety-- > 0) {
    const remaining = coreCandidates.filter(c => !picked.has(c.itemId) && c.totalCost <= coreBudget - coreSpent);
    if (remaining.length === 0) break;
    remaining.sort((a, b) => effectiveScore(b) / Math.max(b.unitCost, 1) - effectiveScore(a) / Math.max(a.unitCost, 1));
    let progress = false;
    for (const c of remaining) {
      if (tryPickCore(c)) { progress = true; break; }
    }
    if (!progress) break;
  }
  console.log(`  Phase 2 (fill): ${[...picked].length} positions, ${Math.round(coreSpent).toLocaleString("ru-RU")} ฿`);

  // Phase 3: relax caps if core_budget under-utilized
  if ((params.enforce_type_caps || params.enforce_country_caps) && coreSpent < coreBudget * 0.95) {
    safety = coreCandidates.length;
    while (safety-- > 0) {
      const remaining = coreCandidates.filter(c => !picked.has(c.itemId) && c.totalCost <= coreBudget - coreSpent);
      if (remaining.length === 0) break;
      remaining.sort((a, b) => effectiveScore(b) / Math.max(b.unitCost, 1) - effectiveScore(a) / Math.max(a.unitCost, 1));
      let progress = false;
      for (const c of remaining) {
        if (tryPickCore(c, true, true)) { progress = true; break; }
      }
      if (!progress) break;
    }
    console.log(`  Phase 3 (relax caps): ${[...picked].length} positions, ${Math.round(coreSpent).toLocaleString("ru-RU")} ฿`);
  }

  // 11. PROBE selection — sort by margin × score density, take while probe_budget allows
  console.log("\n[3/4] Probe selection...");
  let probeSpent = 0;
  let probeProfit = 0;
  const probeSorted = [...probeCandidates]
    .sort((a, b) => (b.marginPct * b.baseScore) / Math.max(b.unitCost, 1) - (a.marginPct * a.baseScore) / Math.max(a.unitCost, 1));
  for (const c of probeSorted) {
    if (probeSpent + c.totalCost > probeBudget) continue;
    picked.add(c.itemId);
    probeSpent += c.totalCost;
    probeProfit += c.expectedProfit;
  }
  console.log(`  Probe: ${probeCandidates.filter(c => picked.has(c.itemId)).length} positions, ${Math.round(probeSpent).toLocaleString("ru-RU")} ฿`);

  // Sort final list: bucket → type → subgroup → profit desc
  const pickedList = candidates.filter(c => picked.has(c.itemId));
  pickedList.sort((a, b) => {
    const bucketOrder = { "core": 0, "probe": 1 };
    if (bucketOrder[a.bucket] !== bucketOrder[b.bucket]) return bucketOrder[a.bucket] - bucketOrder[b.bucket];
    const typeOrder = { "Красное": 0, "Белое": 1, "Игристое": 2 };
    if (typeOrder[a.type] !== typeOrder[b.type]) return typeOrder[a.type] - typeOrder[b.type];
    if (a.subgroup !== b.subgroup) return a.subgroup.localeCompare(b.subgroup);
    return b.expectedProfit - a.expectedProfit;
  });

  const totalSpent  = coreSpent + probeSpent;
  const totalProfit = coreProfit + probeProfit;
  console.log(`\n  TOTAL: ${pickedList.length} позиций · ${Math.round(totalSpent).toLocaleString("ru-RU")} ฿ закуп · ${Math.round(totalProfit).toLocaleString("ru-RU")} ฿ ожидаемая прибыль`);
  console.log(`         core: ${pickedList.filter(c => c.bucket === "core").length} поз · ${Math.round(coreSpent).toLocaleString("ru-RU")} ฿ · ${Math.round(coreProfit).toLocaleString("ru-RU")} ฿ profit`);
  console.log(`         probe: ${pickedList.filter(c => c.bucket === "probe").length} поз · ${Math.round(probeSpent).toLocaleString("ru-RU")} ฿ · ${Math.round(probeProfit).toLocaleString("ru-RU")} ฿ profit`);

  // 12. Supplier lookup
  console.log("\n[4/4] Looking up suppliers in price-service...");
  const supplierMap = new Map<string, Supplier[]>();
  let lookupCount = 0;
  for (const c of pickedList) {
    const s = await findSuppliers(c.name);
    supplierMap.set(c.itemId, s);
    if (s.length > 0) lookupCount++;
  }
  console.log(`  Suppliers found for ${lookupCount}/${pickedList.length} positions.`);

  // 13. Write output
  await writeMatrix(
    pickedList, supplierMap, params,
    typeShare, typeBudget, typeSpent,
    coreBudget, coreSpent, coreProfit,
    probeBudget, probeSpent, probeProfit,
    totalSpent, totalProfit,
    stockMonthlyRevenue, stockMonthlyProfit,
    fromIso, toIso,
  );
  console.log(`\n  → https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);
}

// ─── Output writer ─────────────────────────────────────────────────────────

async function writeMatrix(
  picked: Candidate[],
  supplierMap: Map<string, Supplier[]>,
  params: MatrixParams,
  typeShare: Record<WineType, number>,
  typeBudget: Record<WineType, number>,
  typeSpent: Record<WineType, number>,
  coreBudget: number, coreSpent: number, coreProfit: number,
  probeBudget: number, probeSpent: number, probeProfit: number,
  totalSpent: number, totalProfit: number,
  stockMonthlyRevenue: number, stockMonthlyProfit: number,
  fromDate: string,
  toDate: string,
) {
  const sheetId = await ensureTab(MATRIX_TAB);
  await clearTab(sheetId);

  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };

  const headers = [
    "№", "Пул", "Тип", "Подгруппа", "Название", "Склад", "Купить", "Закуп ฿", "Сумма закупа",
    "Розница ฿", "Маржа %", "Прибыль", "Скор", "Поставщик (Loyverse)", "Цены price-service",
  ];
  const nCols = headers.length;
  const rows: any[][] = [];

  // Title
  rows.push([`Закупочная матрица · бюджет ${params.budget.toLocaleString("ru-RU")} ฿ (core ${(100 - params.probe_budget_pct)}% / probe ${params.probe_budget_pct}%) · период ${fromDate} → ${toDate}`]);

  // Parameter readout
  rows.push([]);
  rows.push(["Параметр", "Значение"]);
  const paramHdrRow = rows.length - 1;
  rows.push(["Общий бюджет",                params.budget]);
  rows.push(["% на эксперимент",            params.probe_budget_pct]);
  rows.push(["Недель запаса",               params.target_weeks_of_stock]);
  rows.push(["Вес маржи",                   params.w_margin]);
  rows.push(["Вес velocity",                params.w_velocity]);
  rows.push(["Вес сбалансированности",      params.w_balance]);
  rows.push(["Период истории, мес.",        params.period_months]);
  rows.push(["Лимиты по типам (1/0)",       params.enforce_type_caps]);
  rows.push(["Лимиты по странам (1/0)",     params.enforce_country_caps]);
  rows.push(["Min маржа (общий фильтр)",    params.min_margin_pct]);
  rows.push(["Core: min velocity бут/мес",  params.core_min_velocity]);
  rows.push(["Core: min партия",            params.core_min_target_units]);
  rows.push(["Core: min розница ฿",         params.core_min_unit_retail]);
  rows.push(["Probe: min маржа %",          params.probe_min_margin_pct]);
  const paramEndRow = rows.length;

  // Stock forecast
  rows.push([]);
  rows.push(["Прогноз без новых закупок (продажи существующего склада)"]);
  const stockHdrRow = rows.length - 1;
  rows.push(["  Выручка/мес со склада",  Math.round(stockMonthlyRevenue)]);
  rows.push(["  Маржа/мес со склада",    Math.round(stockMonthlyProfit)]);
  rows.push(["  Маржа/мес от новой закупки",  Math.round(totalProfit)]);
  rows.push(["  ИТОГО прогноз маржи",    Math.round(stockMonthlyProfit + totalProfit)]);
  const stockEndRow = rows.length;

  // CORE / PROBE summary
  rows.push([]);
  rows.push(["Пул", "Бюджет", "Потрачено", "Позиций", "Купить бут.", "Маржа от закупки"]);
  const poolHdrRow = rows.length - 1;
  const coreList  = picked.filter(c => c.bucket === "core");
  const probeList = picked.filter(c => c.bucket === "probe");
  rows.push(["ОСНОВА (core)",       Math.round(coreBudget),  Math.round(coreSpent),  coreList.length,  coreList.reduce((s, c) => s + c.targetUnits, 0),  Math.round(coreProfit)]);
  rows.push(["ЭКСПЕРИМЕНТ (probe)", Math.round(probeBudget), Math.round(probeSpent), probeList.length, probeList.reduce((s, c) => s + c.targetUnits, 0), Math.round(probeProfit)]);
  rows.push(["ИТОГО",               params.budget,           Math.round(totalSpent), picked.length,    picked.reduce((s, c) => s + c.targetUnits, 0),    Math.round(totalProfit)]);
  const poolEndRow = rows.length;

  // Type allocation (core only, with shares)
  rows.push([]);
  rows.push(["Тип (внутри core)", "Доля продаж", "Бюджет", "Потрачено", "Позиций", "Бутылок", "Прибыль"]);
  const allocHdrRow = rows.length - 1;
  for (const t of ["Красное", "Белое", "Игристое"] as WineType[]) {
    const list = coreList.filter(c => c.type === t);
    const units = list.reduce((s, c) => s + c.targetUnits, 0);
    const profit = list.reduce((s, c) => s + c.expectedProfit, 0);
    rows.push([t, Math.round(typeShare[t] * 1000) / 10, Math.round(typeBudget[t]), Math.round(typeSpent[t]), list.length, units, Math.round(profit)]);
  }
  rows.push(["ИТОГО core", 100, Math.round(coreBudget), Math.round(coreSpent), coreList.length, coreList.reduce((s, c) => s + c.targetUnits, 0), Math.round(coreProfit)]);
  const allocEndRow = rows.length;

  // Detail header
  rows.push([]);
  rows.push(headers);
  const detailHdrRow = rows.length - 1;
  const detailStart = rows.length;

  picked.forEach((c, idx) => {
    const sups = supplierMap.get(c.itemId) ?? [];
    const supText = sups.length > 0
      ? sups.map(s => {
          const tail = [s.year, s.volume].filter(Boolean).join(", ");
          return `${s.itemName} — ${Math.round(s.price)} ฿ · ${s.name}${tail ? ` · ${tail}` : ""}`;
        }).join("\n")
      : "—";
    rows.push([
      idx + 1,
      c.bucket === "core" ? "Основа" : "Эксперимент",
      c.type,
      c.subgroup,
      c.name,
      c.currentStock,
      c.targetUnits,
      Math.round(c.unitCost),
      Math.round(c.totalCost),
      Math.round(c.unitRetail),
      Math.round(c.marginPct * 1000) / 10,
      Math.round(c.expectedProfit),
      Math.round(c.baseScore * 100) / 100,
      c.loyverseSupplier,
      supText,
    ]);
  });
  const detailEnd = rows.length;

  await writeRows(sheetId, 0, 0, rows);

  // ── Formatting ──
  const fmt: any[] = [];
  fmt.push({
    updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" },
  });
  // Column widths: №, Пул, Тип, Подгруппа, Название, Склад, Купить, Закуп, Сумма закупа, Розница, Маржа %, Прибыль, Скор, Поставщик, Цены
  const widths = [50, 110, 90, 200, 360, 70, 80, 100, 120, 100, 90, 110, 70, 200, 520];
  for (let i = 0; i < widths.length; i++) {
    fmt.push({ updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: widths[i] }, fields: "pixelSize",
    }});
  }
  // Title
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols }, mergeType: "MERGE_ALL" } });
  // Param block
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: paramHdrRow, endRowIndex: paramHdrRow + 1, startColumnIndex: 0, endColumnIndex: 2 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  // Param value column: budget row gets ฿ format, others int
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: paramHdrRow + 1, endRowIndex: paramHdrRow + 2, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: paramHdrRow + 2, endRowIndex: paramEndRow, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // Stock forecast block
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: stockHdrRow, endRowIndex: stockHdrRow + 1, startColumnIndex: 0, endColumnIndex: 2 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.40, blue: 0.20 }, textFormat: { bold: true, foregroundColor: white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: stockHdrRow, endRowIndex: stockHdrRow + 1, startColumnIndex: 0, endColumnIndex: 2 }, mergeType: "MERGE_ALL" } });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: stockHdrRow + 1, endRowIndex: stockEndRow, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT", textFormat: { bold: true } } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment,textFormat)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: stockEndRow - 1, endRowIndex: stockEndRow, startColumnIndex: 0, endColumnIndex: 2 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.97, blue: 0.93 } } },
      fields: "userEnteredFormat.backgroundColor",
    },
  });

  // Pool block (CORE / PROBE summary)
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: poolHdrRow, endRowIndex: poolHdrRow + 1, startColumnIndex: 0, endColumnIndex: 6 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.45, green: 0.36, blue: 0.08 }, textFormat: { bold: true, foregroundColor: white }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: poolHdrRow + 1, endRowIndex: poolEndRow, startColumnIndex: 1, endColumnIndex: 3 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: poolHdrRow + 1, endRowIndex: poolEndRow, startColumnIndex: 3, endColumnIndex: 5 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: poolHdrRow + 1, endRowIndex: poolEndRow, startColumnIndex: 5, endColumnIndex: 6 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // pool ИТОГО row
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: poolEndRow - 1, endRowIndex: poolEndRow, startColumnIndex: 0, endColumnIndex: 6 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // Allocation block (core type breakdown)
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: allocHdrRow, endRowIndex: allocHdrRow + 1, startColumnIndex: 0, endColumnIndex: 7 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: allocHdrRow + 1, endRowIndex: allocEndRow, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: allocHdrRow + 1, endRowIndex: allocEndRow, startColumnIndex: 2, endColumnIndex: 4 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: allocHdrRow + 1, endRowIndex: allocEndRow, startColumnIndex: 4, endColumnIndex: 6 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: allocHdrRow + 1, endRowIndex: allocEndRow, startColumnIndex: 6, endColumnIndex: 7 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: allocEndRow - 1, endRowIndex: allocEndRow, startColumnIndex: 0, endColumnIndex: 7 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  // Detail header
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: detailHdrRow, endRowIndex: detailHdrRow + 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.55, green: 0.13, blue: 0.13 }, textFormat: { bold: true, foregroundColor: white }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // Detail rows: numeric formats
  // cols: 0=№ 1=Пул 2=Тип 3=Подгруппа 4=Название 5=Склад 6=Купить 7=Закуп 8=Сумма закупа 9=Розница 10=Маржа% 11=Прибыль 12=Скор 13=Поставщик 14=Цены
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: detailStart, endRowIndex: detailEnd, startColumnIndex: 5, endColumnIndex: 7 }, cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: detailStart, endRowIndex: detailEnd, startColumnIndex: 7, endColumnIndex: 10 }, cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: detailStart, endRowIndex: detailEnd, startColumnIndex: 10, endColumnIndex: 11 }, cell: { userEnteredFormat: { numberFormat: FMT_PCT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: detailStart, endRowIndex: detailEnd, startColumnIndex: 11, endColumnIndex: 12 }, cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: detailStart, endRowIndex: detailEnd, startColumnIndex: 12, endColumnIndex: 13 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.00" }, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: detailStart, endRowIndex: detailEnd, startColumnIndex: 14, endColumnIndex: 15 }, cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP", textFormat: { fontSize: 9 } } }, fields: "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: detailStart, endRowIndex: detailEnd, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { horizontalAlignment: "CENTER", textFormat: { foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } } } }, fields: "userEnteredFormat(horizontalAlignment,textFormat)" } });
  fmt.push({ repeatCell: { range: { sheetId, startRowIndex: detailStart, endRowIndex: detailEnd, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 9 }, horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat(textFormat,horizontalAlignment)" } });
  // Stripes per type, with probe rows tinted purple
  picked.forEach((c, idx) => {
    const r = detailStart + idx;
    let bg;
    if (c.bucket === "probe") {
      bg = { red: 0.95, green: 0.92, blue: 0.99 };  // soft purple = experimental
    } else {
      bg = c.type === "Красное"  ? { red: 0.99, green: 0.95, blue: 0.95 } :
           c.type === "Белое"    ? { red: 0.99, green: 0.97, blue: 0.88 } :
                                   { red: 0.92, green: 0.95, blue: 0.99 };
    }
    fmt.push({
      repeatCell: {
        range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: nCols },
        cell: { userEnteredFormat: { backgroundColor: bg } },
        fields: "userEnteredFormat.backgroundColor",
      },
    });
  });

  await sheets("POST", ":batchUpdate", { requests: fmt });
  console.log(`  ✓ "${MATRIX_TAB}" written.`);
}

main().catch(e => { console.error(e); process.exit(1); });
