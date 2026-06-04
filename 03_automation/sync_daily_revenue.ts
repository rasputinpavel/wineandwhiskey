/**
 * sync_daily_revenue.ts
 * Daily revenue per day (B2C, B2B, Total, GP, GP%) on the "Daily" tab.
 *
 * Layout (rebuilt every run):
 *   Row 1: header (frozen)
 *   Row 2..N: data, one row per day
 *   Chart: anchored at H1, stacked column (B2C + B2B) + line for GP on right axis
 *
 * Incremental: existing days are read back and re-written without re-fetching
 * Loyverse. Only days after the last existing date (or after `--from` arg) are
 * fetched fresh.
 *
 * Usage:
 *   npx tsx 03_automation/sync_daily_revenue.ts                # last existing day → today
 *   npx tsx 03_automation/sync_daily_revenue.ts 2026-04-01     # also include any missing days from this date
 */

import dotenv from "dotenv";
import { BANK_TRANSFER_TYPE_ID, isB2BCustomerName } from "./lib/b2b.js";
import { loyverseFetch } from "./lib/loyverse.js";
dotenv.config({ path: ".env.local" });

const SHEET_ID = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const TAB      = "Daily";
const BACKFILL_START = "2026-04-01";

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

// ─── Bangkok helpers ───────────────────────────────────────────────────────

function bangkokNow() { return new Date(Date.now() + 7 * 3600_000); }

function ymd(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function addDays(ymdStr: string, n: number): string {
  const [y, m, d] = ymdStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return ymd(dt);
}

function daysBetween(fromYMD: string, toYMD: string): string[] {
  const out: string[] = [];
  let cur = fromYMD;
  while (cur <= toYMD) { out.push(cur); cur = addDays(cur, 1); }
  return out;
}

// ─── Google Sheets ─────────────────────────────────────────────────────────

let _token: string | null = null;
async function gToken() {
  if (_token) return _token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token",
    }),
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
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 0, frozenColumnCount: 0 } }, fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount" } },
    ],
  });
}

async function deleteCharts(sheetId: number) {
  const meta = await sheets("GET", "");
  const target = (meta.sheets ?? []).find((s: any) => s.properties.sheetId === sheetId);
  const charts: any[] = target?.charts ?? [];
  if (!charts.length) return;
  await sheets("POST", ":batchUpdate", {
    requests: charts.map((c: any) => ({ deleteEmbeddedObject: { objectId: c.chartId } })),
  });
}

async function deleteBandings(sheetId: number) {
  const meta = await sheets("GET", "?includeGridData=false");
  const target = (meta.sheets ?? []).find((s: any) => s.properties.sheetId === sheetId);
  const bandings: any[] = target?.bandedRanges ?? [];
  if (!bandings.length) return;
  await sheets("POST", ":batchUpdate", {
    requests: bandings.map((b: any) => ({ deleteBanding: { bandedRangeId: b.bandedRangeId } })),
  });
}

async function writeValues(range: string, values: any[][]) {
  // RAW so YYYY-MM-DD strings stay strings (USER_ENTERED converts them to date serials)
  await sheets(
    "PUT",
    `/values/${encodeURIComponent(`${TAB}!${range}`)}?valueInputOption=RAW`,
    { range: `${TAB}!${range}`, majorDimension: "ROWS", values },
  );
}

/** Read all existing data rows, returning parsed numeric values (raw, not display strings). */
async function readExistingRows(): Promise<Array<[string, number, number, number, number, number]>> {
  // Search anywhere in the sheet for date strings (handles old layout where header was at row 22)
  const range = `${TAB}!A1:F2000`;
  const res = await sheets("GET", `/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);
  const values = (res.values ?? []) as any[][];
  const out: Array<[string, number, number, number, number, number]> = [];
  for (const row of values) {
    if (!row || row.length === 0) continue;
    const a = row[0];
    // Match YYYY-MM-DD strings
    if (typeof a === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a)) {
      out.push([
        a,
        Number(row[1] ?? 0),
        Number(row[2] ?? 0),
        Number(row[3] ?? 0),
        Number(row[4] ?? 0),
        Number(row[5] ?? 0),
      ]);
    }
  }
  // Sort by date ascending (in case sheet had unsorted rows)
  out.sort((x, y) => x[0].localeCompare(y[0]));
  return out;
}

// ─── Loyverse ──────────────────────────────────────────────────────────────

function isBankTransfer(receipt: any): boolean {
  return (receipt.payments ?? []).some((p: any) => p.payment_type_id === BANK_TRANSFER_TYPE_ID);
}

let _b2bIdsPromise: Promise<Set<string>> | null = null;
function getB2BCustomerIds(): Promise<Set<string>> {
  if (_b2bIdsPromise) return _b2bIdsPromise;
  _b2bIdsPromise = (async () => {
    const customers = await loyverseFetch<any>("/customers", "customers");
    const ids = new Set<string>();
    for (const c of customers) if (isB2BCustomerName(c.name ?? "")) ids.add(c.id);
    return ids;
  })();
  return _b2bIdsPromise;
}

function isB2BReceipt(r: any, b2bIds: Set<string>): boolean {
  return isBankTransfer(r) || (!!r.customer_id && b2bIds.has(r.customer_id));
}

interface DayStats { revenue: number; gp: number; b2c: number; b2b: number; }

async function fetchRange(fromYMD: string, toYMD: string): Promise<Map<string, DayStats>> {
  const fromUTC = new Date(`${fromYMD}T00:00:00+07:00`).toISOString();
  const toUTC   = new Date(`${toYMD}T23:59:59+07:00`).toISOString();
  const [receipts, b2bIds] = await Promise.all([
    loyverseFetch<any>(
      `/receipts?receipt_type=SALE&created_at_min=${fromUTC}&created_at_max=${toUTC}`,
      "receipts",
    ),
    getB2BCustomerIds(),
  ]);
  const byDay = new Map<string, DayStats>();
  for (const r of receipts) {
    if (r.cancelled_at) continue;                       // voided — never a sale
    const sign = r.receipt_type === "REFUND" ? -1 : 1;  // refunds reduce net sales
    const bkk = new Date(new Date(r.receipt_date).getTime() + 7 * 3600_000);
    const day = ymd(bkk);
    let cost = 0;
    for (const li of r.line_items ?? []) cost += li.cost_total ?? 0;
    const rev = (r.total_money ?? 0) * sign;
    const gp  = rev - cost * sign;
    const cur = byDay.get(day) ?? { revenue: 0, gp: 0, b2c: 0, b2b: 0 };
    cur.revenue += rev;
    cur.gp      += gp;
    if (isB2BReceipt(r, b2bIds)) cur.b2b += rev; else cur.b2c += rev;
    byDay.set(day, cur);
  }
  return byDay;
}

function buildRow(date: string, s: DayStats | undefined): [string, number, number, number, number, number] {
  const stats = s ?? { revenue: 0, gp: 0, b2c: 0, b2b: 0 };
  const gpPct = stats.revenue > 0 ? (stats.gp / stats.revenue) * 100 : 0;
  return [
    date,
    Math.round(stats.b2c),
    Math.round(stats.b2b),
    Math.round(stats.revenue),
    Math.round(stats.gp),
    +gpPct.toFixed(1),
  ];
}

// ─── Layout: rebuild header + data + chart ─────────────────────────────────

async function rebuildLayout(sheetId: number, allRows: Array<[string, number, number, number, number, number]>) {
  await clearTab(sheetId);
  await deleteCharts(sheetId);
  await deleteBandings(sheetId);

  // Header at row 1
  const header = [["Дата", "B2C, ฿", "B2B, ฿", "Итого, ฿", "Gross Profit, ฿", "GP%"]];
  await writeValues("A1:F1", header);

  // Data starts at row 2
  if (allRows.length > 0) {
    await writeValues(`A2:F${1 + allRows.length}`, allRows);
  }

  const lastRow = 1 + allRows.length; // 1-indexed last data row
  const dark      = { red: 0.15, green: 0.15, blue: 0.15 };
  const white     = { red: 1,    green: 1,    blue: 1    };
  const bandLight = { red: 0.97, green: 0.97, blue: 0.97 };
  const borderClr = { red: 0.85, green: 0.85, blue: 0.85 };
  const border    = { style: "SOLID", colorStyle: { rgbColor: borderClr } };

  const fmtRequests: any[] = [
    // Header style
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
        cell: { userEnteredFormat: {
          backgroundColor: dark,
          textFormat: { bold: true, foregroundColor: white, fontSize: 11 },
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          padding: { top: 4, bottom: 4 },
        }},
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)",
      },
    },
    // Header row height
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 32 }, fields: "pixelSize" } },

    // Freeze row 1 only
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },

    // Column widths
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 110 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 6 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
  ];

  if (allRows.length > 0) {
    fmtRequests.push(
      // B2C / B2B / Итого / GP — thousands separator, right aligned
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: lastRow, startColumnIndex: 1, endColumnIndex: 5 },
          cell: { userEnteredFormat: {
            numberFormat: { type: "NUMBER", pattern: "#,##0" },
            horizontalAlignment: "RIGHT",
            verticalAlignment: "MIDDLE",
            textFormat: { fontSize: 10 },
          }},
          fields: "userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment,textFormat)",
        },
      },
      // GP% — pretty percent
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: lastRow, startColumnIndex: 5, endColumnIndex: 6 },
          cell: { userEnteredFormat: {
            numberFormat: { type: "NUMBER", pattern: "0.0\"%\"" },
            horizontalAlignment: "RIGHT",
            verticalAlignment: "MIDDLE",
            textFormat: { fontSize: 10, bold: true },
          }},
          fields: "userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment,textFormat)",
        },
      },
      // Date column — left aligned
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 1 },
          cell: { userEnteredFormat: {
            horizontalAlignment: "LEFT",
            verticalAlignment: "MIDDLE",
            textFormat: { fontSize: 10 },
          }},
          fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)",
        },
      },
      // Banding (alternating row tint)
      {
        addBanding: {
          bandedRange: {
            range: { sheetId, startRowIndex: 1, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 6 },
            rowProperties: {
              firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
              secondBandColorStyle: { rgbColor: bandLight },
            },
          },
        },
      },
      // Outer border
      {
        updateBorders: {
          range: { sheetId, startRowIndex: 0, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 6 },
          top: border, bottom: border, left: border, right: border,
          innerHorizontal: border, innerVertical: border,
        },
      },
      // Data row height
      { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: lastRow }, properties: { pixelSize: 26 }, fields: "pixelSize" } },
    );
  }

  await sheets("POST", ":batchUpdate", { requests: fmtRequests });

  // Chart anchored at H1 (col index 7), to the right of the data
  if (allRows.length > 0) {
    const wineRed   = { red: 0.482, green: 0.114, blue: 0.114, alpha: 1 };
    const steelBlue = { red: 0.20,  green: 0.47,  blue: 0.71,  alpha: 1 };
    const orange    = { red: 0.976, green: 0.451, blue: 0.024, alpha: 1 };

    const r0 = 0;          // header row index
    const r1 = lastRow;    // exclusive end (= 1 + allRows.length)
    function range(c0: number, c1: number) {
      return { sheetId, startColumnIndex: c0, endColumnIndex: c1, startRowIndex: r0, endRowIndex: r1 };
    }

    await sheets("POST", ":batchUpdate", {
      requests: [{
        addChart: {
          chart: {
            spec: {
              title: "Дневная выручка: B2C + B2B (stacked) + Маржа (линия)",
              titleTextFormat: { bold: true, fontSize: 13 },
              basicChart: {
                chartType: "COMBO",
                stackedType: "STACKED",
                legendPosition: "RIGHT_LEGEND",
                headerCount: 1,
                axis: [
                  { position: "BOTTOM_AXIS", title: "День" },
                  { position: "LEFT_AXIS",   title: "Выручка, ฿" },
                  { position: "RIGHT_AXIS",  title: "Маржа, ฿" },
                ],
                domains: [{ domain: { sourceRange: { sources: [range(0, 1)] } } }],
                series: [
                  { series: { sourceRange: { sources: [range(1, 2)] } }, targetAxis: "LEFT_AXIS",  type: "COLUMN", color: steelBlue },
                  { series: { sourceRange: { sources: [range(2, 3)] } }, targetAxis: "LEFT_AXIS",  type: "COLUMN", color: orange    },
                  { series: { sourceRange: { sources: [range(4, 5)] } }, targetAxis: "RIGHT_AXIS", type: "LINE",   color: wineRed, lineStyle: { width: 3, type: "SOLID" } },
                ],
              },
              backgroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
            },
            position: {
              overlayPosition: {
                anchorCell: { sheetId, rowIndex: 0, columnIndex: 7 },
                widthPixels: 900,
                heightPixels: 420,
              },
            },
          },
        },
      }],
    });
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2]; // optional explicit start YYYY-MM-DD
  const today = ymd(bangkokNow());

  console.log(`\nWine & Whiskey — Daily Revenue Sync`);
  const sheetId = await ensureTab(TAB);

  // 1. Read existing data
  const existing = await readExistingRows();
  const existingMap = new Map(existing.map(r => [r[0], r]));
  const lastDate = existing.length > 0 ? existing[existing.length - 1][0] : null;
  console.log(`  Existing: ${existing.length} day(s)${lastDate ? ` (last: ${lastDate})` : ""}`);

  // 2. Determine fetch range — always re-fetch the last existing day,
  //    because it may have been synced mid-day with partial data.
  const startFromArg = arg ?? null;
  const startFromIncremental = lastDate ?? BACKFILL_START;
  const fetchStart = startFromArg && startFromArg < startFromIncremental ? startFromArg : startFromIncremental;

  // 3. Fetch new days
  let fetched: Map<string, DayStats> = new Map();
  if (fetchStart <= today) {
    console.log(`  Fetching ${fetchStart} → ${today}...`);
    fetched = await fetchRange(fetchStart, today);
  } else {
    console.log(`  No new days to fetch (last: ${lastDate}, today: ${today}).`);
  }

  // 4. Build full row list (existing kept as-is; new days from Loyverse)
  const allDates = new Set<string>([...existing.map(r => r[0]), ...daysBetween(fetchStart, today)]);
  const sortedDates = Array.from(allDates).filter(d => d >= BACKFILL_START && d <= today).sort();
  const allRows = sortedDates.map(d => {
    if (existingMap.has(d) && !fetched.has(d)) return existingMap.get(d)!;
    return buildRow(d, fetched.get(d));
  });

  // 5. Rebuild sheet layout + chart
  await rebuildLayout(sheetId, allRows);

  const newCount = sortedDates.length - existing.length;
  console.log(`  ✓ Wrote ${allRows.length} row(s)${newCount > 0 ? ` (+${newCount} new)` : ""}.`);
  console.log(`\n  → https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
