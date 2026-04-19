/**
 * sync_dashboard.ts
 * Writes sales data to "Данные" sheet, draws charts in "Dashboard" sheet.
 *
 * Usage:
 *   npx tsx scripts/sync_dashboard.ts            # current month
 *   npx tsx scripts/sync_dashboard.ts 2026-03    # specific month
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SHEET_ID   = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const DATA_TAB   = "Данные";
const DASH_TAB   = "Dashboard";

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
    requests: [{ updateCells: { range: { sheetId }, fields: "userEnteredValue,userEnteredFormat,dataValidation" } }],
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

interface DayData { revenue: number; gp: number; checks: number; }

interface PeriodStats {
  revenue: number; gp: number; checks: number; uniqueCustomers: number;
}

async function fetchPeriod(from: string, to: string): Promise<PeriodStats> {
  const receipts: any[] = await loyverseFetch(
    `/receipts?receipt_type=SALE&created_at_min=${new Date(from).toISOString()}&created_at_max=${new Date(to + "T23:59:59").toISOString()}`,
    "receipts"
  );
  let revenue = 0, gp = 0, checks = 0;
  const customers = new Set<string>();
  for (const r of receipts) {
    let cost = 0;
    for (const li of r.line_items ?? []) cost += li.cost_total ?? 0;
    revenue += r.total_money ?? 0;
    gp += (r.total_money ?? 0) - cost;
    checks++;
    if (r.customer_id) customers.add(r.customer_id);
  }
  return { revenue, gp, checks, uniqueCustomers: customers.size };
}

async function fetchMonth(ym: string): Promise<{ byDay: Map<number,DayData>; total: number; totalGP: number; checks: number; uniqueCustomers: number }> {
  const { from, to } = monthBounds(ym);
  const receipts: any[] = await loyverseFetch(
    `/receipts?receipt_type=SALE&created_at_min=${new Date(from).toISOString()}&created_at_max=${new Date(to+"T23:59:59").toISOString()}`,
    "receipts"
  );
  const byDay = new Map<number, DayData>();
  const customers = new Set<string>();
  let total = 0, totalGP = 0, checks = 0;
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
  }
  return { byDay, total, totalGP, checks, uniqueCustomers: customers.size };
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

interface TableRow { label: string; stats: PeriodStats; bold?: boolean; }

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
  const ytdStats: PeriodStats = { revenue: 0, gp: 0, checks: 0, uniqueCustomers: 0 };
  for (const { ym, cur } of summary) {
    if (ym.startsWith(String(cy))) {
      ytdStats.revenue += cur.total;
      ytdStats.gp += cur.totalGP;
      ytdStats.checks += cur.checks;
      ytdStats.uniqueCustomers += cur.uniqueCustomers;
    }
  }

  // Last year: sum of all 2025 months in summary
  const lyStats: PeriodStats = { revenue: 0, gp: 0, checks: 0, uniqueCustomers: 0 };
  for (const { ym, cur, last } of summary) {
    if (ym.startsWith(String(cy))) {
      // last = same month last year (e.g. Jan-Apr 2025)
      lyStats.revenue += last.total;
      lyStats.gp += last.totalGP;
      lyStats.checks += last.checks;
      lyStats.uniqueCustomers += last.uniqueCustomers;
    } else {
      // cur = a 2025 month (May-Dec 2025)
      lyStats.revenue += cur.total;
      lyStats.gp += cur.totalGP;
      lyStats.checks += cur.checks;
      lyStats.uniqueCustomers += cur.uniqueCustomers;
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
  };
  const lastMonthStats: PeriodStats = {
    revenue: lastMonthData.total, gp: lastMonthData.totalGP,
    checks: lastMonthData.checks, uniqueCustomers: lastMonthData.uniqueCustomers,
  };

  return [
    { label: "Текущая неделя",   stats: thisWeekStats },
    { label: "Прошлая неделя",   stats: lastWeekStats },
    { label: "Текущий месяц",    stats: curMonthStats },
    { label: "Прошлый месяц",    stats: lastMonthStats },
    { label: "С начала года",    stats: ytdStats },
    { label: `${cy - 1} год`,    stats: lyStats, bold: true },
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
  for (const { ym, cur, last } of summary) {
    const [y] = ym.split("-").map(Number);
    if (y === 2026) {
      ytd      += cur.total;    // 2026 fact
      full2025 += last.total;   // corresponding 2025 month
    } else {
      full2025 += cur.total;    // 2025 months that appear as "cur"
    }
  }
  const plan      = full2025 * 1.25;
  const pct       = plan > 0 ? (ytd / plan) * 100 : 0;
  const remaining = Math.max(0, plan - ytd);
  const curYear   = new Date(Date.now() + 7 * 3600_000).getUTCFullYear();
  return { ytd, full2025, plan, pct, remaining, curYear, prevYear_: curYear - 1 };
}

async function fetchSummary(currentYM: string, n = 6) {
  const [cy, cm] = currentYM.split("-").map(Number);
  const months: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    let m = cm - i, y = cy;
    while (m <= 0) { m += 12; y--; }
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  const rows = [];
  for (const ym of months) {
    const ly = prevYear(ym);
    process.stdout.write(`  ${ym} / ${ly}... `);
    const [cur, last] = await Promise.all([fetchMonth(ym), fetchMonth(ly)]);
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
  const monthlyHeader = ["Месяц", "Факт 2026 (тыс.)", "Факт 2025 (тыс.)", "Прирост +25% (тыс.)", "% плана", "Чеков", "GP%"];
  const monthlyRows: any[][] = [monthlyHeader];
  for (const { ym, cur, last, plan, pct } of summary) {
    const gp = cur.total > 0 ? (cur.totalGP / cur.total) * 100 : 0;
    monthlyRows.push([
      monthLabel(ym),
      Math.round(cur.total / 1000),
      Math.round(last.total / 1000),
      Math.round(last.total * 0.25 / 1000),
      +pct.toFixed(1),
      cur.checks,
      +gp.toFixed(1),
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

  // Write all sections
  await writeValues(DATA_TAB, "A1", dailyRows);

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

  // Format header rows dark
  const dark  = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };

  const fmtRequests: any[] = [
    // Daily header
    headerFmt(dataSheetId, 0, 1, 0, 4, dark, white),
    // Monthly header
    headerFmt(dataSheetId, monthlyStartRow - 1, monthlyStartRow, 0, 7, dark, white),
    // Monthly numeric columns B/C/D — format as "# ##0" (thousands with space separator)
    {
      repeatCell: {
        range: { sheetId: dataSheetId, startRowIndex: monthlyStartRow, endRowIndex: monthlyStartRow + summary.length, startColumnIndex: 1, endColumnIndex: 4 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "# ##0" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    // KPI header
    headerFmt(dataSheetId, kpiStartRow - 1, kpiStartRow, 0, 2, dark, white),
    // Annual header
    headerFmt(dataSheetId, annualStartRow - 1, annualStartRow, 0, 5, dark, white),
    // Auto-resize
    { autoResizeDimensions: { dimensions: { sheetId: dataSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 7 } } },
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

  const annualBlock = [
    // Row 0: title
    [`Wine & Whiskey — Годовой план ${annuals.curYear}`, ...new Array(9).fill("")],
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
  // KPI header block (rows 6-12, cols 0-7)
  const kpiValues = [
    [`${monthLabel(currentYM)} — текущий месяц`],
    [],
    ["Факт", "", "Прошлый год", "", "План (LY ×1.25)", "", "% плана"],
    [
      `${f(curData.total)}`, "",
      `${f(lyData.total)}`, "",
      `${f(plan)}`, "",
      `${pct.toFixed(1)}%`,
    ],
    [],
    ["Gross Profit", "", "Маржа GP", "", "Осталось до плана", "", "Ср. чек"],
    [
      `${f(curData.totalGP)}`, "",
      `${gpPct.toFixed(1)}%`, "",
      `${f(rem)}`, "",
      `${f(curData.checks > 0 ? curData.total / curData.checks : 0)}`,
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
    // Label rows (8, 11)
    ...([8, 11] as const).map(r => ({
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 8 },
        cell: { userEnteredFormat: { backgroundColor: wine, textFormat: { bold: true, fontSize: 10, foregroundColor: white } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    })),
    // Value rows (9, 12)
    ...([9, 12] as const).map(r => ({
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 8 },
        cell: { userEnteredFormat: { backgroundColor: lightGray, textFormat: { bold: true, fontSize: 13 } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    })),
    // Merge monthly title
    { mergeCells: { range: { sheetId: dashSheetId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: "MERGE_ALL" } },

    // Freeze top 13 rows
    { updateSheetProperties: { properties: { sheetId: dashSheetId, gridProperties: { frozenRowCount: 13 } }, fields: "gridProperties.frozenRowCount" } },
    // Column widths
    { updateDimensionProperties: { range: { sheetId: dashSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 8 }, properties: { pixelSize: 160 }, fields: "pixelSize" } },
  ];

  await sheets("POST", ":batchUpdate", { requests: fmtReqs });

  // ── Summary table (rows 14+) ──
  if (ranges.tableRows && ranges.tableRows.length > 0) {
    const TABLE_START = 14; // row index
    const COL_COUNT = 6; // Период + 5 числовых (без Клиентов)
    const colHeaders = ["Период", "Выручка, ฿", "Чеков", "Gross Profit, ฿", "GP%", "Ср. чек, ฿"];
    const tableValues: (string|number)[][] = [colHeaders];
    for (const { label, stats } of ranges.tableRows) {
      const gpPct = stats.revenue > 0 ? (stats.gp / stats.revenue * 100) : 0;
      const avgCheck = stats.checks > 0 ? stats.revenue / stats.checks : 0;
      tableValues.push([
        label,
        Math.round(stats.revenue),
        stats.checks,
        Math.round(stats.gp),
        +gpPct.toFixed(1),
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
            numberFormat: { type: "NUMBER", pattern: "# ##0" },
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
              anchorCell: { sheetId: dashSheetId, rowIndex: 23, columnIndex: 0 },
              widthPixels: 1400,
              heightPixels: 420,
            },
          },
        },
      },
    },

    // ── Chart 2: Monthly COMBO — stacked plan (LY + +25%) + fact line ──
    {
      addChart: {
        chart: {
          spec: {
            title: "Помесячно: План (Факт 2025 + прирост 25%) vs Факт 2026",
            titleTextFormat: { bold: true, fontSize: 13 },
            basicChart: {
              chartType: "COMBO",
              stackedType: "STACKED",
              legendPosition: "RIGHT_LEGEND",
              axis: [
                { position: "BOTTOM_AXIS" },
                { position: "LEFT_AXIS", title: "тыс. THB" },
              ],
              domains: [{ domain: { sourceRange: { sources: [dataRange(0, 1, monthlyRange.start, monthlyRange.end)] } } }],
              series: [
                // Факт 2025 — серый столбец (стак-база плана)
                {
                  series: { sourceRange: { sources: [dataRange(2, 3, monthlyRange.start, monthlyRange.end)] } },
                  targetAxis: "LEFT_AXIS",
                  type: "COLUMN",
                  color: grayBlue,
                  dataLabel: { type: "DATA", placement: "INSIDE_BASE", textFormat: { fontSize: 9, foregroundColor: { red: 1, green: 1, blue: 1 } } },
                },
                // +25% прирост — оранжевый столбец (стак-верх плана)
                {
                  series: { sourceRange: { sources: [dataRange(3, 4, monthlyRange.start, monthlyRange.end)] } },
                  targetAxis: "LEFT_AXIS",
                  type: "COLUMN",
                  color: { red: 0.98, green: 0.73, blue: 0.42, alpha: 1 },
                  dataLabel: { type: "DATA", placement: "OUTSIDE_END", textFormat: { fontSize: 9, bold: true } },
                },
                // Факт 2026 — тёмно-красная линия поверх
                {
                  series: { sourceRange: { sources: [dataRange(1, 2, monthlyRange.start, monthlyRange.end)] } },
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
              anchorCell: { sheetId: dashSheetId, rowIndex: 47, columnIndex: 0 },
              widthPixels: 1400,
              heightPixels: 700,
            },
          },
        },
      },
    },
  ];

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

  console.log(`[3/4] Fetching 12-month summary...`);
  const summary = await fetchSummary(currentYM, 12);

  console.log(`\n[3.5/4] Fetching summary table data...`);
  const tableRows = await fetchSummaryTable(currentYM, curData, summary);
  console.log(`  ✓ ${tableRows.length} rows fetched.\n`);

  console.log(`[4/4] Writing to Google Sheets...`);
  const [dataSheetId, dashSheetId] = await Promise.all([ensureTab(DATA_TAB), ensureTab(DASH_TAB)]);

  const ranges = await writeDataSheet(dataSheetId, currentYM, curData, lyData, summary, todayDay, updatedAt);
  console.log(`  ✓ Data written to "${DATA_TAB}".`);

  await writeDashboard(dashSheetId, dataSheetId, currentYM, curData, lyData, summary, { ...ranges, tableRows });
  console.log(`  ✓ Dashboard updated in "${DASH_TAB}".`);

  const plan = lyData.total * 1.25;
  const pct  = plan > 0 ? (curData.total / plan) * 100 : 0;
  console.log(`\n✓ Done.`);
  console.log(`  Факт: ${Math.round(curData.total).toLocaleString()} THB`);
  console.log(`  План: ${Math.round(plan).toLocaleString()} THB`);
  console.log(`  Выполнение: ${pct.toFixed(1)}%`);
  console.log(`\n  → https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
