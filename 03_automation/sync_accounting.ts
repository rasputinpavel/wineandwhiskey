/**
 * sync_accounting.ts
 *
 * Формирует ежемесячный бухгалтерский отчёт в Google Sheets — отдельный файл
 * на месяц, лежит в Drive-папке `Accounting`. Три листа:
 *
 *   1. Sales       — выручка B2C / B2B по дням (Loyverse, Bangkok TZ).
 *   2. Tax Invoices — наши выставленные tax invoice клиентам.
 *                     Я загружаю строки руками; скрипт ищет приход
 *                     (B2B bank-transfer) по сумме и проставляет статус
 *                     «Оплачено / Не оплачено» + дату прихода + receipt #.
 *   3. Expenses    — все purchase order со статусом Closed за месяц
 *                     (из Supabase, наполняется scrape_purchase_orders.ts).
 *
 * Usage:
 *   npm run accounting -- --month 2026-04
 *   npm run accounting -- --month 2026-04 --folder <driveFolderId>
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { BANK_TRANSFER_TYPE_ID, classifyReceipt } from "./lib/b2b.js";
import { canonicalize, loadB2BOverrides } from "./lib/b2b_overrides.js";
import { openFlow, closeFlow, listInvoices, listReceipts, FlowInvoice, FlowReceipt } from "./lib/flow.js";

// ─── Config ──────────────────────────────────────────────────────────────

const DEFAULT_FOLDER_ID = "1afS7_bS-IKkBdfOjEHCLz7SRIoW8lD8N";   // Drive folder "Accounting"
const TAB_SALES         = "Sales";
const TAB_INVOICES      = "Tax Invoices";
const TAB_EXPENSES      = "Expenses";
const TAB_BONUSES       = "Bonuses";
const DEFAULT_COMMISSION_PCT = 1.0;

const LOYVERSE_TOKEN       = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

// Tolerance when matching tax invoice amount → bank transfer receipt amount.
// Loyverse stores baht as integers, but we still allow ±1 ฿ for rounding.
const AMOUNT_TOLERANCE = 1;

// ─── CLI ─────────────────────────────────────────────────────────────────

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1) return process.argv[idx + 1] ?? null;
  const eq = process.argv.find(a => a.startsWith(`--${name}=`));
  return eq ? eq.split("=")[1] : null;
}

const monthArg  = arg("month");
const folderArg = arg("folder") ?? DEFAULT_FOLDER_ID;
const commissionPctArg = (() => {
  const v = arg("commission-pct");
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COMMISSION_PCT;
})();
if (!monthArg || !/^\d{4}-\d{2}$/.test(monthArg)) {
  console.error("Usage: npm run accounting -- --month YYYY-MM [--commission-pct 1.0]");
  process.exit(1);
}

const [yearStr, monthStr] = monthArg.split("-");
const year  = Number(yearStr);
const month = Number(monthStr);
const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
const fromIso = `${monthArg}-01`;
const toIso   = `${monthArg}-${String(lastDay).padStart(2, "0")}`;
const minUtc  = new Date(`${fromIso}T00:00:00+07:00`).toISOString();
const maxUtc  = new Date(`${toIso}T23:59:59+07:00`).toISOString();

const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FILE_TITLE = `Accounting ${monthArg} ${monthNames[month - 1]}`;

// ─── Google OAuth + Sheets/Drive helpers ─────────────────────────────────

let _gToken: string | null = null;
async function gToken(): Promise<string> {
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

async function gFetch(url: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${await gToken()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${url}: ${r.status} ${await r.text()}`);
  if (r.status === 204) return {};
  return r.json();
}

async function findOrCreateSpreadsheet(folderId: string, title: string): Promise<string> {
  // Drive API search — drive.file scope only sees files this app has touched,
  // so a fresh re-run after manual deletion will create a new file. That's OK
  // for accounting (each month is a fresh file anyway).
  const q = encodeURIComponent(
    `'${folderId}' in parents and name='${title}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`
  );
  const search = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  if (search.files?.length) {
    console.log(`  Reusing existing spreadsheet "${title}" (${search.files[0].id})`);
    return search.files[0].id as string;
  }
  console.log(`  Creating spreadsheet "${title}" in folder...`);
  // Create via Drive API so we can set parents directly. Sheets API .create()
  // doesn't accept parents — would land in My Drive root.
  const created = await gFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    body: JSON.stringify({
      name: title,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [folderId],
    }),
  });
  return created.id as string;
}

async function sheets(sid: string, method: string, path: string, body?: unknown) {
  return gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}${path}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function ensureTab(sid: string, title: string): Promise<{ id: number; existed: boolean }> {
  const meta = await sheets(sid, "GET", "");
  const existing = (meta.sheets ?? []).find((s: any) => s.properties.title === title);
  if (existing) return { id: existing.properties.sheetId, existed: true };
  const res = await sheets(sid, "POST", ":batchUpdate", {
    requests: [{ addSheet: { properties: { title } } }],
  });
  return { id: res.replies[0].addSheet.properties.sheetId, existed: false };
}

async function clearTab(sid: string, sheetId: number) {
  await sheets(sid, "POST", ":batchUpdate", {
    requests: [
      { unmergeCells: { range: { sheetId } } },
      { updateCells: { range: { sheetId }, fields: "userEnteredValue,userEnteredFormat,dataValidation" } },
    ],
  });
}

async function writeRows(sid: string, sheetId: number, rows: any[][]) {
  if (!rows.length) return;
  const maxCols = Math.max(...rows.map(r => r.length));
  await sheets(sid, "POST", ":batchUpdate", {
    requests: [{
      updateCells: {
        start: { sheetId, rowIndex: 0, columnIndex: 0 },
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

async function readRange(sid: string, range: string): Promise<any[][]> {
  try {
    const r = await gFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`
    );
    return r.values ?? [];
  } catch {
    return [];
  }
}

async function deleteDefaultSheet1(sid: string) {
  // New spreadsheets start with a sheet named "Sheet1" — drop it once we have real tabs.
  const meta = await sheets(sid, "GET", "");
  const sheet1 = (meta.sheets ?? []).find((s: any) =>
    s.properties.title === "Sheet1" || s.properties.title === "Лист1"
  );
  if (!sheet1) return;
  // Sheets API rejects deleting the last remaining sheet — only delete if >1 remain.
  if ((meta.sheets ?? []).length <= 1) return;
  await sheets(sid, "POST", ":batchUpdate", {
    requests: [{ deleteSheet: { sheetId: sheet1.properties.sheetId } }],
  });
}

// ─── Loyverse helpers ────────────────────────────────────────────────────

async function loy<T>(path: string, key: string): Promise<T[]> {
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
    } catch { /* silent */ }
  }));
  return map;
}

function bangkokDateOf(iso: string): string {
  // ISO timestamp from Loyverse is UTC; shift +7h and take the calendar date.
  return new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

// ─── Sheet 1: Sales by day, B2C / B2B ────────────────────────────────────

interface DayBucket { b2cRev: number; b2cChecks: number; b2bRev: number; b2bChecks: number; }

interface SalesPayload {
  byDay: Map<string, DayBucket>;
  totals: DayBucket;
  // All B2B receipts (management classifier: bank transfer OR B2B_PATTERNS name).
  // Used for per-receipt matching against FlowAccount receipts in reconciliation —
  // but only the bank-transfer subset (isBankTransfer=true) is expected to match
  // a Flow receipt. Card/cash-paid B2B-named sales are management-only.
  b2bReceipts: Array<{ date: string; receiptNumber: string; total: number; customerName: string; isBankTransfer: boolean }>;
}

async function buildSalesPayload(): Promise<SalesPayload> {
  console.log(`[Sales] Fetching receipts ${fromIso} → ${toIso}...`);
  // Loyverse silently ignores ?receipt_type= — same query returns SALE+REFUND mixed.
  // Pull once and split on r.receipt_type client-side.
  const all: any[] = await loy(
    `/receipts?created_at_min=${minUtc}&created_at_max=${maxUtc}`,
    "receipts",
  );
  // Cancelled receipts stay in the Loyverse list with cancelled_at set — skip them so
  // a voided bank-transfer SALE doesn't show up as an unmatched B2B receipt in reco.
  const live = all.filter(r => !r.cancelled_at);
  const cancelled = all.length - live.length;
  const receipts = live.filter(r => r.receipt_type === "SALE");
  const refunds  = live.filter(r => r.receipt_type === "REFUND");
  console.log(`  ${receipts.length} sales, ${refunds.length} refunds${cancelled ? ` (skipped ${cancelled} cancelled)` : ""}`);

  const custIds = new Set<string>();
  for (const r of [...receipts, ...refunds]) if (r.customer_id) custIds.add(r.customer_id);
  const custNames = await fetchCustomerNames(custIds);
  const overrides = await loadB2BOverrides();

  const byDay = new Map<string, DayBucket>();
  const totals: DayBucket = { b2cRev: 0, b2cChecks: 0, b2bRev: 0, b2bChecks: 0 };
  const b2bReceipts: SalesPayload["b2bReceipts"] = [];

  // Initialize buckets for every day in the month so empty days still show 0.
  for (let d = 1; d <= lastDay; d++) {
    const key = `${monthArg}-${String(d).padStart(2, "0")}`;
    byDay.set(key, { b2cRev: 0, b2cChecks: 0, b2bRev: 0, b2bChecks: 0 });
  }

  // Single B2B classifier across the whole report: lib/b2b.ts::classifyReceipt.
  // A sale is B2B iff payment_type = Bank Transfer OR customer_name ∈ B2B_PATTERNS.
  // The same rule drives Sales tab, Bonuses tab and the Loyverse↔Flow reconciliation
  // — Sales B2B revenue should equal Flow receipts. Mismatches mean either
  // (1a/1b) missing/unneeded Flow receipt, (2a/2b/2c) phantom Flow receipt — see
  // ACCOUNTING.md decision tree.
  //
  // 08_config/b2b_overrides.json::force_b2c_receipts overrides a specific receipt
  // back to B2C when the management rule fires but no Flow receipt will be issued
  // (walk-in corp client picked stock off the shelf, paid out-of-pocket).
  const forceB2C = new Set<string>();
  try {
    const cfgPath = nodePath.join(process.cwd(), "08_config", "b2b_overrides.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      for (const ent of cfg.force_b2c_receipts ?? []) {
        if (ent?.receipt_number) forceB2C.add(String(ent.receipt_number));
      }
    }
  } catch (e) { console.warn("[Sales] failed to load b2b_overrides.json:", e); }

  function classify(r: any): { isB2B: boolean; customerName: string } {
    let customerName = r.customer_id ? (custNames.get(r.customer_id) ?? "") : "";
    if (!customerName) {
      const ovr = overrides.get(String(r.receipt_number ?? ""));
      if (ovr) customerName = ovr;
    } else {
      customerName = canonicalize(customerName);
    }
    let { isB2B } = classifyReceipt({ payments: r.payments, customerName });
    if (isB2B && forceB2C.has(String(r.receipt_number ?? ""))) isB2B = false;
    return { isB2B, customerName };
  }

  // Sales count toward revenue; refunds subtract revenue but don't reduce check count
  // (a refund is its own receipt — counting it would double-count or go negative).
  for (const r of receipts) {
    const day = bangkokDateOf(r.created_at);
    if (!byDay.has(day)) continue;
    const bucket = byDay.get(day)!;
    const cls = classify(r);
    const total = Number(r.total_money ?? 0);
    if (cls.isB2B) {
      bucket.b2bRev += total; bucket.b2bChecks++; totals.b2bRev += total; totals.b2bChecks++;
      const isBankTransfer = (r.payments ?? []).some((p: any) => p.payment_type_id === BANK_TRANSFER_TYPE_ID);
      b2bReceipts.push({
        date: day,
        receiptNumber: String(r.receipt_number ?? ""),
        total,
        customerName: cls.customerName,
        isBankTransfer,
      });
    } else { bucket.b2cRev += total; bucket.b2cChecks++; totals.b2cRev += total; totals.b2cChecks++; }
  }
  for (const r of refunds) {
    const day = bangkokDateOf(r.created_at);
    if (!byDay.has(day)) continue;
    const bucket = byDay.get(day)!;
    const cls = classify(r);
    const total = Number(r.total_money ?? 0);
    if (cls.isB2B) { bucket.b2bRev -= total; totals.b2bRev -= total; }
    else            { bucket.b2cRev -= total; totals.b2cRev -= total; }
  }

  return { byDay, totals, b2bReceipts };
}

async function writeSalesTab(sid: string, payload: SalesPayload) {
  const { id: sheetId } = await ensureTab(sid, TAB_SALES);
  await clearTab(sid, sheetId);

  const rows: any[][] = [];
  rows.push([`Sales Report · ${FILE_TITLE}`]);
  rows.push([]);
  rows.push(["Date", "B2C revenue ฿", "B2B revenue ฿", "Total ฿"]);
  const headerRow = rows.length - 1;
  const dataStart = rows.length;

  for (const [day, b] of [...payload.byDay.entries()].sort()) {
    rows.push([
      day,
      Math.round(b.b2cRev),
      Math.round(b.b2bRev),
      Math.round(b.b2cRev + b.b2bRev),
    ]);
  }
  const dataEnd = rows.length;
  const t = payload.totals;
  rows.push([
    "TOTAL",
    Math.round(t.b2cRev),
    Math.round(t.b2bRev),
    Math.round(t.b2cRev + t.b2bRev),
  ]);
  const totalRow = rows.length - 1;

  await writeRows(sid, sheetId, rows);

  const dark = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  const FMT_BAHT = { type: "CURRENCY", pattern: "#,##0\\ \"฿\"" };

  await sheets(sid, "POST", ":batchUpdate", {
    requests: [
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: headerRow + 1 } }, fields: "gridProperties.frozenRowCount" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 110 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 4 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 }, mergeType: "MERGE_ALL" } },
      { repeatCell: { range: { sheetId, startRowIndex: headerRow, endRowIndex: headerRow + 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
      { repeatCell: { range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 1, endColumnIndex: 4 }, cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } },
      { repeatCell: { range: { sheetId, startRowIndex: totalRow, endRowIndex: totalRow + 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true }, numberFormat: FMT_BAHT } }, fields: "userEnteredFormat(backgroundColor,textFormat,numberFormat)" } },
    ],
  });
  console.log(`  ✓ "${TAB_SALES}" written (${payload.byDay.size} days)`);
}

// ─── Sheet 2: Tax invoices ───────────────────────────────────────────────

// Tax Invoices tab is fully auto-generated from FlowAccount via Playwright.
// Layout:
//   Row 1: title
//   Row 2: source/timestamp note
//   Row 3: header
//   Rows 4..N: April invoices (sorted by issue date desc)
//   Row N+2: section header "Receipts received this month for prior invoices"
//   Rows N+3..M: stray receipts (payments that didn't match any April invoice)

const INVOICE_HEADERS = ["Tax Invoice #", "Issue date", "Client", "Amount ฿", "Status", "Payment date", "Receipt #", "Note"];
const STRAY_HEADERS   = ["Receipt #", "Date", "Client", "Amount ฿", "Note"];

function clientKey(s: string): string {
  return s.toLowerCase().replace(/[^a-zа-я0-9]/gi, "");
}

// Match invoices ↔ Flow receipts by (client + amount±tolerance). Sets
// linkedReceipts on each invoice; returns the receipts that didn't match
// anything (the "stray" list — likely paying prior-month invoices).
function matchInvoicesAndReceipts(invoices: FlowInvoice[], receipts: FlowReceipt[]): FlowReceipt[] {
  const remaining = receipts.slice();
  for (const inv of invoices) {
    const ic = clientKey(inv.client);
    // Match by client+amount; prefer earliest receipt with date >= invoice date.
    const candidates = remaining.filter(r =>
      clientKey(r.client) === ic &&
      Math.abs(r.amount - inv.amount) <= AMOUNT_TOLERANCE
    );
    candidates.sort((a, b) => a.date.localeCompare(b.date));
    const pick = candidates.find(r => r.date >= inv.issueDate) ?? candidates[0];
    if (pick) {
      inv.linkedReceipts.push({ number: pick.number, date: pick.date, amount: pick.amount });
      const idx = remaining.indexOf(pick);
      remaining.splice(idx, 1);
    }
  }
  return remaining;
}

async function clearConditionalFormats(sid: string, sheetId: number) {
  // Sheets API doesn't clear conditional rules in updateCells. Without this,
  // every run adds 2 more rules → after ~10 runs the sheet ends up with 18+
  // rules and the UI starts to misrender (cells appear blank).
  const meta = await sheets(sid, "GET", "?fields=sheets(properties.sheetId,conditionalFormats)");
  const sheet = (meta.sheets ?? []).find((s: any) => s.properties.sheetId === sheetId);
  const existing = sheet?.conditionalFormats ?? [];
  if (!existing.length) return;
  // Delete by index in reverse — each deletion shifts indices.
  const requests = existing.map((_: any, i: number) => i)
    .reverse()
    .map((i: number) => ({ deleteConditionalFormatRule: { sheetId, index: i } }));
  await sheets(sid, "POST", ":batchUpdate", { requests });
}

async function writeInvoicesTab(sid: string, salesPayload: SalesPayload) {
  const { id: sheetId } = await ensureTab(sid, TAB_INVOICES);
  await clearConditionalFormats(sid, sheetId);
  await clearTab(sid, sheetId);

  console.log("[Invoices] Pulling from FlowAccount...");
  const flow = await openFlow();
  let invoices: FlowInvoice[] = [];
  let receipts: FlowReceipt[] = [];
  try {
    invoices = await listInvoices(flow, fromIso, toIso);
    receipts = await listReceipts(flow, fromIso, toIso);
  } finally {
    await closeFlow(flow);
  }

  // Drop phantom FlowAccount receipts (debt-reminder closures with no actual
  // money movement). Listed in 08_config/b2b_overrides.json.
  const excludeFlow = new Set<string>();
  try {
    const cfgPath = nodePath.join(process.cwd(), "08_config", "b2b_overrides.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      for (const ent of cfg.exclude_flow_receipts ?? []) {
        if (ent?.receipt_number) excludeFlow.add(String(ent.receipt_number));
      }
    }
  } catch {}
  if (excludeFlow.size) {
    const before = receipts.length;
    receipts = receipts.filter(r => !excludeFlow.has(r.number));
    if (before !== receipts.length) {
      console.log(`  [Invoices] Excluded ${before - receipts.length} phantom Flow receipts (per b2b_overrides.json)`);
    }
  }
  const stray = matchInvoicesAndReceipts(invoices, receipts);
  invoices.sort((a, b) => b.issueDate.localeCompare(a.issueDate));

  const rows: any[][] = [];
  rows.push([`Tax Invoices · ${FILE_TITLE}`]);
  rows.push([`Source: FlowAccount · pulled ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`]);
  rows.push(INVOICE_HEADERS);
  const invHeaderRow = rows.length - 1;
  const invDataStart = rows.length;

  let totalAmt = 0, paidAmt = 0;
  for (const inv of invoices) {
    totalAmt += inv.amount;
    let status: string;
    let payDate = "";
    let receiptNum = "";
    let note = "";
    if (inv.linkedReceipts.length > 0) {
      const r = inv.linkedReceipts[0];
      status = "Paid";
      payDate = r.date;
      receiptNum = r.number;
      paidAmt += inv.amount;
      if (inv.status === "Unpaid") note = "FlowAccount status disagrees — receipt found by amount/client match";
    } else {
      status = inv.status || "Unpaid";
      if (inv.status === "Paid") note = "FlowAccount marks Paid but no April receipt matched — may be receipted next month";
    }
    rows.push([inv.number, inv.issueDate, inv.client, Number(inv.amount.toFixed(2)), status, payDate, receiptNum, note]);
  }
  const invDataEnd = rows.length;
  rows.push(["", "", "TOTAL", Number(totalAmt.toFixed(2)), `Paid: ${Number(paidAmt.toFixed(2))} ฿`, "", "", `Outstanding: ${Number((totalAmt - paidAmt).toFixed(2))} ฿`]);
  const invTotalRow = rows.length - 1;

  // Stray receipts section (receipts in this month with no matching invoice in this month —
  // typically payments for prior-month invoices).
  rows.push([]);
  rows.push([`Receipts received this month for prior invoices (${stray.length})`]);
  const strayTitleRow = rows.length - 1;
  rows.push(STRAY_HEADERS);
  const strayHeaderRow = rows.length - 1;
  const strayDataStart = rows.length;
  let strayTotal = 0;
  stray.sort((a, b) => b.date.localeCompare(a.date));
  for (const r of stray) {
    strayTotal += r.amount;
    const note = r.appliedInvoices.length
      ? `Pays ${r.appliedInvoices.join(", ")}`
      : "No referenced invoice found";
    rows.push([r.number, r.date, r.client, Number(r.amount.toFixed(2)), note]);
  }
  const strayDataEnd = rows.length;
  rows.push(["", "", "TOTAL", Number(strayTotal.toFixed(2)), ""]);
  const strayTotalRow = rows.length - 1;

  // ─── Reconciliation: Loyverse B2B (bank transfer) vs FlowAccount receipts ─
  // Sales tab uses the management B2B rule (broad), but only bank-transfer
  // B2B sales get a FlowAccount receipt issued — card/cash-paid B2B-named
  // clients (walk-in corporate buyers) are management B2B only and won't
  // appear in Flow. So this reconciliation compares the **bank-transfer subset**
  // of Loyverse B2B against Flow receipts.
  const loyB2BBankTransferList = salesPayload.b2bReceipts.filter(r => r.isBankTransfer);
  const loyverseB2BBankTransfer = loyB2BBankTransferList.reduce((s, r) => s + r.total, 0);
  const flowReceiptsTotal = receipts.reduce((s, r) => s + r.amount, 0);
  const diff = Math.round((loyverseB2BBankTransfer - flowReceiptsTotal) * 100) / 100;

  // Per-receipt mismatches are surfaced only in the console log (management
  // diagnostic) — the bookkeeper sees totals and the diff line only.
  const flowMatched = new Set<string>();
  const loyOnly: typeof loyB2BBankTransferList = [];
  for (const lr of loyB2BBankTransferList) {
    const fr = receipts.find(f => !flowMatched.has(f.number) && Math.abs(f.amount - lr.total) <= 1);
    if (fr) flowMatched.add(fr.number);
    else loyOnly.push(lr);
  }
  const flowOnly = receipts.filter(f => !flowMatched.has(f.number));
  if (loyOnly.length || flowOnly.length) {
    console.log(`     [Reco] Per-receipt mismatches (not written to sheet):`);
    for (const r of loyOnly)  console.log(`       Loyverse only: ${r.date} ${r.receiptNumber} ${r.total.toFixed(2)} ฿ — ${r.customerName}`);
    for (const r of flowOnly) console.log(`       FlowAccount only: ${r.date} ${r.number} ${r.amount.toFixed(2)} ฿ — ${r.client}`);
  }

  const mgmtOnlyB2B = salesPayload.totals.b2bRev - loyverseB2BBankTransfer;

  rows.push([]);
  rows.push([`Reconciliation: Loyverse B2B (bank transfer) vs FlowAccount receipts (${monthArg})`]);
  const recoTitleRow = rows.length - 1;
  rows.push(["Source", "Amount ฿", "", "", "Note"]);
  const recoHeaderRow = rows.length - 1;
  rows.push(["Loyverse B2B (bank transfer only)", Math.round(loyverseB2BBankTransfer * 100) / 100, "", "", "subset of B2B revenue paid via bank transfer"]);
  rows.push(["FlowAccount receipts", Math.round(flowReceiptsTotal * 100) / 100, "", "", `${receipts.length} receipts in ${monthArg}`]);
  rows.push(["Difference", diff, "", "", Math.abs(diff) < 1 ? "OK" : "Investigate"]);
  const recoDiffRow = rows.length - 1;
  rows.push(["Loyverse B2B (card/cash, management only)", Math.round(mgmtOnlyB2B * 100) / 100, "", "", "walk-in B2B clients without Flow tax invoice — informational"]);
  const recoMgmtRow = rows.length - 1;

  await writeRows(sid, sheetId, rows);

  const dark = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  const FMT_BAHT = { type: "CURRENCY", pattern: "#,##0.00\\ \"฿\"" };

  await sheets(sid, "POST", ":batchUpdate", {
    requests: [
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: invHeaderRow + 1 } }, fields: "gridProperties.frozenRowCount" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 110 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 260 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 }, properties: { pixelSize: 120 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: 100 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 5, endIndex: 6 }, properties: { pixelSize: 120 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 6, endIndex: 7 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 7, endIndex: 8 }, properties: { pixelSize: 380 }, fields: "pixelSize" } },
      // Title
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 }, cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: "MERGE_ALL" } },
      // Source line
      { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 8 }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.96, blue: 0.78 }, textFormat: { italic: true, fontSize: 9 } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { mergeCells: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: "MERGE_ALL" } },
      // Invoices header row
      { repeatCell: { range: { sheetId, startRowIndex: invHeaderRow, endRowIndex: invHeaderRow + 1, startColumnIndex: 0, endColumnIndex: 8 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
      // Invoices amount column
      { repeatCell: { range: { sheetId, startRowIndex: invDataStart, endRowIndex: invDataEnd, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } },
      // Notes col wrap
      { repeatCell: { range: { sheetId, startRowIndex: invDataStart, endRowIndex: invDataEnd, startColumnIndex: 7, endColumnIndex: 8 }, cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP", textFormat: { fontSize: 9 } } }, fields: "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)" } },
      // Invoices total row
      { repeatCell: { range: { sheetId, startRowIndex: invTotalRow, endRowIndex: invTotalRow + 1, startColumnIndex: 0, endColumnIndex: 8 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true }, numberFormat: FMT_BAHT } }, fields: "userEnteredFormat(backgroundColor,textFormat,numberFormat)" } },
      // Stray section title
      { repeatCell: { range: { sheetId, startRowIndex: strayTitleRow, endRowIndex: strayTitleRow + 1, startColumnIndex: 0, endColumnIndex: 8 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.40, blue: 0.20 }, textFormat: { bold: true, foregroundColor: white } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { mergeCells: { range: { sheetId, startRowIndex: strayTitleRow, endRowIndex: strayTitleRow + 1, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: "MERGE_ALL" } },
      // Stray header
      { repeatCell: { range: { sheetId, startRowIndex: strayHeaderRow, endRowIndex: strayHeaderRow + 1, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
      // Stray amount column
      { repeatCell: { range: { sheetId, startRowIndex: strayDataStart, endRowIndex: strayDataEnd, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } },
      // Stray total
      { repeatCell: { range: { sheetId, startRowIndex: strayTotalRow, endRowIndex: strayTotalRow + 1, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true }, numberFormat: FMT_BAHT } }, fields: "userEnteredFormat(backgroundColor,textFormat,numberFormat)" } },
      // Reconciliation section title
      { repeatCell: { range: { sheetId, startRowIndex: recoTitleRow, endRowIndex: recoTitleRow + 1, startColumnIndex: 0, endColumnIndex: 8 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.40, blue: 0.20 }, textFormat: { bold: true, foregroundColor: white } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { mergeCells: { range: { sheetId, startRowIndex: recoTitleRow, endRowIndex: recoTitleRow + 1, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: "MERGE_ALL" } },
      // Reconciliation header
      { repeatCell: { range: { sheetId, startRowIndex: recoHeaderRow, endRowIndex: recoHeaderRow + 1, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      // Reconciliation amount column
      { repeatCell: { range: { sheetId, startRowIndex: recoHeaderRow + 1, endRowIndex: recoMgmtRow + 1, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } },
      // Difference row — orange if non-zero
      { repeatCell: { range: { sheetId, startRowIndex: recoDiffRow, endRowIndex: recoDiffRow + 1, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: { backgroundColor: Math.abs(diff) < 1 ? { red: 0.78, green: 0.92, blue: 0.78 } : { red: 1.0, green: 0.85, blue: 0.65 }, textFormat: { bold: true }, numberFormat: FMT_BAHT } }, fields: "userEnteredFormat(backgroundColor,textFormat,numberFormat)" } },
      // Conditional format: highlight Status cell light-orange when invoice is unpaid.
      // Applies across the whole invoice data range; covers both "Unpaid" (no
      // matching receipt) and "Overdue" (FlowAccount status, also unpaid).
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId, startRowIndex: invDataStart, endRowIndex: invDataEnd, startColumnIndex: 4, endColumnIndex: 5 }],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "Unpaid" }] },
              format: { backgroundColor: { red: 1.0, green: 0.85, blue: 0.65 } },
            },
          },
          index: 0,
        },
      },
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId, startRowIndex: invDataStart, endRowIndex: invDataEnd, startColumnIndex: 4, endColumnIndex: 5 }],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "Overdue" }] },
              format: { backgroundColor: { red: 1.0, green: 0.85, blue: 0.65 } },
            },
          },
          index: 0,
        },
      },
    ],
  });
  console.log(`  ✓ "${TAB_INVOICES}" written: ${invoices.length} invoices, ${stray.length} stray receipts`);
  console.log(`     Reconciliation: Loyverse B2B (bank transfer) = ${Math.round(loyverseB2BBankTransfer).toLocaleString("ru-RU")} ฿, FlowAccount receipts = ${Math.round(flowReceiptsTotal).toLocaleString("ru-RU")} ฿, diff = ${diff.toFixed(2)} ฿${Math.abs(diff) < 1 ? " ✓" : " ⚠ investigate"} · management-only B2B (card/cash) = ${Math.round(mgmtOnlyB2B).toLocaleString("ru-RU")} ฿`);
}


// ─── Sheet 3: Expenses (purchase orders, status = Closed) ────────────────

async function writeExpensesTab(sid: string) {
  const { id: sheetId } = await ensureTab(sid, TAB_EXPENSES);
  await clearTab(sid, sheetId);

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  // Self-heal known scraper-column-shift damage. The Loyverse PO list page
  // sometimes shifts columns by one — status ends up in the `received`
  // column ("Closed"), supplier name lands in `status`, and total_thb comes
  // back NULL. The detail XHR (which populates purchase_order_items) is
  // fine, so we trust items and patch the header row in place.
  const { data: broken } = await supabase
    .from("purchase_orders")
    .select("po_number, order_date, status, total_thb, received")
    .gte("order_date", fromIso)
    .lte("order_date", toIso);
  for (const po of broken ?? []) {
    const looksShifted =
      po.received === "Closed" &&
      (po.total_thb == null || String(po.status ?? "").toLowerCase() !== "closed");
    if (!looksShifted) continue;
    const { data: items } = await supabase
      .from("purchase_order_items")
      .select("line_total, qty_ordered, qty_received")
      .eq("po_number", po.po_number);
    if (!items?.length) continue;
    const sumLine = items.reduce((s, i: any) => s + Number(i.line_total ?? 0), 0);
    const ordered = items.reduce((s, i: any) => s + Number(i.qty_ordered ?? 0), 0);
    const received = items.reduce((s, i: any) => s + Number(i.qty_received ?? 0), 0);
    const fullyReceived = ordered > 0 && Math.abs(received - ordered) < 0.001;
    if (!fullyReceived) continue;
    const ord = Math.round(ordered * 1000) / 1000;
    const rec = Math.round(received * 1000) / 1000;
    await supabase
      .from("purchase_orders")
      .update({
        status: "Closed",
        total_thb: Math.round(sumLine * 100) / 100,
        received: `${rec} of ${ord}`,
      })
      .eq("po_number", po.po_number);
    console.log(`  heal: ${po.po_number} → status=Closed, total=${Math.round(sumLine).toLocaleString("ru-RU")} ฿`);
  }

  const { data, error } = await supabase
    .from("purchase_orders")
    .select("po_number, order_date, supplier, status, subtotal_thb, vat_thb, total_thb")
    .gte("order_date", fromIso)
    .lte("order_date", toIso)
    .ilike("status", "closed")
    .order("order_date", { ascending: true });
  if (error) throw new Error(`Supabase: ${error.message}`);
  const pos = data ?? [];
  console.log(`[Expenses] ${pos.length} closed POs in ${monthArg}`);

  // Net / VAT / Total come straight from the XHR-derived columns:
  //   subtotal_thb = orderData.amount/100   (after PO-level discount, no VAT)
  //   vat_thb      = Σ landedCosts.amount/100  (VAT line items)
  //   total_thb    = subtotal_thb + vat_thb
  // For older rows scraped before subtotal_thb existed we fall back to
  // items sum (good enough when the supplier doesn't apply discount).
  const fallbackSubtotal = new Map<string, number>();
  const needFallback = pos.filter(p => p.subtotal_thb == null).map(p => p.po_number);
  if (needFallback.length) {
    for (const po_number of needFallback) {
      const { data: items } = await supabase
        .from("purchase_order_items")
        .select("line_total")
        .eq("po_number", po_number);
      const sum = (items ?? []).reduce((s, i: any) => s + Number(i.line_total ?? 0), 0);
      fallbackSubtotal.set(po_number, sum);
    }
  }

  const rows: any[][] = [];
  rows.push([`Expenses · ${FILE_TITLE} · purchase orders status=Closed`]);
  rows.push([]);
  rows.push(["#", "PO", "Order date", "Supplier", "Net ฿", "VAT ฿", "Total ฿"]);
  const headerRow = rows.length - 1;
  const dataStart = rows.length;

  let totalNet = 0, totalVat = 0, totalGross = 0;
  pos.forEach((po, i) => {
    const net   = po.subtotal_thb != null ? Number(po.subtotal_thb) : (fallbackSubtotal.get(po.po_number) ?? 0);
    const gross = Number(po.total_thb ?? 0);
    const vat   = po.vat_thb != null ? Number(po.vat_thb) : Math.max(0, gross - net);
    totalNet += net; totalVat += vat; totalGross += gross;
    rows.push([
      i + 1,
      po.po_number,
      po.order_date ?? "",
      po.supplier ?? "",
      Math.round(net * 100) / 100,
      Math.round(vat * 100) / 100,
      Math.round(gross * 100) / 100,
    ]);
  });
  const dataEnd = rows.length;
  rows.push([
    "", "", "", "TOTAL",
    Math.round(totalNet * 100) / 100,
    Math.round(totalVat * 100) / 100,
    Math.round(totalGross * 100) / 100,
  ]);
  const totalRow = rows.length - 1;

  await writeRows(sid, sheetId, rows);

  const dark = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  const FMT_BAHT = { type: "CURRENCY", pattern: "#,##0\\ \"฿\"" };

  await sheets(sid, "POST", ":batchUpdate", {
    requests: [
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: headerRow + 1 } }, fields: "gridProperties.frozenRowCount" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 50  }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 90  }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 110 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 }, properties: { pixelSize: 280 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 4, endIndex: 7 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } },
      { repeatCell: { range: { sheetId, startRowIndex: headerRow, endRowIndex: headerRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
      { repeatCell: { range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 4, endColumnIndex: 7 }, cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } },
      { repeatCell: { range: { sheetId, startRowIndex: totalRow, endRowIndex: totalRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true }, numberFormat: FMT_BAHT } }, fields: "userEnteredFormat(backgroundColor,textFormat,numberFormat)" } },
    ],
  });
  console.log(`  ✓ "${TAB_EXPENSES}" written: net=${Math.round(totalNet).toLocaleString("ru-RU")} + vat=${Math.round(totalVat).toLocaleString("ru-RU")} = ${Math.round(totalGross).toLocaleString("ru-RU")} ฿`);
}

// ─── Sheet 4: Bonuses (B2C commission per manager) ───────────────────────

interface ManagerSchedule {
  month: string;
  managers: string[];
  // Per-manager commission percentage (fallback when sheet cell is empty).
  commissions?: Record<string, number>;
  // Per-manager fixed monthly salary in THB (fallback when sheet cell empty).
  fixed?: Record<string, number>;
  // Per-manager advances already paid this month (fallback when sheet cell empty).
  paid?: Record<string, number>;
  days: Record<string, Record<string, number | string>>;
  remarks?: Record<string, string>;
}

import * as fs from "node:fs";
import * as nodePath from "node:path";

function loadManagerSchedule(month: string): ManagerSchedule | null {
  const p = nodePath.join(process.cwd(), "08_config", "manager_schedules", `${month}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as ManagerSchedule;
}

// Convert a 0-based column index to A1 letters: 0→A, 1→B, ..., 25→Z, 26→AA.
function colA1(idx: number): string {
  let s = "";
  let n = idx;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

async function writeBonusesTab(sid: string) {
  const { id: sheetId, existed } = await ensureTab(sid, TAB_BONUSES);

  const sched = loadManagerSchedule(monthArg);
  if (!sched) {
    await clearTab(sid, sheetId);
    await writeRows(sid, sheetId, [
      [`Bonuses · ${FILE_TITLE}`],
      [`No schedule for ${monthArg}. Add 08_config/manager_schedules/${monthArg}.json — see 2026-04.json for format.`],
    ]);
    console.log(`  ⚠ "${TAB_BONUSES}": no schedule file found for ${monthArg}`);
    return;
  }
  const managers = sched.managers;

  // Preserve user-edited values (Commission %, Fix ฿, Already paid ฿) across re-runs.
  const userCommission: Record<string, number> = {};
  const userFixed: Record<string, number> = {};
  const userPaid: Record<string, number> = {};
  if (existed) {
    const existing = await readRange(sid, `${TAB_BONUSES}!A1:Z200`);
    for (const row of existing) {
      const label = String(row[0] ?? "").trim();
      if (label === "Commission %") {
        // Cell stores decimal (PERCENT format) — 0.01 means 1%. Multiply
        // by 100 to compare with our "human" percent convention.
        for (let i = 0; i < managers.length; i++) {
          const v = Number(row[i + 1]);
          if (Number.isFinite(v) && v >= 0) userCommission[managers[i]] = v * 100;
        }
      } else if (label === "Fix ฿") {
        for (let i = 0; i < managers.length; i++) {
          const v = Number(row[i + 1]);
          if (Number.isFinite(v) && v >= 0) userFixed[managers[i]] = v;
        }
      } else if (label === "Already paid ฿") {
        for (let i = 0; i < managers.length; i++) {
          // Only treat the cell as user input when > 0; blank or 0 → fall back
          // to JSON. A user who entered "0" gets the same result as JSON-default 0.
          const v = Number(row[i + 1]);
          if (Number.isFinite(v) && v > 0) userPaid[managers[i]] = v;
        }
      }
    }
  }
  // Initial values: user-edited sheet > JSON > CLI default / 0.
  const initialPct: Record<string, number> = {};
  const initialFixed: Record<string, number> = {};
  const initialPaid: Record<string, number> = {};
  for (const m of managers) {
    initialPct[m] = userCommission[m]
      ?? sched.commissions?.[m]
      ?? commissionPctArg;
    initialFixed[m] = userFixed[m] ?? sched.fixed?.[m] ?? 0;
    initialPaid[m]  = userPaid[m]  ?? sched.paid?.[m]  ?? 0;
  }

  await clearTab(sid, sheetId);
  const rows: any[][] = [];
  rows.push([`Bonuses · ${FILE_TITLE}`]);
  rows.push([`Source: 08_config/manager_schedules/${monthArg}.json · Edit "Commission %" cells below to recompute bonuses live.`]);
  rows.push(["Date", ...managers.map(m => `${m} ฿`), "Day total ฿", "Note"]);
  const headerRow = rows.length - 1;
  const dataStart = rows.length;

  // Walk every calendar day so empty days are visible too.
  const totals: Record<string, number> = Object.fromEntries(managers.map(m => [m, 0]));
  let grandTotal = 0;
  for (let d = 1; d <= lastDay; d++) {
    const date = `${monthArg}-${String(d).padStart(2, "0")}`;
    const entry = sched.days[date] ?? {};
    const remark = sched.remarks?.[date]
      ?? (typeof entry._note === "string" ? entry._note as string : "");
    const perManager: number[] = managers.map(m => {
      const v = entry[m];
      return typeof v === "number" ? v : 0;
    });
    const dayTotal = perManager.reduce((s, v) => s + v, 0);
    perManager.forEach((v, i) => { totals[managers[i]] += v; });
    grandTotal += dayTotal;
    rows.push([
      date,
      ...perManager.map(v => v > 0 ? Math.round(v * 100) / 100 : ""),
      dayTotal > 0 ? Math.round(dayTotal * 100) / 100 : "",
      remark,
    ]);
  }
  const dataEnd = rows.length;

  // Totals row
  rows.push([
    "TOTAL",
    ...managers.map(m => Math.round(totals[m] * 100) / 100),
    Math.round(grandTotal * 100) / 100,
    "",
  ]);
  const totalRow = rows.length - 1;

  // Empty spacer
  rows.push([]);
  rows.push([]);

  // Commission % row — editable values, written as plain numbers.
  // Stored as 0.01 = 1% with percentage format applied below.
  rows.push([
    "Commission %",
    ...managers.map(m => initialPct[m] / 100),  // 1.0 → 0.01
    "",
    "↑ edit these cells to override per-manager commission %",
  ]);
  const pctRow = rows.length - 1;

  // Bonus row — formulas, set via updateCells later (writeRows can't write formulas).
  rows.push([
    "Bonus ฿",
    ...managers.map(_ => 0),
    0,
    "",
  ]);
  const bonusRow = rows.length - 1;

  // Fix ฿ row — editable monthly fixed salary per manager.
  rows.push([
    "Fix ฿",
    ...managers.map(m => initialFixed[m]),
    "",
    "↑ edit to adjust monthly fixed salary",
  ]);
  const fixRow = rows.length - 1;

  // Total payout row — formula = Fix + Bonus per manager + grand sum.
  rows.push([
    "Total payout ฿",
    ...managers.map(_ => 0),
    0,
    "",
  ]);
  const payoutRow = rows.length - 1;

  // Already paid ฿ row — editable per-manager advances paid during the month.
  // Write blank for 0 so empty cells fall back to JSON seed on re-run; only
  // explicit user-entered numbers persist.
  rows.push([
    "Already paid ฿",
    ...managers.map(m => initialPaid[m] > 0 ? initialPaid[m] : ""),
    "",
    "↑ edit if advances were paid during the month",
  ]);
  const paidRow = rows.length - 1;

  // Remaining ฿ row — formula = Total payout - Already paid.
  rows.push([
    "Remaining ฿",
    ...managers.map(_ => 0),
    0,
    "",
  ]);
  const remainingRow = rows.length - 1;

  await writeRows(sid, sheetId, rows);

  // Now overwrite bonus / payout cells with formulas. 1-indexed sheet row numbers:
  const totalRow1     = totalRow     + 1;
  const pctRow1       = pctRow       + 1;
  const bonusRow1     = bonusRow     + 1;
  const fixRow1       = fixRow       + 1;
  const payoutRow1    = payoutRow    + 1;
  const paidRow1      = paidRow      + 1;
  const remainingRow1 = remainingRow + 1;

  const formulaCells: any[] = [];
  // Per-manager: bonus = total × pct;  payout = fix + bonus;  remaining = payout − paid
  managers.forEach((_, i) => {
    const col = colA1(i + 1);
    formulaCells.push({
      updateCells: {
        rows: [{ values: [{ userEnteredValue: { formulaValue: `=${col}${totalRow1}*${col}${pctRow1}` } }] }],
        fields: "userEnteredValue",
        range: { sheetId, startRowIndex: bonusRow, endRowIndex: bonusRow + 1, startColumnIndex: i + 1, endColumnIndex: i + 2 },
      },
    });
    formulaCells.push({
      updateCells: {
        rows: [{ values: [{ userEnteredValue: { formulaValue: `=${col}${fixRow1}+${col}${bonusRow1}` } }] }],
        fields: "userEnteredValue",
        range: { sheetId, startRowIndex: payoutRow, endRowIndex: payoutRow + 1, startColumnIndex: i + 1, endColumnIndex: i + 2 },
      },
    });
    formulaCells.push({
      updateCells: {
        rows: [{ values: [{ userEnteredValue: { formulaValue: `=${col}${payoutRow1}-${col}${paidRow1}` } }] }],
        fields: "userEnteredValue",
        range: { sheetId, startRowIndex: remainingRow, endRowIndex: remainingRow + 1, startColumnIndex: i + 1, endColumnIndex: i + 2 },
      },
    });
  });
  // Grand totals (right-most column): SUM across managers
  const firstMgrCol = colA1(1);
  const lastMgrCol  = colA1(managers.length);
  for (const [r1, idx] of [[bonusRow1, bonusRow], [fixRow1, fixRow], [payoutRow1, payoutRow], [paidRow1, paidRow], [remainingRow1, remainingRow]] as const) {
    formulaCells.push({
      updateCells: {
        rows: [{ values: [{ userEnteredValue: { formulaValue: `=SUM(${firstMgrCol}${r1}:${lastMgrCol}${r1})` } }] }],
        fields: "userEnteredValue",
        range: { sheetId, startRowIndex: idx, endRowIndex: idx + 1, startColumnIndex: managers.length + 1, endColumnIndex: managers.length + 2 },
      },
    });
  }

  const dark = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  const FMT_BAHT    = { type: "CURRENCY", pattern: "#,##0.00\\ \"฿\"" };
  const FMT_PERCENT = { type: "PERCENT",  pattern: "0.00%" };
  const totalCols = managers.length + 3;

  await sheets(sid, "POST", ":batchUpdate", {
    requests: [
      ...formulaCells,
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: headerRow + 1 } }, fields: "gridProperties.frozenRowCount" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 1 + managers.length }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1 + managers.length, endIndex: 2 + managers.length }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2 + managers.length, endIndex: 3 + managers.length }, properties: { pixelSize: 320 }, fields: "pixelSize" } },
      // Title
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: totalCols }, cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, fontSize: 12, foregroundColor: white } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: totalCols }, mergeType: "MERGE_ALL" } },
      // Source line
      { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: totalCols }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.96, blue: 0.78 }, textFormat: { italic: true, fontSize: 9 } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { mergeCells: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: totalCols }, mergeType: "MERGE_ALL" } },
      // Header
      { repeatCell: { range: { sheetId, startRowIndex: headerRow, endRowIndex: headerRow + 1, startColumnIndex: 0, endColumnIndex: totalCols }, cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
      // Money columns in data area
      { repeatCell: { range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 1, endColumnIndex: 2 + managers.length }, cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(numberFormat,horizontalAlignment)" } },
      // TOTAL row
      { repeatCell: { range: { sheetId, startRowIndex: totalRow, endRowIndex: totalRow + 1, startColumnIndex: 0, endColumnIndex: totalCols }, cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 }, textFormat: { bold: true }, numberFormat: FMT_BAHT } }, fields: "userEnteredFormat(backgroundColor,textFormat,numberFormat)" } },
      // Commission % cells: yellow highlight + percent format (editable)
      { repeatCell: { range: { sheetId, startRowIndex: pctRow, endRowIndex: pctRow + 1, startColumnIndex: 1, endColumnIndex: 1 + managers.length }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.96, blue: 0.78 }, textFormat: { bold: true }, numberFormat: FMT_PERCENT, horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment)" } },
      // "Commission %" label cell
      { repeatCell: { range: { sheetId, startRowIndex: pctRow, endRowIndex: pctRow + 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat(textFormat)" } },
      // Bonus row (light green, computed)
      { repeatCell: { range: { sheetId, startRowIndex: bonusRow, endRowIndex: bonusRow + 1, startColumnIndex: 0, endColumnIndex: totalCols }, cell: { userEnteredFormat: { backgroundColor: { red: 0.88, green: 0.96, blue: 0.88 }, textFormat: { bold: true }, numberFormat: FMT_BAHT } }, fields: "userEnteredFormat(backgroundColor,textFormat,numberFormat)" } },
      // Fix ฿ cells: yellow editable (numbers) + label
      { repeatCell: { range: { sheetId, startRowIndex: fixRow, endRowIndex: fixRow + 1, startColumnIndex: 1, endColumnIndex: 1 + managers.length }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.96, blue: 0.78 }, textFormat: { bold: true }, numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment)" } },
      { repeatCell: { range: { sheetId, startRowIndex: fixRow, endRowIndex: fixRow + 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat(textFormat)" } },
      // Total payout (lighter green, formula = fix + bonus)
      { repeatCell: { range: { sheetId, startRowIndex: payoutRow, endRowIndex: payoutRow + 1, startColumnIndex: 0, endColumnIndex: totalCols }, cell: { userEnteredFormat: { backgroundColor: { red: 0.82, green: 0.92, blue: 0.82 }, textFormat: { bold: true }, numberFormat: FMT_BAHT } }, fields: "userEnteredFormat(backgroundColor,textFormat,numberFormat)" } },
      // Already paid ฿ — yellow editable
      { repeatCell: { range: { sheetId, startRowIndex: paidRow, endRowIndex: paidRow + 1, startColumnIndex: 1, endColumnIndex: 1 + managers.length }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.96, blue: 0.78 }, textFormat: { bold: true }, numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment)" } },
      { repeatCell: { range: { sheetId, startRowIndex: paidRow, endRowIndex: paidRow + 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat(textFormat)" } },
      // Remaining ฿ — final payout, deepest green (what's actually owed)
      { repeatCell: { range: { sheetId, startRowIndex: remainingRow, endRowIndex: remainingRow + 1, startColumnIndex: 0, endColumnIndex: totalCols }, cell: { userEnteredFormat: { backgroundColor: { red: 0.55, green: 0.78, blue: 0.55 }, textFormat: { bold: true }, numberFormat: FMT_BAHT } }, fields: "userEnteredFormat(backgroundColor,textFormat,numberFormat)" } },
    ],
  });
  console.log(`  ✓ "${TAB_BONUSES}": ${managers.map(m => {
    const payout = initialFixed[m] + totals[m] * initialPct[m] / 100;
    const remaining = payout - initialPaid[m];
    return `${m} sales=${Math.round(totals[m]).toLocaleString("ru-RU")} @ ${initialPct[m]}% bonus=${Math.round(totals[m] * initialPct[m] / 100).toLocaleString("ru-RU")} + fix=${initialFixed[m].toLocaleString("ru-RU")} − paid=${initialPaid[m].toLocaleString("ru-RU")} → remaining=${Math.round(remaining).toLocaleString("ru-RU")}`;
  }).join("; ")}`);
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nWine & Whiskey · Accounting report · ${monthArg}`);
  console.log(`Window (Bangkok): ${fromIso} → ${toIso}`);
  console.log(`Commission rate: ${commissionPctArg}%\n`);

  console.log("[1/5] Resolving spreadsheet in Drive folder...");
  const sid = await findOrCreateSpreadsheet(folderArg, FILE_TITLE);

  console.log("[2/5] Building Sales tab...");
  const salesPayload = await buildSalesPayload();
  await writeSalesTab(sid, salesPayload);

  console.log("[3/5] Building Tax Invoices tab...");
  await writeInvoicesTab(sid, salesPayload);

  console.log("[4/5] Building Expenses tab...");
  await writeExpensesTab(sid);

  console.log("[5/5] Building Bonuses tab...");
  await writeBonusesTab(sid);

  // Tidy: remove the empty "Sheet1" the API creates by default.
  await deleteDefaultSheet1(sid);

  const url = `https://docs.google.com/spreadsheets/d/${sid}/edit`;
  console.log(`\n✓ Done.\n→ ${url}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
