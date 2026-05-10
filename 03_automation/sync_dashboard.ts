/**
 * sync_dashboard.ts
 * Writes sales data to "Данные" sheet, draws charts in "Dashboard" sheet.
 *
 * Usage:
 *   npx tsx scripts/sync_dashboard.ts            # current month
 *   npx tsx scripts/sync_dashboard.ts 2026-03    # specific month
 */

import dotenv from "dotenv";
import { BANK_TRANSFER_TYPE_ID, isB2BCustomerName } from "./lib/b2b.js";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: ".env.local" });

const SHEET_ID   = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const DATA_TAB   = "Данные";
const DASH_TAB   = "Dashboard";

// От этого месяца (включительно) на графике "Помесячно" показываем план (Факт LY ×1.25)
// и факт 2026 линией на правой оси. До этого месяца — только фактический столбец.
const PLAN_START_YM = "2026-04";

// 1% от выручки добавляется к обязательным расходам — премиальный фонд по
// текущей системе мотивации. Применяется и к историческим месяцам.
const REVENUE_BONUS_PCT = 0.01;

// Буфер на непредвиденные расходы — добавляется к месячным расходам
// в P&L-графике «Прибыль владельца». Параметризован, не привязан к данным.
const UNEXPECTED_BUFFER = 15_000;

// Старт окна для P&L-графика. Раньше 2024-08 в данных был magnitude-bug
// (фикс 2d540af), поэтому исторический ряд начинаем с 2025-01 — там цифры
// уже чистые.
const PNL_START_YM = "2025-01";

const LOYVERSE_TOKEN      = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID    = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

// ─── Bangkok helpers ───────────────────────────────────────────────────────

function bangkokNow() { return new Date(Date.now() + 7 * 3600_000); }

function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad  = (n: number) => String(n).padStart(2, "0");
  return { from: `${ym}-01`, to: `${ym}-${pad(last)}`, days: last };
}

function prevYear(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return `${y - 1}-${String(m).padStart(2, "0")}`;
}

function monthLabel(ym: string) {
  const names = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
  const [y, m] = ym.split("-").map(Number);
  return `${names[m - 1]} ${y}`;
}

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
    requests: [
      { unmergeCells: { range: { sheetId } } },
      { updateCells: { range: { sheetId }, fields: "userEnteredValue,userEnteredFormat,dataValidation" } },
    ],
  });
}

async function writeValues(tab: string, range: string, values: any[][]) {
  await sheets("PUT", `/values/${encodeURIComponent(`${tab}!${range}`)}?valueInputOption=RAW`, {
    range: `${tab}!${range}`, majorDimension: "ROWS", values,
  });
}

async function deleteCharts(sheetId: number) {
  const meta = await sheets("GET", "");
  const targetSheet = (meta.sheets ?? []).find((s: any) => s.properties.sheetId === sheetId);
  const charts: any[] = targetSheet?.charts ?? [];
  if (!charts.length) return;
  await sheets("POST", ":batchUpdate", {
    requests: charts.map((c: any) => ({ deleteEmbeddedObject: { objectId: c.chartId } })),
  });
}

// ─── Обязательные расходы ─────────────────────────────────────────────────
// Лист "Обязательные" заполняется вручную: A=статья, B=сумма ฿, C=день месяца.
// Сумма B2:B20 — текущая месячная отсечка по постоянным расходам (ФОТ, аренда,
// налоги, расходники). Применяем единое значение и к историческим месяцам.

async function fetchMandatoryFixed(): Promise<number> {
  try {
    const r = await sheets("GET", `/values/${encodeURIComponent("Обязательные!B2:B20")}`);
    const rows = (r.values ?? []) as any[][];
    let sum = 0;
    for (const row of rows) {
      const cell = row[0];
      if (cell == null || cell === "") continue;
      const cleaned = String(cell).replace(/[^\d.\-]/g, "");
      const v = parseFloat(cleaned);
      if (!isNaN(v)) sum += v;
    }
    return sum;
  } catch (e) {
    console.warn(`  ⚠ Не удалось прочитать "Обязательные": ${(e as Error).message}`);
    return 0;
  }
}

// ─── Ликвидность месяца ───────────────────────────────────────────────────
// Метрика: (Остаток нач. + Выручка) ≥ Кредиторка к оплате (не-Paid) в этом месяце.
//   • Остаток нач. — из Rolling, колонка B недели, в которую попадает 1-е число.
//     Погрешность 0–6 дней (если 1-е ≠ понедельник) — приемлемо.
//   • Кредиторка — лист "Кредиторка" E (DD.MM.YYYY due), F (amount), G (status).
//     Считаем не-Paid по due date в текущем месяце.

const RU_MONTH_SHORT = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];

function parseRollingWeekStart(label: string, contextYear: number): string | null {
  const t = (label ?? "").trim();
  if (!t) return null;
  // Same-month: "20–26 апр". Cross-month: "29 июн – 5 июл".
  let m = t.match(/^(\d+)\s*[–-]\s*\d+\s+([а-я]+)$/i);
  let day: number, mo: string;
  if (m) { day = parseInt(m[1], 10); mo = m[2].toLowerCase(); }
  else {
    m = t.match(/^(\d+)\s+([а-я]+)\s*[–-]\s*\d+\s+[а-я]+$/i);
    if (!m) return null;
    day = parseInt(m[1], 10);
    mo = m[2].toLowerCase();
  }
  const moIdx = RU_MONTH_SHORT.indexOf(mo);
  if (moIdx < 0) return null;
  return `${contextYear}-${String(moIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseSheetDate(raw: any): { month: number; year: number } | null {
  // UNFORMATTED_VALUE: text "DD.MM.YYYY" если ячейка-текст; число (Sheets serial) если ячейка-дата.
  if (typeof raw === "number" && raw > 0) {
    const ms = (raw - 25569) * 86_400_000; // Sheets epoch: 1899-12-30 → UNIX 25569
    const d = new Date(ms);
    return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
  }
  if (typeof raw === "string") {
    const m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) return { month: parseInt(m[2], 10), year: parseInt(m[3], 10) };
  }
  return null;
}

async function fetchOpeningBalanceForMonth(currentYM: string): Promise<number> {
  try {
    const firstOfMonth = new Date(`${currentYM}-01T00:00:00Z`);
    const dow = firstOfMonth.getUTCDay();
    const daysSinceMon = (dow + 6) % 7;
    const targetMondayDate = new Date(firstOfMonth.getTime() - daysSinceMon * 86_400_000);
    const targetMonday = targetMondayDate.toISOString().slice(0, 10);
    const targetYear = targetMondayDate.getUTCFullYear();

    const r = await sheets("GET", `/values/${encodeURIComponent("Rolling!A4:B60")}?valueRenderOption=UNFORMATTED_VALUE`);
    const rows = (r.values ?? []) as any[][];

    for (const row of rows) {
      const iso = parseRollingWeekStart(String(row[0] ?? ""), targetYear);
      if (iso === targetMonday) {
        const v = Number(row[1]);
        return Number.isFinite(v) ? v : 0;
      }
    }
    console.warn(`  ⚠ В Rolling нет недели с понедельником ${targetMonday}`);
    return 0;
  } catch (e) {
    console.warn(`  ⚠ Не удалось прочитать Rolling: ${(e as Error).message}`);
    return 0;
  }
}

async function fetchKreditorkaDueForMonth(currentYM: string): Promise<number> {
  try {
    const r = await sheets("GET", `/values/${encodeURIComponent("Кредиторка!E2:G500")}?valueRenderOption=UNFORMATTED_VALUE`);
    const rows = (r.values ?? []) as any[][];
    const [yr, mo] = currentYM.split("-").map(Number);
    let sum = 0;
    for (const row of rows) {
      const status = String(row[2] ?? "").trim().toUpperCase();
      if (status === "PAID") continue;
      const amount = Number(row[1]);
      if (!Number.isFinite(amount) || amount === 0) continue;
      const due = parseSheetDate(row[0]);
      if (!due) continue;
      if (due.year === yr && due.month === mo) sum += amount;
    }
    return sum;
  } catch (e) {
    console.warn(`  ⚠ Не удалось прочитать Кредиторку: ${(e as Error).message}`);
    return 0;
  }
}

// Дебиторка: ожидаемые поступления B2B в текущем месяце.
// Та же логика что и в Rolling fDeb (create_cashflow_rolling.ts):
//   • Paid    → попадает в месяц по «Дата оплаты» (col G)
//   • не-Paid → попадает в месяц по «Оплатить до»  (col D)
//   • строки с комментарием «Юра» (col H) исключаем — старый владелец.

async function fetchDebitorkaInForMonth(currentYM: string): Promise<number> {
  try {
    // D=Оплатить до, E=Сумма, F=Status, G=Дата оплаты, H=Комментарий
    const r = await sheets("GET", `/values/${encodeURIComponent("Дебиторка!D2:H300")}?valueRenderOption=UNFORMATTED_VALUE`);
    const rows = (r.values ?? []) as any[][];
    const [yr, mo] = currentYM.split("-").map(Number);
    let sum = 0;
    for (const row of rows) {
      const comment = String(row[4] ?? "").trim().toUpperCase();
      if (comment === "ЮРА") continue;
      const amount = Number(row[1]);
      if (!Number.isFinite(amount) || amount === 0) continue;
      const status = String(row[2] ?? "").trim().toUpperCase();
      const dateRaw = status === "PAID" ? row[3] : row[0];
      const d = parseSheetDate(dateRaw);
      if (!d) continue;
      if (d.year === yr && d.month === mo) sum += amount;
    }
    return sum;
  } catch (e) {
    console.warn(`  ⚠ Не удалось прочитать Дебиторку: ${(e as Error).message}`);
    return 0;
  }
}

// ─── Закупки по месяцам (Supabase purchase_orders) ──────────────────────────
// Группируем total_thb по месяцу order_date, статус Closed/CLOSED.
// Используется в P&L-графике с месячным сдвигом: закупки месяца N оплачиваются
// (по 30-day terms) в месяце N+1, поэтому для P&L месяца N берём закупки N-1.
//
// Исключаем:
//   • поставщики с inventory.supplier.type = 'consignment' — оплата по факту
//     реализации, не через 30 дней. Источник: mission-control / supplier UI.
//   • PO с purchase_orders.exclude_from_cashflow = true — точечный override
//     для криво заведённых записей. Управляется в /m/purchases (миграция 007).

async function fetchPurchaseTotalsByMonth(): Promise<Map<string, number>> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const out = new Map<string, number>();
  if (!url || !key) {
    console.warn("  ⚠ SUPABASE_URL/SERVICE_KEY не заданы — пропускаю закупки");
    return out;
  }
  try {
    // 1) Loadup of consignment supplier names (inventory.supplier.type = 'consignment')
    const sbInv = createClient(url, key, { db: { schema: "inventory" } });
    const { data: supRows, error: supErr } = await sbInv
      .from("supplier")
      .select("name,type");
    if (supErr) throw supErr;
    const consignmentNames = new Set<string>();
    for (const s of supRows ?? []) {
      if (String(s.type ?? "") === "consignment") {
        consignmentNames.add(String(s.name ?? "").trim().toLowerCase());
      }
    }

    // 2) Walk through PO history with pagination.
    // Cashflow inclusion logic:
    //   • cashflow_override = 'exclude' → SKIP (force-exclude)
    //   • cashflow_override = 'include' → KEEP (force-include, override consignment)
    //   • cashflow_override = 'auto'    → use supplier.type (consignment → SKIP)
    //
    // Defensive select: миграция 008 могла быть не применена → пробуем
    // с cashflow_override, при column-not-exist падаем на legacy SELECT
    // (только consignment-фильтр, без overrides).
    const sb = createClient(url, key);
    let hasOverrideCol = true;
    let from = 0;
    let kept = 0, forceIn = 0, forceOut = 0, autoOut = 0;
    while (true) {
      const cols = hasOverrideCol
        ? "order_date,total_thb,status,supplier,cashflow_override"
        : "order_date,total_thb,status,supplier";
      const { data, error } = await sb
        .from("purchase_orders")
        .select(cols)
        .order("order_date", { ascending: true })
        .range(from, from + 999);
      if (error) {
        if (/column.*cashflow_override.*does not exist/i.test(error.message)) {
          console.warn("  ⚠ purchase_orders.cashflow_override ещё не существует — миграция 008 не применена. Только consignment-фильтр.");
          hasOverrideCol = false;
          continue; // retry same page without the column
        }
        throw error;
      }
      if (!data || data.length === 0) break;
      for (const r of (data as any[])) {
        const status = String(r.status ?? "").toUpperCase();
        if (status !== "CLOSED") continue;
        const override = hasOverrideCol ? String(r.cashflow_override ?? "auto") : "auto";
        if (override === "exclude") { forceOut++; continue; }
        if (override !== "include") {
          // 'auto' — falls back to supplier.type
          const supName = String(r.supplier ?? "").trim().toLowerCase();
          if (consignmentNames.has(supName)) { autoOut++; continue; }
        } else {
          forceIn++;
        }
        const ym = String(r.order_date ?? "").slice(0, 7);
        if (!ym) continue;
        const total = Number(r.total_thb ?? 0);
        if (!Number.isFinite(total)) continue;
        out.set(ym, (out.get(ym) ?? 0) + total);
        kept++;
      }
      if (data.length < 1000) break;
      from += 1000;
    }
    console.log(`  filter: ${kept} kept (incl. ${forceIn} force-include) · ${autoOut} auto-skipped (consignment) · ${forceOut} force-excluded`);
    return out;
  } catch (e) {
    console.warn(`  ⚠ Не удалось прочитать purchase_orders: ${(e as Error).message}`);
    return out;
  }
}

// ─── P&L по месяцам ─────────────────────────────────────────────────────────
// «Прибыль владельца» = Revenue месяца N − (Закупки N-1 + Обяз. + Buffer).
// Закупки сдвигаем на 1 месяц назад: PO с order_date в феврале оплачиваются
// в марте (30-day terms), поэтому покрываются выручкой марта.
//   • Обязательные — текущая сумма (нет исторических снапшотов)
//   • Buffer       — UNEXPECTED_BUFFER (15K)

interface PnLRow {
  ym:           string;     // 2025-01, 2025-02, ...
  revenue:      number;     // выручка месяца (Loyverse)
  purchasesPrev: number;    // закупки месяца N-1 (Supabase total_thb)
  obligatory:   number;     // постоянные расходы (текущее значение)
  buffer:       number;     // UNEXPECTED_BUFFER
  expenses:     number;     // sum
  profit:       number;     // revenue − expenses
}

function buildPnL(
  summary: Awaited<ReturnType<typeof fetchSummary>>,
  purchases: Map<string, number>,
  mandatoryFixed: number,
  startYM: string,
  endYM: string,
): PnLRow[] {
  // Map ym → revenue из summary (cur.total для всех ym, last.total для прошлого года).
  const revenueByYM = new Map<string, number>();
  for (const s of summary) {
    if (s.cur.total > 0) revenueByYM.set(s.ym, s.cur.total);
    // last — прошлогодний месяц, тот же ym минус год
    const [ly, lmo] = [Number(s.ym.slice(0, 4)) - 1, s.ym.slice(5, 7)];
    revenueByYM.set(`${ly}-${lmo}`, s.last.total);
  }

  const months: string[] = [];
  let [y, m] = startYM.split("-").map(Number);
  const [yEnd, mEnd] = endYM.split("-").map(Number);
  while (y < yEnd || (y === yEnd && m <= mEnd)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }

  const out: PnLRow[] = [];
  for (const ym of months) {
    const [yy, mm] = ym.split("-").map(Number);
    const prevY = mm === 1 ? yy - 1 : yy;
    const prevM = mm === 1 ? 12 : mm - 1;
    const prevYM = `${prevY}-${String(prevM).padStart(2, "0")}`;

    const revenue = revenueByYM.get(ym) ?? 0;
    const purchasesPrev = purchases.get(prevYM) ?? 0;
    const obligatory = mandatoryFixed;
    const buffer = UNEXPECTED_BUFFER;
    const expenses = purchasesPrev + obligatory + buffer;
    const profit = revenue - expenses;

    out.push({ ym, revenue, purchasesPrev, obligatory, buffer, expenses, profit });
  }
  return out;
}

// ─── Loyverse ──────────────────────────────────────────────────────────────

// B2B classification — single source of truth in lib/b2b.ts.
// Optimization: pre-resolve which Loyverse customer_ids match B2B_PATTERNS,
// so the per-receipt check is a Set lookup instead of a substring scan.

let _b2bIdsPromise: Promise<Set<string>> | null = null;
function getB2BCustomerIds(): Promise<Set<string>> {
  if (_b2bIdsPromise) return _b2bIdsPromise;
  _b2bIdsPromise = (async () => {
    const customers = await loyverseFetch<any>("/customers", "customers");
    const ids = new Set<string>();
    for (const c of customers) if (isB2BCustomerName(c.name ?? "")) ids.add(c.id);
    console.log(`  B2B customers matched by name: ${ids.size}`);
    return ids;
  })();
  return _b2bIdsPromise;
}

function isB2BReceipt(r: any, b2bIds: Set<string>): boolean {
  const hasBankTransfer = (r.payments ?? []).some((p: any) => p.payment_type_id === BANK_TRANSFER_TYPE_ID);
  return hasBankTransfer || (!!r.customer_id && b2bIds.has(r.customer_id));
}

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

interface DayData { revenue: number; gp: number; checks: number; }

interface PeriodStats {
  revenue: number; gp: number; checks: number; uniqueCustomers: number;
  retailRevenue: number; b2bRevenue: number;
}

async function fetchPeriod(from: string, to: string): Promise<PeriodStats> {
  const [receipts, b2bIds] = await Promise.all([
    loyverseFetch<any>(
      `/receipts?receipt_type=SALE&created_at_min=${new Date(from).toISOString()}&created_at_max=${new Date(to + "T23:59:59").toISOString()}`,
      "receipts"
    ),
    getB2BCustomerIds(),
  ]);
  let revenue = 0, gp = 0, checks = 0, retailRevenue = 0, b2bRevenue = 0;
  const customers = new Set<string>();
  for (const r of receipts) {
    let cost = 0;
    for (const li of r.line_items ?? []) cost += li.cost_total ?? 0;
    const rev = r.total_money ?? 0;
    revenue += rev;
    gp += rev - cost;
    checks++;
    if (r.customer_id) customers.add(r.customer_id);
    if (isB2BReceipt(r, b2bIds)) b2bRevenue += rev;
    else retailRevenue += rev;
  }
  return { revenue, gp, checks, uniqueCustomers: customers.size, retailRevenue, b2bRevenue };
}

async function fetchMonth(ym: string): Promise<{ byDay: Map<number,DayData>; total: number; totalGP: number; checks: number; uniqueCustomers: number; retailTotal: number; b2bTotal: number }> {
  const { from, to } = monthBounds(ym);
  const [receipts, b2bIds] = await Promise.all([
    loyverseFetch<any>(
      `/receipts?receipt_type=SALE&created_at_min=${new Date(from).toISOString()}&created_at_max=${new Date(to+"T23:59:59").toISOString()}`,
      "receipts"
    ),
    getB2BCustomerIds(),
  ]);
  const byDay = new Map<number, DayData>();
  const customers = new Set<string>();
  let total = 0, totalGP = 0, checks = 0, retailTotal = 0, b2bTotal = 0;
  for (const r of receipts) {
    const d = new Date(new Date(r.receipt_date).getTime() + 7 * 3600_000).getUTCDate();
    let cost = 0;
    for (const li of r.line_items ?? []) cost += li.cost_total ?? 0;
    const rev = r.total_money ?? 0;
    const gp  = rev - cost;
    const cur = byDay.get(d) ?? { revenue: 0, gp: 0, checks: 0 };
    byDay.set(d, { revenue: cur.revenue + rev, gp: cur.gp + gp, checks: cur.checks + 1 });
    total += rev; totalGP += gp; checks++;
    if (r.customer_id) customers.add(r.customer_id);
    if (isB2BReceipt(r, b2bIds)) b2bTotal += rev;
    else retailTotal += rev;
  }
  return { byDay, total, totalGP, checks, uniqueCustomers: customers.size, retailTotal, b2bTotal };
}

// ─── Weekly history (12 закрытых недель) ──────────────────────────────────
// Пишется на лист "Данные" в колонки P:S, оттуда Rolling берёт "Доход факт"
// через VLOOKUP. Был отдельный snapshot-лист "Закрытие" — удалён, чтобы
// данные всегда совпадали с дашбордом (единый источник — Loyverse).

interface WeeklyFact { weekStart: string; retail: number; b2b: number; total: number; }

async function fetchWeeklyHistory(numWeeks: number): Promise<WeeklyFact[]> {
  // Закрытые недели: offset -1 .. -numWeeks (текущая неделя исключена).
  const earliestMon = bangkokWeekBounds(-numWeeks).from;
  const lastSun     = bangkokWeekBounds(-1).to;

  const [receipts, b2bIds] = await Promise.all([
    loyverseFetch<any>(
      `/receipts?receipt_type=SALE&created_at_min=${new Date(earliestMon).toISOString()}&created_at_max=${new Date(lastSun + "T23:59:59").toISOString()}`,
      "receipts",
    ),
    getB2BCustomerIds(),
  ]);

  const buckets = new Map<string, { retail: number; b2b: number; total: number }>();
  for (let i = numWeeks; i >= 1; i--) {
    buckets.set(bangkokWeekBounds(-i).from, { retail: 0, b2b: 0, total: 0 });
  }

  for (const r of receipts) {
    // Bangkok-локальная дата чека → Monday той же недели (ISO).
    const ts = new Date(new Date(r.receipt_date).getTime() + 7 * 3600_000);
    const dow = ts.getUTCDay();
    const daysSinceMon = (dow + 6) % 7;
    const monMs = ts.getTime() - daysSinceMon * 86_400_000;
    const weekStart = new Date(monMs).toISOString().slice(0, 10);
    const bucket = buckets.get(weekStart);
    if (!bucket) continue;
    const rev = r.total_money ?? 0;
    bucket.total += rev;
    if (isB2BReceipt(r, b2bIds)) bucket.b2b += rev;
    else bucket.retail += rev;
  }

  return Array.from(buckets.entries())
    .map(([weekStart, v]) => ({ weekStart, retail: Math.round(v.retail), b2b: Math.round(v.b2b), total: Math.round(v.total) }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

// ─── Bangkok week bounds ───────────────────────────────────────────────────

function bangkokWeekBounds(offsetWeeks = 0): { from: string; to: string } {
  const now = bangkokNow();
  const dayOfWeek = now.getUTCDay(); // 0=Sun
  const daysSinceMon = (dayOfWeek + 6) % 7;
  const mondayMs = Date.now() + 7 * 3600_000 - daysSinceMon * 86_400_000 + offsetWeeks * 7 * 86_400_000;
  const sundayMs = mondayMs + 6 * 86_400_000;
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const to = offsetWeeks === 0 ? new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10) : fmt(sundayMs);
  return { from: fmt(mondayMs), to };
}

// ─── Build summary table rows ──────────────────────────────────────────────

interface TableRow { label: string; stats: PeriodStats; bold?: boolean; fixedFraction: number; }

async function fetchSummaryTable(
  currentYM: string,
  curData: Awaited<ReturnType<typeof fetchMonth>>,
  summary: Awaited<ReturnType<typeof fetchSummary>>,
): Promise<TableRow[]> {
  const now = bangkokNow();
  const curYMD = now.toISOString().slice(0, 10);

  // Current year from summary
  const [cy] = currentYM.split("-").map(Number);

  // YTD: sum of all 2026 months in summary
  const ytdStats: PeriodStats = { revenue: 0, gp: 0, checks: 0, uniqueCustomers: 0, retailRevenue: 0, b2bRevenue: 0 };
  for (const { ym, cur } of summary) {
    if (ym.startsWith(String(cy))) {
      ytdStats.revenue += cur.total;
      ytdStats.gp += cur.totalGP;
      ytdStats.checks += cur.checks;
      ytdStats.uniqueCustomers += cur.uniqueCustomers;
      ytdStats.retailRevenue += cur.retailTotal;
      ytdStats.b2bRevenue += cur.b2bTotal;
    }
  }

  // Last year: reconstruct full prev-year, works for any summary length
  const lyStats: PeriodStats = { revenue: 0, gp: 0, checks: 0, uniqueCustomers: 0, retailRevenue: 0, b2bRevenue: 0 };
  const prevYr = cy - 1;
  const summaryYMSet = new Set(summary.map(s => s.ym));
  for (const { ym, cur, last } of summary) {
    const entryYear = +ym.slice(0, 4);
    const entryMo   = +ym.slice(5, 7);
    if (entryYear === prevYr) {
      // Direct prev-year month in summary (present when n > 12)
      lyStats.revenue         += cur.total;
      lyStats.gp              += cur.totalGP;
      lyStats.checks          += cur.checks;
      lyStats.uniqueCustomers += cur.uniqueCustomers;
      lyStats.retailRevenue   += cur.retailTotal;
      lyStats.b2bRevenue      += cur.b2bTotal;
    } else if (entryYear === cy) {
      // Current-year entry: only use its "last" if that prev-year month isn't already above
      const lyYM = `${prevYr}-${String(entryMo).padStart(2, "0")}`;
      if (!summaryYMSet.has(lyYM)) {
        lyStats.revenue         += last.total;
        lyStats.gp              += last.totalGP;
        lyStats.checks          += last.checks;
        lyStats.uniqueCustomers += last.uniqueCustomers;
        lyStats.retailRevenue   += last.retailTotal;
        lyStats.b2bRevenue      += last.b2bTotal;
      }
    }
  }

  // Fetch weeks + last month in parallel
  const thisWeek = bangkokWeekBounds(0);
  const lastWeek = bangkokWeekBounds(-1);
  const [cyN, cmN] = currentYM.split("-").map(Number);
  let lmY = cyN, lmM = cmN - 1;
  if (lmM === 0) { lmM = 12; lmY--; }
  const lastMonthYM = `${lmY}-${String(lmM).padStart(2, "0")}`;
  const { from: lmFrom, to: lmTo } = monthBounds(lastMonthYM);

  console.log(`  Fetching weeks + last month...`);
  const [thisWeekStats, lastWeekStats, lastMonthData] = await Promise.all([
    fetchPeriod(thisWeek.from, thisWeek.to),
    fetchPeriod(lastWeek.from, lastWeek.to),
    fetchMonth(lastMonthYM),
  ]);

  const curMonthStats: PeriodStats = {
    revenue: curData.total, gp: curData.totalGP,
    checks: curData.checks, uniqueCustomers: curData.uniqueCustomers,
    retailRevenue: curData.retailTotal, b2bRevenue: curData.b2bTotal,
  };
  const lastMonthStats: PeriodStats = {
    revenue: lastMonthData.total, gp: lastMonthData.totalGP,
    checks: lastMonthData.checks, uniqueCustomers: lastMonthData.uniqueCustomers,
    retailRevenue: lastMonthData.retailTotal, b2bRevenue: lastMonthData.b2bTotal,
  };

  // Доля месячных постоянных расходов на период:
  //   • Неделя — 7/30
  //   • Месяц — 1
  //   • YTD — кол-во прошедших месяцев + дробь текущего
  //   • Прошлый год — 12 месяцев
  const cmDays  = monthBounds(currentYM).days;
  const todayD  = bangkokNow().getUTCDate();
  const isCurYM = currentYM === `${bangkokNow().getUTCFullYear()}-${String(bangkokNow().getUTCMonth() + 1).padStart(2, "0")}`;
  const monthsYTD = isCurYM
    ? (currentYM.endsWith("01") ? todayD / cmDays : (Number(currentYM.slice(5, 7)) - 1) + todayD / cmDays)
    : Number(currentYM.slice(5, 7));

  return [
    { label: "Текущая неделя",   stats: thisWeekStats,  fixedFraction: 7 / 30 },
    { label: "Прошлая неделя",   stats: lastWeekStats,  fixedFraction: 7 / 30 },
    { label: "Текущий месяц",    stats: curMonthStats,  fixedFraction: 1 },
    { label: "Прошлый месяц",    stats: lastMonthStats, fixedFraction: 1 },
    { label: "С начала года",    stats: ytdStats,       fixedFraction: monthsYTD },
    { label: `${cy - 1} год`,    stats: lyStats, bold: true, fixedFraction: 12 },
  ];
}

function cumulative(byDay: Map<number,DayData>, dim: number, cutDay?: number): (number|null)[] {
  let run = 0;
  return Array.from({ length: dim }, (_, i) => {
    const day = i + 1;
    if (cutDay !== undefined && day > cutDay) return null;
    run += byDay.get(day)?.revenue ?? 0;
    return Math.round(run);
  });
}

// ─── Annual totals from summary (no extra API calls) ──────────────────────

interface Annuals {
  ytd: number;       // 2026 YTD fact
  full2025: number;  // 2025 full-year fact
  plan: number;      // full2025 × 1.25
  pct: number;       // ytd / plan × 100
  remaining: number;
  curYear: number;
  prevYear_: number;
}

function computeAnnuals(summary: Awaited<ReturnType<typeof fetchSummary>>): Annuals {
  let ytd = 0, full2025 = 0;
  const summaryYMSet = new Set(summary.map(s => s.ym));
  for (const { ym, cur, last } of summary) {
    const [y] = ym.split("-").map(Number);
    const mo  = +ym.slice(5, 7);
    if (y === 2026) {
      ytd += cur.total;
      // Only use last.total if that 2025 month isn't already in summary directly
      const lyYM = `2025-${String(mo).padStart(2, "0")}`;
      if (!summaryYMSet.has(lyYM)) full2025 += last.total;
    } else {
      full2025 += cur.total;
    }
  }
  const plan      = full2025 * 1.25;
  const pct       = plan > 0 ? (ytd / plan) * 100 : 0;
  const remaining = Math.max(0, plan - ytd);
  const curYear   = new Date(Date.now() + 7 * 3600_000).getUTCFullYear();
  return { ytd, full2025, plan, pct, remaining, curYear, prevYear_: curYear - 1 };
}

function emptyMonthData(): Awaited<ReturnType<typeof fetchMonth>> {
  return { byDay: new Map(), total: 0, totalGP: 0, checks: 0, uniqueCustomers: 0, retailTotal: 0, b2bTotal: 0 };
}

async function fetchSummary(currentYM: string, monthsBack = 6, monthsForward = 0) {
  const [cy, cm] = currentYM.split("-").map(Number);
  const months: string[] = [];
  // Прошлые месяцы + текущий
  for (let i = monthsBack - 1; i >= 0; i--) {
    let m = cm - i, y = cy;
    while (m <= 0) { m += 12; y--; }
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  // Будущие месяцы (для построения плана вперёд по году)
  for (let i = 1; i <= monthsForward; i++) {
    let m = cm + i, y = cy;
    while (m > 12) { m -= 12; y++; }
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  const rows = [];
  for (const ym of months) {
    const ly = prevYear(ym);
    const isFuture = ym > currentYM;
    process.stdout.write(`  ${ym} / ${ly}${isFuture ? " (план)" : ""}... `);
    // Для будущих месяцев пропускаем запрос cur — данных нет, всё равно нули.
    const [cur, last] = await Promise.all([
      isFuture ? Promise.resolve(emptyMonthData()) : fetchMonth(ym),
      fetchMonth(ly),
    ]);
    const plan = last.total * 1.25;
    const pct  = plan > 0 ? (cur.total / plan) * 100 : 0;
    console.log(`✓ ${Math.round(cur.total).toLocaleString()} / plan ${Math.round(plan).toLocaleString()} (${pct.toFixed(0)}%)`);
    rows.push({ ym, cur, last, plan, pct });
  }
  return rows;
}

// ─── Write data sheet ──────────────────────────────────────────────────────

async function writeDataSheet(
  dataSheetId: number,
  currentYM: string,
  curData: Awaited<ReturnType<typeof fetchMonth>>,
  lyData:  Awaited<ReturnType<typeof fetchMonth>>,
  summary: Awaited<ReturnType<typeof fetchSummary>>,
  todayDay: number,
  updatedAt: string,
  mandatoryFixed: number,
  weekly: WeeklyFact[],
  rollingAvg: number,
  pnl: PnLRow[],
) {
  await clearTab(dataSheetId);

  const { days: dim } = monthBounds(currentYM);
  const lyDim = monthBounds(prevYear(currentYM)).days;
  const lyYM  = prevYear(currentYM);

  const factArr = cumulative(curData.byDay, dim, todayDay);
  const lyArr   = cumulative(lyData.byDay, lyDim, lyDim);
  const planArr = Array.from({ length: dim }, (_, i) => {
    const v = lyArr[Math.min(i, lyArr.length - 1)] ?? 0;
    return v !== null ? Math.round((v as number) * 1.25) : null;
  });

  // ── Section 1: Daily cumulative (A1 = row 0) ──
  const dailyHeader = [`День`, `Факт ${currentYM.slice(0,4)}`, `План`, monthLabel(lyYM)];
  const dailyRows: any[][] = [dailyHeader];
  for (let i = 0; i < dim; i++) {
    dailyRows.push([i + 1, factArr[i] ?? "", planArr[i] ?? "", lyArr[i] ?? ""]);
  }
  // rows 0..dim  →  Sheet rows 1..dim+1  (0-indexed: 0..dim)

  // ── Section 2: Monthly summary (starts at row dim+2) ──
  // Колонки B/C/D/E взаимоисключающие по месяцам:
  //   • Для ym < PLAN_START_YM   → только B (Факт), C/D/E пустые.
  //   • Для ym >= PLAN_START_YM  → только C (база LY) + D (+25%) — стек плана,
  //                                  и E (Факт 2026) для линии. B пустая.
  const monthlyHeader = ["Месяц", "Факт (тыс.)", "Факт 2025 база (тыс.)", "Прирост +25% (тыс.)", "Факт 2026 (тыс.)", "% плана", "Чеков", "GP%", "Розница (тыс.)", "B2B (тыс.)", "GP (тыс.)", "Обяз. (тыс.)", "Прибыль (тыс.)"];
  const monthlyRows: any[][] = [monthlyHeader];
  for (const { ym, cur, last, plan, pct } of summary) {
    const gp = cur.total > 0 ? (cur.totalGP / cur.total) * 100 : 0;
    const isPlanMonth = ym >= PLAN_START_YM;
    // Будущие месяцы: рисуем план, но факта 2026 нет — линия не должна
    // падать в 0 после текущего месяца.
    const isFutureMonth = ym > currentYM;
    // Безубыточность: отсечка = постоянные + 1% от выручки месяца
    const monthThreshold = mandatoryFixed + cur.total * REVENUE_BONUS_PCT;
    const monthProfit    = cur.totalGP - monthThreshold;
    monthlyRows.push([
      monthLabel(ym),
      isPlanMonth ? "" : Math.round(cur.total / 1000),
      isPlanMonth ? Math.round(last.total / 1000) : "",
      isPlanMonth ? Math.round(last.total * 0.25 / 1000) : "",
      (isPlanMonth && !isFutureMonth) ? Math.round(cur.total / 1000) : "",
      +pct.toFixed(1),
      cur.checks,
      +gp.toFixed(1),
      Math.round(cur.retailTotal / 1000),
      Math.round(cur.b2bTotal / 1000),
      isFutureMonth ? "" : Math.round(cur.totalGP    / 1000),
      isFutureMonth ? "" : Math.round(monthThreshold / 1000),
      isFutureMonth ? "" : Math.round(monthProfit   / 1000),
    ]);
  }

  // ── Section 3: KPI block (starts at row dim+2+nMonths+2) ──
  const plan  = lyData.total * 1.25;
  const pct   = plan > 0 ? (curData.total / plan) * 100 : 0;
  const gpPct = curData.total > 0 ? (curData.totalGP / curData.total) * 100 : 0;
  const kpiRows = [
    ["KPI", "Значение"],
    ["Обновлено", updatedAt],
    ["Период", monthLabel(currentYM)],
    ["Факт (THB)", Math.round(curData.total)],
    ["План (THB)", Math.round(plan)],
    ["LY (THB)", Math.round(lyData.total)],
    ["% плана", +pct.toFixed(1)],
    ["GP (THB)", Math.round(curData.totalGP)],
    ["GP%", +gpPct.toFixed(1)],
    ["Чеков", curData.checks],
    ["Ср. чек", curData.checks > 0 ? Math.round(curData.total / curData.checks) : 0],
  ];

  // 7-day rolling retail average — computed в main, передаётся параметром.
  // Используется и для отображения здесь (Данные!G1), и для прогноза
  // ликвидности месяца в writeDashboard (run rate × дней в месяце).

  // Write all sections
  await writeValues(DATA_TAB, "A1", dailyRows);
  await writeValues(DATA_TAB, "F1", [["Ср. розница/день (7д)", rollingAvg]]);

  const monthlyStartRow = dim + 3; // 1-indexed
  await writeValues(DATA_TAB, `A${monthlyStartRow}`, monthlyRows);

  const kpiStartRow = monthlyStartRow + summary.length + 2;
  await writeValues(DATA_TAB, `A${kpiStartRow}`, kpiRows);

  // ── Section 4: Annual progress ──
  const annuals = computeAnnuals(summary);
  const annualStartRow = kpiStartRow + kpiRows.length + 2;
  const annualRows = [
    ["Год", "Факт YTD", "Осталось до плана", "План", "Факт прошлого года"],
    [
      String(annuals.curYear),
      Math.round(annuals.ytd),
      Math.round(annuals.remaining),
      Math.round(annuals.plan),
      Math.round(annuals.full2025),
    ],
  ];
  await writeValues(DATA_TAB, `A${annualStartRow}`, annualRows);

  // ── Section 5: Weekly facts (cols P:S, rows 1..N+1) ──
  // Источник для Rolling «Доход факт» — VLOOKUP по week_start.
  // Всегда чистые недели (текущая исключена), 12 штук, ISO-дата как ключ.
  const weeklyHeader = ["week_start", "retail", "b2b", "total"];
  const weeklyRows: any[][] = [weeklyHeader, ...weekly.map(w => [w.weekStart, w.retail, w.b2b, w.total])];
  await writeValues(DATA_TAB, "P1", weeklyRows);

  // ── Section 6: P&L по месяцам (cols U:Z) ──
  // Источник для графика «Прибыль владельца — Выручка vs Расходы (со сдвигом)».
  // Закупки сдвинуты на 1 месяц назад (30-day terms); обязательные = текущее
  // значение к каждому месяцу; buffer — константа.
  const pnlHeader = ["Месяц", "Выручка", "Закупки prev", "Обязательные", "Buffer", "Прибыль"];
  const pnlRows: any[][] = [pnlHeader, ...pnl.map(p => [
    monthLabel(p.ym),
    Math.round(p.revenue),
    Math.round(p.purchasesPrev),
    Math.round(p.obligatory),
    Math.round(p.buffer),
    Math.round(p.profit),
  ])];
  await writeValues(DATA_TAB, "U1", pnlRows);

  // Format header rows dark
  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };

  const fmtRequests: any[] = [
    // Daily header
    headerFmt(dataSheetId, 0, 1, 0, 4, dark, white),
    // Monthly header (13 cols)
    headerFmt(dataSheetId, monthlyStartRow - 1, monthlyStartRow, 0, 13, dark, white),
    // Monthly numeric columns B..E — format as "# ##0" (thousands with space separator)
    {
      repeatCell: {
        range: { sheetId: dataSheetId, startRowIndex: monthlyStartRow, endRowIndex: monthlyStartRow + summary.length, startColumnIndex: 1, endColumnIndex: 5 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "# ##0" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    // GP / Обяз. / Прибыль — также "# ##0", Прибыль с красным минусом
    {
      repeatCell: {
        range: { sheetId: dataSheetId, startRowIndex: monthlyStartRow, endRowIndex: monthlyStartRow + summary.length, startColumnIndex: 10, endColumnIndex: 12 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "# ##0" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    {
      repeatCell: {
        range: { sheetId: dataSheetId, startRowIndex: monthlyStartRow, endRowIndex: monthlyStartRow + summary.length, startColumnIndex: 12, endColumnIndex: 13 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "# ##0;[Red]-# ##0" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    // KPI header
    headerFmt(dataSheetId, kpiStartRow - 1, kpiStartRow, 0, 2, dark, white),
    // Annual header
    headerFmt(dataSheetId, annualStartRow - 1, annualStartRow, 0, 5, dark, white),
    // Weekly facts header (cols P:S = idx 15..19)
    headerFmt(dataSheetId, 0, 1, 15, 19, dark, white),
    // Weekly numeric format
    {
      repeatCell: {
        range: { sheetId: dataSheetId, startRowIndex: 1, endRowIndex: 1 + weekly.length, startColumnIndex: 16, endColumnIndex: 19 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "# ##0" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    // P&L header (cols U:Z = idx 20..26)
    headerFmt(dataSheetId, 0, 1, 20, 26, dark, white),
    // P&L numeric format (cols V:Z = idx 21..26)
    {
      repeatCell: {
        range: { sheetId: dataSheetId, startRowIndex: 1, endRowIndex: 1 + pnl.length, startColumnIndex: 21, endColumnIndex: 25 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "# ##0" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    // Прибыль с красным минусом (col Z = idx 25)
    {
      repeatCell: {
        range: { sheetId: dataSheetId, startRowIndex: 1, endRowIndex: 1 + pnl.length, startColumnIndex: 25, endColumnIndex: 26 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "# ##0;[Red]-# ##0" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    // Auto-resize
    { autoResizeDimensions: { dimensions: { sheetId: dataSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 26 } } },
  ];

  await sheets("POST", ":batchUpdate", { requests: fmtRequests });

  const annualRange = { start: annualStartRow - 1, end: annualStartRow + 1 };
  return {
    dailyRange:   { start: 0, end: dim + 1 },
    monthlyRange: { start: monthlyStartRow - 1, end: monthlyStartRow + summary.length },
    annualRange,
    annuals,
  };
}

function headerFmt(sheetId: number, r0: number, r1: number, c0: number, c1: number, bg: any, fg: any) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 },
      cell: { userEnteredFormat: { backgroundColor: bg, textFormat: { bold: true, foregroundColor: fg } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  };
}

// ─── Dashboard sheet: KPI + Charts ────────────────────────────────────────

async function writeDashboard(
  dashSheetId: number,
  dataSheetId: number,
  currentYM: string,
  curData: Awaited<ReturnType<typeof fetchMonth>>,
  lyData:  Awaited<ReturnType<typeof fetchMonth>>,
  summary: Awaited<ReturnType<typeof fetchSummary>>,
  ranges: { dailyRange: {start:number;end:number}; monthlyRange: {start:number;end:number}; annualRange: {start:number;end:number}; annuals: Annuals; tableRows?: TableRow[] },
  mandatoryFixed: number,
  openingBalance: number,
  kreditorkaDue: number,
  retailDailyAvg: number,
  debitorkaIn: number,
  pnlLength: number,
) {
  await clearTab(dashSheetId);
  await deleteCharts(dashSheetId);

  const plan  = lyData.total * 1.25;
  const pct   = plan > 0 ? (curData.total / plan) * 100 : 0;
  const rem   = Math.max(0, plan - curData.total);
  const gpPct = curData.total > 0 ? (curData.totalGP / curData.total) * 100 : 0;
  const lyYM  = prevYear(currentYM);

  const f   = (n: number) => Math.round(n).toLocaleString("ru-RU") + " ฿";
  const fK  = (n: number) => Math.round(n / 1000).toLocaleString("ru-RU") + " тыс.";
  const { annuals, annualRange } = ranges;

  // ── Annual progress block (rows 0-4) ──
  // Bar uses cols 1-6 (6 columns). Col 0 = fact, col 7 = plan, cols 8-9 = table
  const BAR_COLS = 6;
  const greenCols = Math.min(BAR_COLS, Math.max(1, Math.round(annuals.pct / 100 * BAR_COLS)));
  const grayCols  = BAR_COLS - greenCols;
  const greenStart = 1;
  const grayStart  = 1 + greenCols;

  // Build row 2 (main bar row): [fact | green cell | ... | gray cell | ... | plan | ЦЕЛЬ | value]
  const row2: (string|number)[] = new Array(10).fill("");
  row2[0] = fK(annuals.ytd);
  row2[greenStart] = fK(annuals.ytd);     // value shown in green merged cell
  row2[grayStart]  = fK(annuals.remaining); // value shown in gray merged cell
  row2[7] = fK(annuals.plan);
  row2[8] = "ЦЕЛЬ";
  row2[9] = fK(annuals.plan);

  const bkk = bangkokNow();
  const ts = `${String(bkk.getUTCDate()).padStart(2, "0")}.${String(bkk.getUTCMonth() + 1).padStart(2, "0")}.${bkk.getUTCFullYear()} ${String(bkk.getUTCHours()).padStart(2, "0")}:${String(bkk.getUTCMinutes()).padStart(2, "0")}`;

  const annualBlock = [
    // Row 0: title
    [`Wine & Whiskey — Годовой план ${annuals.curYear}   ·   обновлено ${ts} (Bangkok)`, ...new Array(9).fill("")],
    // Row 1: labels
    ["ФАКТ", ...new Array(6).fill(""), "ПЛАН (LY ×1.25)", "ФАКТ", fK(annuals.ytd)],
    // Row 2: main
    row2,
    // Row 3: subtitles
    [`${annuals.pct.toFixed(1)}% плана выполнено`, ...new Array(6).fill(""), "", "ОСТАЛОСЬ", fK(annuals.remaining)],
    // Row 4: spacer
    new Array(10).fill(""),
  ];
  await writeValues(DASH_TAB, "A1", annualBlock);

  // ── Monthly KPI block starts at row 6 ──
  // KPI header block (rows 6-18, cols 0-7) — 4 ряда с общим шаблоном
  // [факт · база · цель · % к цели]:
  //   Ряд 1: Выручка       — Факт         · Прошлый год · План (LY ×1.25)  · % плана
  //   Ряд 2: Маржа GP      — Gross Profit · LY GP       · GP план (×1.25)  · % GP-плана
  //   Ряд 3: Безубыток     — Обязательные · +1% выручки · Прибыль          · % покрытия
  //   Ряд 4: Ликвидность   — Доступно     · Остаток нач.· К оплате (≠Paid) · % покрытия
  const lyGP           = lyData.totalGP;
  const planGP         = lyGP * 1.25;
  const gpPlanPct      = planGP > 0 ? (curData.totalGP / planGP) * 100 : 0;

  const monthBonus     = curData.total * REVENUE_BONUS_PCT;
  const monthThreshold = mandatoryFixed + monthBonus;
  const monthProfit    = curData.totalGP - monthThreshold;
  const coveragePct    = monthThreshold > 0 ? (curData.totalGP / monthThreshold) * 100 : 0;
  const profitSign     = monthProfit >= 0 ? "+" : "−";
  const profitAbs      = Math.abs(monthProfit);

  // Прогноз выручки месяца:
  //   • retail = run rate (7d скользящее × дней в месяце) — пример Rolling «Доход план»
  //   • B2B    = ожидаемые поступления из «Дебиторки» в этом месяце
  // Берём так пожизни всего месяца — не to-date, чтобы метрика отвечала на вопрос
  // «по нашим текущим темпам и ожидаемым B2B-оплатам, закроем ли месяц?».
  const daysInMo        = monthBounds(currentYM).days;
  const retailForecast  = retailDailyAvg * daysInMo;
  const revenueForecast = retailForecast + debitorkaIn;
  const available       = openingBalance + revenueForecast;
  const liquidityPct    = kreditorkaDue > 0 ? (available / kreditorkaDue) * 100 : Infinity;

  const kpiValues = [
    [`${monthLabel(currentYM)} — текущий месяц`],
    [],
    ["Выручка", "", "Прошлый год", "", "План (LY ×1.25)", "", "% плана"],
    [
      `${f(curData.total)}`, "",
      `${f(lyData.total)}`, "",
      `${f(plan)}`, "",
      `${pct.toFixed(1)}%`,
    ],
    [],
    ["Gross Profit", "", "GP прошлого года", "", "GP план (LY ×1.25)", "", "% GP-плана"],
    [
      `${f(curData.totalGP)}`, "",
      `${f(lyGP)}`, "",
      `${f(planGP)}`, "",
      `${gpPlanPct.toFixed(1)}%`,
    ],
    [],
    ["Обязательные", "", "+1% от выручки", "", "Прибыль (GP − Обяз.)", "", "% покрытия"],
    [
      `${f(mandatoryFixed)}`, "",
      `${f(monthBonus)}`, "",
      `${profitSign}${f(profitAbs)}`, "",
      `${coveragePct.toFixed(1)}%`,
    ],
    [],
    ["Доступно (Ост. + Прогноз)", "", "Прогноз выручки месяца", "", "К оплате (не-Paid)", "", "% покрытия"],
    [
      `${f(available)}`, "",
      `${f(revenueForecast)}`, "",
      `${f(kreditorkaDue)}`, "",
      kreditorkaDue > 0 ? `${liquidityPct.toFixed(1)}%` : "OK",
    ],
  ];
  await writeValues(DASH_TAB, "A7", kpiValues);

  // Format KPI
  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  const wine  = { red: 0.48, green: 0.11, blue: 0.11 };
  const lightGray = { red: 0.96, green: 0.95, blue: 0.93 };

  const green = { red: 0.11, green: 0.53, blue: 0.36 };  // прогресс-бар факт

  const greenBg   = { red: 0.11, green: 0.53, blue: 0.36 };
  const grayBarBg = { red: 0.87, green: 0.87, blue: 0.87 };
  const cardBg    = { red: 1.0,  green: 1.0,  blue: 1.0  };
  const borderClr = { red: 0.75, green: 0.75, blue: 0.75 };
  const subtleGray = { red: 0.5, green: 0.5, blue: 0.5 };
  const border = { style: "SOLID_MEDIUM", colorStyle: { rgbColor: borderClr } };

  const fmtReqs: any[] = [
    // ── Annual block ──
    // Title row 0: dark, merged across 10 cols
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 },
        cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, fontSize: 13, foregroundColor: white } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    },
    { mergeCells: { range: { sheetId: dashSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 }, mergeType: "MERGE_ALL" } },

    // Card background (rows 1-3, cols 0-9)
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 1, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 10 },
        cell: { userEnteredFormat: { backgroundColor: cardBg } },
        fields: "userEnteredFormat.backgroundColor",
      },
    },
    // Outer border around card
    { updateBorders: { range: { sheetId: dashSheetId, startRowIndex: 1, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 10 }, top: border, bottom: border, left: border, right: border } },

    // Row 1 labels — small, gray
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { fontSize: 10, bold: true, foregroundColor: subtleGray } } },
        fields: "userEnteredFormat.textFormat",
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 7, endColumnIndex: 8 },
        cell: { userEnteredFormat: { textFormat: { fontSize: 10, bold: true, foregroundColor: subtleGray } }, userEnteredValue: {} },
        fields: "userEnteredFormat.textFormat",
      },
    },
    // Row 1 table section (cols 8-9)
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 1, endRowIndex: 4, startColumnIndex: 8, endColumnIndex: 9 },
        cell: { userEnteredFormat: { textFormat: { fontSize: 10, bold: true, foregroundColor: subtleGray } } },
        fields: "userEnteredFormat.textFormat",
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 1, endRowIndex: 4, startColumnIndex: 9, endColumnIndex: 10 },
        cell: { userEnteredFormat: { textFormat: { fontSize: 10, bold: false }, horizontalAlignment: "RIGHT" } },
        fields: "userEnteredFormat(textFormat,horizontalAlignment)",
      },
    },

    // Row 2: big numbers in col 0 and col 7
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { fontSize: 18, bold: true, foregroundColor: wine } } },
        fields: "userEnteredFormat.textFormat",
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 7, endColumnIndex: 8 },
        cell: { userEnteredFormat: { textFormat: { fontSize: 18, bold: true, foregroundColor: dark } } },
        fields: "userEnteredFormat.textFormat",
      },
    },
    // Row 2 bar height
    { updateDimensionProperties: { range: { sheetId: dashSheetId, dimension: "ROWS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 56 }, fields: "pixelSize" } },

    // GREEN bar cells (cols greenStart to grayStart) — only bar row
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: greenStart, endColumnIndex: grayStart },
        cell: { userEnteredFormat: { backgroundColor: greenBg } },
        fields: "userEnteredFormat.backgroundColor",
      },
    },
    // Green bar value (row 2, merged)
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: greenStart, endColumnIndex: grayStart },
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12, foregroundColor: white }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
        fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    { mergeCells: { range: { sheetId: dashSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: greenStart, endColumnIndex: grayStart }, mergeType: "MERGE_ALL" } },

    // GRAY bar cells (cols grayStart to 7)
    ...(grayCols > 0 ? [
      {
        repeatCell: {
          range: { sheetId: dashSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: grayStart, endColumnIndex: 7 },
          cell: { userEnteredFormat: { backgroundColor: grayBarBg } },
          fields: "userEnteredFormat.backgroundColor",
        },
      },
      {
        repeatCell: {
          range: { sheetId: dashSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: grayStart, endColumnIndex: 7 },
          cell: { userEnteredFormat: { textFormat: { bold: false, fontSize: 12, foregroundColor: subtleGray }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
          fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)",
        },
      },
      { mergeCells: { range: { sheetId: dashSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: grayStart, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } },
    ] : []),

    // Row 3 subtitle
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { fontSize: 10, foregroundColor: greenBg } } },
        fields: "userEnteredFormat.textFormat",
      },
    },

    // Col widths: col 0 and 7 wider, bar cols equal, table cols narrow
    { updateDimensionProperties: { range: { sheetId: dashSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 160 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: dashSheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 7 }, properties: { pixelSize: 120 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: dashSheetId, dimension: "COLUMNS", startIndex: 7, endIndex: 8 }, properties: { pixelSize: 160 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: dashSheetId, dimension: "COLUMNS", startIndex: 8, endIndex: 9 }, properties: { pixelSize: 90 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId: dashSheetId, dimension: "COLUMNS", startIndex: 9, endIndex: 10 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },

    // ── Monthly block (rows 6-12) ──
    // Monthly title (row 6)
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 8 },
        cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, fontSize: 13, foregroundColor: white } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    },
    // Label rows (8, 11, 14, 17)
    ...([8, 11, 14, 17] as const).map(r => ({
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 8 },
        cell: { userEnteredFormat: { backgroundColor: wine, textFormat: { bold: true, fontSize: 10, foregroundColor: white } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    })),
    // Value rows (9, 12, 15, 18)
    ...([9, 12, 15, 18] as const).map(r => ({
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 8 },
        cell: { userEnteredFormat: { backgroundColor: lightGray, textFormat: { bold: true, fontSize: 13 } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    })),
    // Прибыль cell (row 15, col 4) — зелёная если ≥0, винно-красная если <0
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 15, endRowIndex: 16, startColumnIndex: 4, endColumnIndex: 5 },
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 13, foregroundColor: monthProfit >= 0 ? green : wine } } },
        fields: "userEnteredFormat.textFormat",
      },
    },
    // % покрытия Ликвидности (row 18, col 6) — зелёный если ≥100, винный если <100
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 18, endRowIndex: 19, startColumnIndex: 6, endColumnIndex: 7 },
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 13, foregroundColor: liquidityPct >= 100 ? green : wine } } },
        fields: "userEnteredFormat.textFormat",
      },
    },
    // Merge monthly title
    { mergeCells: { range: { sheetId: dashSheetId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: "MERGE_ALL" } },

    // Без закрепления строк — мешает листать графики ниже
    { updateSheetProperties: { properties: { sheetId: dashSheetId, gridProperties: { frozenRowCount: 0 } }, fields: "gridProperties.frozenRowCount" } },
    // Column widths (KPI block + расширенная таблица периодов до col 9)
    { updateDimensionProperties: { range: { sheetId: dashSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 10 }, properties: { pixelSize: 160 }, fields: "pixelSize" } },
  ];

  await sheets("POST", ":batchUpdate", { requests: fmtReqs });

  // ── Summary table (rows 20+) ──
  if (ranges.tableRows && ranges.tableRows.length > 0) {
    const TABLE_START = 20; // row index (сдвинут из-за 4-го ряда KPI «Ликвидность»)
    const COL_COUNT = 10; // + Обяз. + Прибыль
    const colHeaders = ["Период", "Розница, ฿", "B2B, ฿", "Итого, ฿", "Чеков", "Gross Profit, ฿", "GP%", "Обяз., ฿", "Прибыль, ฿", "Ср. чек, ฿"];
    const tableValues: (string|number)[][] = [colHeaders];
    for (const { label, stats, fixedFraction } of ranges.tableRows) {
      const gpPct = stats.revenue > 0 ? (stats.gp / stats.revenue * 100) : 0;
      const avgCheck = stats.checks > 0 ? stats.revenue / stats.checks : 0;
      // Отсечка периода: постоянные × доля + 1% от выручки периода
      const threshold = mandatoryFixed * fixedFraction + stats.revenue * REVENUE_BONUS_PCT;
      const profit    = stats.gp - threshold;
      tableValues.push([
        label,
        Math.round(stats.retailRevenue),
        Math.round(stats.b2bRevenue),
        Math.round(stats.revenue),
        stats.checks,
        Math.round(stats.gp),
        +gpPct.toFixed(1),
        Math.round(threshold),
        Math.round(profit),
        Math.round(avgCheck),
      ]);
    }
    await writeValues(DASH_TAB, `A${TABLE_START + 1}`, tableValues);

    // nRows includes header row (1 + 6 data = 7 total)
    const nRows = tableValues.length;
    const nData = nRows - 1; // 6 data rows

    const thinLine  = { style: "SOLID",        colorStyle: { rgbColor: { red: 0.82, green: 0.82, blue: 0.82 } } };
    const thickLine = { style: "SOLID_MEDIUM",  colorStyle: { rgbColor: { red: 0.60, green: 0.60, blue: 0.60 } } };
    const colGray   = { red: 0.38, green: 0.38, blue: 0.38 };

    const tblFmt: any[] = [
      // ── Entire table background: white ──
      {
        repeatCell: {
          range: { sheetId: dashSheetId, startRowIndex: TABLE_START, endRowIndex: TABLE_START + nRows, startColumnIndex: 0, endColumnIndex: COL_COUNT },
          cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
          fields: "userEnteredFormat.backgroundColor",
        },
      },

      // ── Column header row: bold gray text, no fill, bottom thick border ──
      {
        repeatCell: {
          range: { sheetId: dashSheetId, startRowIndex: TABLE_START, endRowIndex: TABLE_START + 1, startColumnIndex: 0, endColumnIndex: COL_COUNT },
          cell: { userEnteredFormat: {
            textFormat: { bold: true, fontSize: 10, foregroundColor: colGray },
            verticalAlignment: "BOTTOM",
            padding: { top: 4, bottom: 6 },
          }},
          fields: "userEnteredFormat(textFormat,verticalAlignment,padding)",
        },
      },
      // Numeric headers right-aligned
      {
        repeatCell: {
          range: { sheetId: dashSheetId, startRowIndex: TABLE_START, endRowIndex: TABLE_START + 1, startColumnIndex: 1, endColumnIndex: COL_COUNT },
          cell: { userEnteredFormat: { horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat.horizontalAlignment",
        },
      },
      { updateBorders: {
          range: { sheetId: dashSheetId, startRowIndex: TABLE_START, endRowIndex: TABLE_START + 1, startColumnIndex: 0, endColumnIndex: COL_COUNT },
          bottom: thickLine,
      }},

      // ── Data rows: italic label col, right-aligned numbers ──
      {
        repeatCell: {
          range: { sheetId: dashSheetId, startRowIndex: TABLE_START + 1, endRowIndex: TABLE_START + nRows, startColumnIndex: 0, endColumnIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { italic: true, fontSize: 10 }, verticalAlignment: "MIDDLE" } },
          fields: "userEnteredFormat(textFormat,verticalAlignment)",
        },
      },
      {
        repeatCell: {
          range: { sheetId: dashSheetId, startRowIndex: TABLE_START + 1, endRowIndex: TABLE_START + nRows, startColumnIndex: 1, endColumnIndex: COL_COUNT },
          cell: { userEnteredFormat: {
            horizontalAlignment: "RIGHT",
            numberFormat: { type: "NUMBER", pattern: "#,##0" },
            textFormat: { fontSize: 10, italic: false },
            verticalAlignment: "MIDDLE",
          }},
          fields: "userEnteredFormat(horizontalAlignment,numberFormat,textFormat,verticalAlignment)",
        },
      },

      // ── Row height ──
      { updateDimensionProperties: {
          range: { sheetId: dashSheetId, dimension: "ROWS", startIndex: TABLE_START + 1, endIndex: TABLE_START + nRows },
          properties: { pixelSize: 36 }, fields: "pixelSize",
      }},

      // ── Section separators (thick lines below Прошлая неделя [row 2] and Прошлый месяц [row 4]) ──
      { updateBorders: {
          range: { sheetId: dashSheetId, startRowIndex: TABLE_START + 2, endRowIndex: TABLE_START + 3, startColumnIndex: 0, endColumnIndex: COL_COUNT },
          bottom: thickLine,
      }},
      { updateBorders: {
          range: { sheetId: dashSheetId, startRowIndex: TABLE_START + 4, endRowIndex: TABLE_START + 5, startColumnIndex: 0, endColumnIndex: COL_COUNT },
          bottom: thickLine,
      }},

      // ── Thin row dividers within each section ──
      { updateBorders: {
          range: { sheetId: dashSheetId, startRowIndex: TABLE_START + 1, endRowIndex: TABLE_START + 2, startColumnIndex: 0, endColumnIndex: COL_COUNT },
          bottom: thinLine,
      }},
      { updateBorders: {
          range: { sheetId: dashSheetId, startRowIndex: TABLE_START + 3, endRowIndex: TABLE_START + 4, startColumnIndex: 0, endColumnIndex: COL_COUNT },
          bottom: thinLine,
      }},
      { updateBorders: {
          range: { sheetId: dashSheetId, startRowIndex: TABLE_START + 5, endRowIndex: TABLE_START + 6, startColumnIndex: 0, endColumnIndex: COL_COUNT },
          bottom: thinLine,
      }},

      // ── Last row (Прошлый год) bold ──
      {
        repeatCell: {
          range: { sheetId: dashSheetId, startRowIndex: TABLE_START + nData, endRowIndex: TABLE_START + nData + 1, startColumnIndex: 0, endColumnIndex: COL_COUNT },
          cell: { userEnteredFormat: { textFormat: { bold: true, italic: false, fontSize: 10 } } },
          fields: "userEnteredFormat.textFormat",
        },
      },

      // ── Прибыль (col 8): красный минус для убытков ──
      {
        repeatCell: {
          range: { sheetId: dashSheetId, startRowIndex: TABLE_START + 1, endRowIndex: TABLE_START + nRows, startColumnIndex: 8, endColumnIndex: 9 },
          cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0;[Red]-#,##0" }, textFormat: { bold: true, fontSize: 10, italic: false } } },
          fields: "userEnteredFormat(numberFormat,textFormat)",
        },
      },

      // ── Outer border ──
      { updateBorders: {
          range: { sheetId: dashSheetId, startRowIndex: TABLE_START, endRowIndex: TABLE_START + nRows, startColumnIndex: 0, endColumnIndex: COL_COUNT },
          top: thickLine, bottom: thickLine, left: thickLine, right: thickLine,
      }},
    ];
    await sheets("POST", ":batchUpdate", { requests: tblFmt });
  }

  // ── Charts ──
  const { dailyRange, monthlyRange } = ranges;

  // Series colors
  const wineRed  = { red: 0.482, green: 0.114, blue: 0.114, alpha: 1 };
  const orange   = { red: 0.976, green: 0.451, blue: 0.024, alpha: 1 };
  const grayBlue = { red: 0.58,  green: 0.647, blue: 0.725, alpha: 1 };

  function dataRange(c0: number, c1: number, r0: number, r1: number) {
    return { sheetId: dataSheetId, startColumnIndex: c0, endColumnIndex: c1, startRowIndex: r0, endRowIndex: r1 };
  }

  // Общий потолок для левой и правой оси (в тыс. THB), чтобы шкалы совпадали.
  // Берём максимум из (фактических столбцов прошлых месяцев, плановых стеков, фактической линии 2026).
  const monthlyMaxKThb = (() => {
    let max = 0;
    for (const { ym, cur, last } of summary) {
      const isPlan = ym >= PLAN_START_YM;
      const barVal  = isPlan ? last.total * 1.25 : cur.total;
      const lineVal = isPlan ? cur.total : 0;
      if (barVal  > max) max = barVal;
      if (lineVal > max) max = lineVal;
    }
    const k = max / 1000 * 1.05; // 5% headroom
    return Math.ceil(k / 100) * 100; // round up to nearest 100k
  })();

  const chartRequests: any[] = [
    // ── Chart 1: Cumulative day-by-day progress (LINE) ──
    {
      addChart: {
        chart: {
          spec: {
            title: `Прогресс к плану — ${monthLabel(currentYM)} vs ${monthLabel(prevYear(currentYM))}`,
            titleTextFormat: { bold: true, fontSize: 13 },
            basicChart: {
              chartType: "LINE",
              legendPosition: "RIGHT_LEGEND",
              axis: [
                { position: "BOTTOM_AXIS", title: "День месяца" },
                { position: "LEFT_AXIS",   title: "Накопительно, THB" },
              ],
              domains: [{ domain: { sourceRange: { sources: [dataRange(0, 1, dailyRange.start, dailyRange.end)] } } }],
              series: [
                {
                  series: { sourceRange: { sources: [dataRange(1, 2, dailyRange.start, dailyRange.end)] } },
                  targetAxis: "LEFT_AXIS",
                  color: wineRed,
                  lineStyle: { width: 3, type: "SOLID" },
                },
                {
                  series: { sourceRange: { sources: [dataRange(2, 3, dailyRange.start, dailyRange.end)] } },
                  targetAxis: "LEFT_AXIS",
                  color: orange,
                  lineStyle: { width: 2, type: "MEDIUM_DASHED" },
                },
                {
                  series: { sourceRange: { sources: [dataRange(3, 4, dailyRange.start, dailyRange.end)] } },
                  targetAxis: "LEFT_AXIS",
                  color: grayBlue,
                  lineStyle: { width: 1, type: "DOTTED" },
                },
              ],
              interpolateNulls: true,
            },
            backgroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: dashSheetId, rowIndex: 29, columnIndex: 0 },
              widthPixels: 1400,
              heightPixels: 420,
            },
          },
        },
      },
    },

    // ── Chart 2: Monthly COMBO — Факт vs План (стек LY+25%) + Факт 2026 линией ──
    // Месяцы < PLAN_START_YM:  серый столбец "Факт".
    // Месяцы >= PLAN_START_YM: стек из "Факт 2025 база" (серо-голубой) + "Прирост +25%"
    //                          (оранжевый), плюс красная линия "Факт 2026".
    // Все серии живут на ОДНОЙ левой оси — шкала одна, линию плана можно
    // напрямую соотнести с фактом. Правую ось не используем намеренно:
    // Google Sheets выбирает деления независимо для каждой оси, и идентичность
    // шкал гарантируется только тем, что ось одна.
    {
      addChart: {
        chart: {
          spec: {
            title: `Помесячно: Факт → План LY+25% (с ${monthLabel(PLAN_START_YM)})`,
            titleTextFormat: { bold: true, fontSize: 13 },
            basicChart: {
              chartType: "COMBO",
              stackedType: "STACKED",
              legendPosition: "RIGHT_LEGEND",
              axis: [
                { position: "BOTTOM_AXIS" },
                {
                  position: "LEFT_AXIS",
                  title: "тыс. THB",
                  viewWindowOptions: { viewWindowMode: "EXPLICIT", viewWindowMin: 0, viewWindowMax: monthlyMaxKThb },
                },
              ],
              domains: [{ domain: { sourceRange: { sources: [dataRange(0, 1, monthlyRange.start, monthlyRange.end)] } } }],
              series: [
                // Факт — серый столбец (для месяцев до PLAN_START_YM)
                {
                  series: { sourceRange: { sources: [dataRange(1, 2, monthlyRange.start, monthlyRange.end)] } },
                  targetAxis: "LEFT_AXIS",
                  type: "COLUMN",
                  color: grayBlue,
                  dataLabel: { type: "DATA", placement: "OUTSIDE_END", textFormat: { fontSize: 9, bold: true } },
                },
                // База плана = Факт 2025 — серо-голубой (стек-база, от PLAN_START_YM)
                {
                  series: { sourceRange: { sources: [dataRange(2, 3, monthlyRange.start, monthlyRange.end)] } },
                  targetAxis: "LEFT_AXIS",
                  type: "COLUMN",
                  color: grayBlue,
                  dataLabel: { type: "DATA", placement: "INSIDE_BASE", textFormat: { fontSize: 9, bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } },
                },
                // Прирост +25% — оранжевый (стек-верх плана, от PLAN_START_YM)
                {
                  series: { sourceRange: { sources: [dataRange(3, 4, monthlyRange.start, monthlyRange.end)] } },
                  targetAxis: "LEFT_AXIS",
                  type: "COLUMN",
                  color: { red: 0.98, green: 0.73, blue: 0.42, alpha: 1 },
                  dataLabel: { type: "DATA", placement: "OUTSIDE_END", textFormat: { fontSize: 9, bold: true } },
                },
                // Факт 2026 — тёмно-красная линия на той же ЛЕВОЙ оси
                {
                  series: { sourceRange: { sources: [dataRange(4, 5, monthlyRange.start, monthlyRange.end)] } },
                  targetAxis: "LEFT_AXIS",
                  type: "LINE",
                  color: wineRed,
                  lineStyle: { width: 3, type: "SOLID" },
                  dataLabel: { type: "DATA", placement: "ABOVE", textFormat: { fontSize: 9, bold: true, foregroundColor: wineRed } },
                },
              ],
            },
            backgroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: dashSheetId, rowIndex: 53, columnIndex: 0 },
              widthPixels: 1400,
              heightPixels: 700,
            },
          },
        },
      },
    },
  ];

  // ── Chart 3: Розница vs B2B stacked by month ──
  const steelBlue = { red: 0.20, green: 0.47, blue: 0.71, alpha: 1 };
  chartRequests.push({
    addChart: {
      chart: {
        spec: {
          title: "Розница vs B2B — помесячно",
          titleTextFormat: { bold: true, fontSize: 13 },
          basicChart: {
            chartType: "COLUMN",
            stackedType: "STACKED",
            legendPosition: "RIGHT_LEGEND",
            axis: [
              { position: "BOTTOM_AXIS" },
              { position: "LEFT_AXIS", title: "тыс. THB" },
            ],
            domains: [{ domain: { sourceRange: { sources: [dataRange(0, 1, monthlyRange.start, monthlyRange.end)] } } }],
            series: [
              {
                // Розница (col I = idx 8)
                series: { sourceRange: { sources: [dataRange(8, 9, monthlyRange.start, monthlyRange.end)] } },
                targetAxis: "LEFT_AXIS",
                color: steelBlue,
                dataLabel: { type: "DATA", placement: "INSIDE_BASE", textFormat: { fontSize: 9, bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } },
              },
              {
                // B2B (col J = idx 9)
                series: { sourceRange: { sources: [dataRange(9, 10, monthlyRange.start, monthlyRange.end)] } },
                targetAxis: "LEFT_AXIS",
                color: orange,
                dataLabel: { type: "DATA", placement: "OUTSIDE_END", textFormat: { fontSize: 9, bold: true } },
              },
            ],
          },
          backgroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId: dashSheetId, rowIndex: 89, columnIndex: 0 },
            widthPixels: 1400,
            heightPixels: 500,
          },
        },
      },
    },
  });

  // ── Chart 4: Маржа vs Обязательные расходы — помесячно ──
  // Бары — Gross Profit за месяц (col K = idx 10).
  // Линия — отсечка (постоянные + 1% от выручки) (col L = idx 11), пунктир.
  // Если бар выше линии — закрыли постоянку, прибыль наверху. Ниже — добиваем личными.
  const greenColor = { red: 0.11, green: 0.53, blue: 0.36, alpha: 1 };
  chartRequests.push({
    addChart: {
      chart: {
        spec: {
          title: "Маржа vs Обязательные расходы — помесячно",
          subtitle: "Бары: Gross Profit · Линия: постоянные + 1% от выручки",
          titleTextFormat: { bold: true, fontSize: 13 },
          basicChart: {
            chartType: "COMBO",
            legendPosition: "RIGHT_LEGEND",
            axis: [
              { position: "BOTTOM_AXIS" },
              { position: "LEFT_AXIS", title: "тыс. THB" },
            ],
            domains: [{ domain: { sourceRange: { sources: [dataRange(0, 1, monthlyRange.start, monthlyRange.end)] } } }],
            series: [
              {
                // GP (col K = idx 10)
                series: { sourceRange: { sources: [dataRange(10, 11, monthlyRange.start, monthlyRange.end)] } },
                targetAxis: "LEFT_AXIS",
                type: "COLUMN",
                color: greenColor,
                dataLabel: { type: "DATA", placement: "OUTSIDE_END", textFormat: { fontSize: 9, bold: true } },
              },
              {
                // Отсечка (col L = idx 11)
                series: { sourceRange: { sources: [dataRange(11, 12, monthlyRange.start, monthlyRange.end)] } },
                targetAxis: "LEFT_AXIS",
                type: "LINE",
                color: wineRed,
                lineStyle: { width: 3, type: "MEDIUM_DASHED" },
                dataLabel: { type: "DATA", placement: "ABOVE", textFormat: { fontSize: 9, bold: true, foregroundColor: wineRed } },
              },
            ],
            interpolateNulls: true,
          },
          backgroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId: dashSheetId, rowIndex: 116, columnIndex: 0 },
            widthPixels: 1400,
            heightPixels: 500,
          },
        },
      },
    },
  });

  // ── Chart 5: Прибыль владельца — Выручка vs Расходы (со сдвигом) ──
  // Стек-бары расходов (col W=Закупки prev, X=Обяз., Y=Buffer) + линия выручки
  // (col V). Где линия выше стека — месяц закрыт владельцу в плюс.
  // Закупки сдвинуты на 1 месяц назад (30-day terms).
  // Источник: Данные!U:Z, заполняется выше через writeDataSheet (pnlRows).
  // Range: U2:Z(1+pnl.length); col U = idx 20, V=21, W=22, X=23, Y=24, Z=25.
  const pnlStartRow = 1; // 0-indexed (U2 = row 1)
  const pnlEndRow   = 1 + pnlLength;
  chartRequests.push({
    addChart: {
      chart: {
        spec: {
          title: "Прибыль владельца — Выручка vs Расходы (со сдвигом)",
          subtitle: "Выручка месяца N покрывает: Закупки месяца N-1 + Обязательные + Buffer 15K",
          titleTextFormat: { bold: true, fontSize: 13 },
          basicChart: {
            chartType: "COMBO",
            stackedType: "STACKED",
            legendPosition: "RIGHT_LEGEND",
            axis: [
              { position: "BOTTOM_AXIS" },
              { position: "LEFT_AXIS", title: "THB" },
            ],
            domains: [{ domain: { sourceRange: { sources: [dataRange(20, 21, pnlStartRow, pnlEndRow)] } } }],
            series: [
              // Закупки prev — винный (база стека)
              {
                series: { sourceRange: { sources: [dataRange(22, 23, pnlStartRow, pnlEndRow)] } },
                targetAxis: "LEFT_AXIS",
                type: "COLUMN",
                color: wineRed,
                dataLabel: { type: "DATA", placement: "INSIDE_BASE", textFormat: { fontSize: 9, bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } },
              },
              // Обязательные — оранжевый (середина стека)
              {
                series: { sourceRange: { sources: [dataRange(23, 24, pnlStartRow, pnlEndRow)] } },
                targetAxis: "LEFT_AXIS",
                type: "COLUMN",
                color: orange,
                dataLabel: { type: "DATA", placement: "INSIDE_BASE", textFormat: { fontSize: 9, bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } },
              },
              // Buffer — серо-голубой (верх стека)
              {
                series: { sourceRange: { sources: [dataRange(24, 25, pnlStartRow, pnlEndRow)] } },
                targetAxis: "LEFT_AXIS",
                type: "COLUMN",
                color: grayBlue,
                dataLabel: { type: "DATA", placement: "OUTSIDE_END", textFormat: { fontSize: 9, bold: true } },
              },
              // Выручка — зелёная линия (если выше стека → профит)
              {
                series: { sourceRange: { sources: [dataRange(21, 22, pnlStartRow, pnlEndRow)] } },
                targetAxis: "LEFT_AXIS",
                type: "LINE",
                color: greenColor,
                lineStyle: { width: 3, type: "SOLID" },
                dataLabel: { type: "DATA", placement: "ABOVE", textFormat: { fontSize: 9, bold: true, foregroundColor: greenColor } },
              },
            ],
          },
          backgroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId: dashSheetId, rowIndex: 144, columnIndex: 0 },
            widthPixels: 1400,
            heightPixels: 600,
          },
        },
      },
    },
  });

  await sheets("POST", ":batchUpdate", { requests: chartRequests });
  console.log("  ✓ Charts created.");
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2];
  const now = bangkokNow();
  const currentYM = arg ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [cy, cm]  = currentYM.split("-").map(Number);
  const isNow     = now.getUTCFullYear() === cy && now.getUTCMonth() + 1 === cm;
  const todayDay  = isNow ? now.getUTCDate() : monthBounds(currentYM).days;
  const updatedAt = now.toISOString().slice(0, 16).replace("T", " ") + " BKK";

  console.log(`\nWine & Whiskey — Sheets Dashboard Sync`);
  console.log(`Period: ${monthLabel(currentYM)}\n`);

  console.log(`[1/4] Fetching current month (${currentYM})...`);
  const curData = await fetchMonth(currentYM);
  console.log(`      ${curData.checks} receipts · ${Math.round(curData.total).toLocaleString()} THB\n`);

  console.log(`[2/4] Fetching last year same month (${prevYear(currentYM)})...`);
  const lyData  = await fetchMonth(prevYear(currentYM));
  console.log(`      ${lyData.checks} receipts · ${Math.round(lyData.total).toLocaleString()} THB\n`);

  // Тянем все месяцы прошлого года + текущий + все будущие до Дек включительно,
  // чтобы помесячный график вёл план по полному текущему году.
  const monthsForward = Math.max(0, 12 - cm);
  const monthsBack    = 16;
  console.log(`[3/4] Fetching summary (${monthsBack} back + ${monthsForward} forward through Dec ${cy})...`);
  const summary = await fetchSummary(currentYM, monthsBack, monthsForward);

  console.log(`\n[3.5/4] Fetching summary table data...`);
  const tableRows = await fetchSummaryTable(currentYM, curData, summary);
  console.log(`  ✓ ${tableRows.length} rows fetched.\n`);

  console.log(`[3.6/4] Reading mandatory fixed expenses ("Обязательные")...`);
  const mandatoryFixed = await fetchMandatoryFixed();
  console.log(`  ✓ Обязательные: ${Math.round(mandatoryFixed).toLocaleString()} THB/мес (+1% от выручки на премию)\n`);

  console.log(`[3.7/4] Fetching weekly history (12 закрытых недель → "Данные"!P:S → Rolling)...`);
  const weekly = await fetchWeeklyHistory(12);
  console.log(`  ✓ ${weekly.length} weeks: ${weekly[0]?.weekStart} … ${weekly[weekly.length - 1]?.weekStart}\n`);

  console.log(`[3.8/4] Fetching ликвидность месяца (Rolling opening + Кредит/Дебит + 7d run rate + закупки)...`);
  const sevenAgoMs = now.getTime() - 6 * 86_400_000;
  const fmtDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const [openingBalance, kreditorkaDue, debitorkaIn, rolling7, purchases] = await Promise.all([
    fetchOpeningBalanceForMonth(currentYM),
    fetchKreditorkaDueForMonth(currentYM),
    fetchDebitorkaInForMonth(currentYM),
    fetchPeriod(fmtDay(sevenAgoMs), fmtDay(now.getTime())),
    fetchPurchaseTotalsByMonth(),
  ]);
  const retailDailyAvg = Math.round(rolling7.retailRevenue / 7);
  const daysInMo       = monthBounds(currentYM).days;
  const retailForecast = retailDailyAvg * daysInMo;
  const expectedRev    = retailForecast + debitorkaIn;
  console.log(`  ✓ Остаток нач. месяца: ${Math.round(openingBalance).toLocaleString()} ฿`);
  console.log(`  ✓ Прогноз retail: ${retailDailyAvg.toLocaleString()}/день × ${daysInMo} = ${retailForecast.toLocaleString()} ฿`);
  console.log(`  ✓ Дебиторка ожид. в мес.: ${Math.round(debitorkaIn).toLocaleString()} ฿`);
  console.log(`  ✓ Прогноз выручки: ${Math.round(expectedRev).toLocaleString()} ฿`);
  console.log(`  ✓ Кредиторка не-Paid в мес.: ${Math.round(kreditorkaDue).toLocaleString()} ฿`);
  console.log(`  ✓ Закупки помесячно: ${purchases.size} месяцев в Supabase\n`);

  // Build P&L по месяцам (2025-01 → currentYM)
  const pnl = buildPnL(summary, purchases, mandatoryFixed, PNL_START_YM, currentYM);
  console.log(`[3.9/4] P&L по месяцам (со сдвигом закупок −1 мес.):`);
  for (const p of pnl) {
    const sign = p.profit >= 0 ? "+" : "−";
    console.log(`  ${p.ym}: rev ${Math.round(p.revenue).toLocaleString().padStart(10)} − exp ${Math.round(p.expenses).toLocaleString().padStart(10)} = ${sign}${Math.round(Math.abs(p.profit)).toLocaleString()} ฿`);
  }
  console.log("");

  console.log(`[4/4] Writing to Google Sheets...`);
  const [dataSheetId, dashSheetId] = await Promise.all([ensureTab(DATA_TAB), ensureTab(DASH_TAB)]);

  const ranges = await writeDataSheet(dataSheetId, currentYM, curData, lyData, summary, todayDay, updatedAt, mandatoryFixed, weekly, retailDailyAvg, pnl);
  console.log(`  ✓ Data written to "${DATA_TAB}".`);

  await writeDashboard(dashSheetId, dataSheetId, currentYM, curData, lyData, summary, { ...ranges, tableRows }, mandatoryFixed, openingBalance, kreditorkaDue, retailDailyAvg, debitorkaIn, pnl.length);
  console.log(`  ✓ Dashboard updated in "${DASH_TAB}".`);

  const plan = lyData.total * 1.25;
  const pct  = plan > 0 ? (curData.total / plan) * 100 : 0;
  const threshold = mandatoryFixed + curData.total * REVENUE_BONUS_PCT;
  const profit    = curData.totalGP - threshold;
  console.log(`\n✓ Done.`);
  console.log(`  Факт: ${Math.round(curData.total).toLocaleString()} THB`);
  console.log(`  План: ${Math.round(plan).toLocaleString()} THB`);
  console.log(`  Выполнение: ${pct.toFixed(1)}%`);
  console.log(`  GP: ${Math.round(curData.totalGP).toLocaleString()} THB · Отсечка: ${Math.round(threshold).toLocaleString()} · Прибыль: ${profit >= 0 ? "+" : "−"}${Math.round(Math.abs(profit)).toLocaleString()} THB`);
  console.log(`\n  → https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
