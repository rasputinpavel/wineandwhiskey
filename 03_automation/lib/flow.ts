/**
 * lib/flow.ts
 *
 * Playwright-based scraper for FlowAccount (advance.flowaccount.com).
 * Pulls Tax Invoices and Receipts from the user's business workspace.
 *
 * Auth: email + password from FLOW_EMAIL / FLOW_PASSWORD. Session is
 * persisted to .flow-session.json so subsequent runs reuse cookies.
 *
 * Pagination: each list view is filtered by issue/payment date range and
 * walked page-by-page.
 *
 * Detail parsing: each invoice is opened to read "Related receipts" so we
 * can attribute payments by linkage rather than by fuzzy amount matching.
 *
 * Env flags:
 *   FLOW_HEADFUL=1   visible browser (debug)
 *   FLOW_DEBUG=1     save screenshots on errors
 */

import { chromium, BrowserContext, Page } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";

// Read env lazily — caller's dotenv.config() may run after this module is imported.
function flowCreds() {
  return { email: process.env.FLOW_EMAIL, password: process.env.FLOW_PASSWORD };
}
const WORKSPACE_PATH = "/N7474669/business"; // baked-in for now; one workspace
const BASE_URL = "https://advance.flowaccount.com";

const AUTH_STATE_PATH = path.join(process.cwd(), ".flow-session.json");
const HEADLESS  = !process.env.FLOW_HEADFUL;
const DEBUG     = !!process.env.FLOW_DEBUG;
// Write debug artefacts directly into the working directory. We used to put
// them under .tmp/, but that path turned out brittle on CI (mkdirSync was
// silently failing somewhere) and the GH artifact glob never picked them up.
// Repo root is simpler and matches what most playwright examples do.
const dbgPath = (name: string) => path.join(process.cwd(), name);

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Public types ────────────────────────────────────────────────────────

export interface FlowInvoice {
  number:    string;          // tax invoice #
  issueDate: string;          // YYYY-MM-DD
  client:    string;
  amount:    number;          // baht (final amount with VAT)
  status:    string;          // raw FlowAccount status (Open / Paid / Overdue / etc.)
  detailUrl: string;
  // Receipt linkages discovered when we open the invoice's detail page.
  // Empty array means "no receipts attached" (i.e. unpaid).
  linkedReceipts: Array<{ number: string; date: string; amount: number }>;
  // Product line items, populated by enrichInvoicesWithItems().
  lineItems?: Array<{ name: string; quantity: number; amount: number }>;
}

export interface FlowReceipt {
  number:    string;          // receipt #
  date:      string;          // YYYY-MM-DD
  client:    string;
  amount:    number;
  // Invoice numbers this receipt was applied against (from receipt detail).
  // Empty if it isn't linked to any invoice (e.g. cash sale).
  appliedInvoices: string[];
}

// ─── Browser lifecycle ───────────────────────────────────────────────────

export interface FlowSession {
  browser: import("playwright").Browser;
  context: BrowserContext;
  page:    Page;
}

export async function openFlow(): Promise<FlowSession> {
  const { email, password } = flowCreds();
  const hasSession = fs.existsSync(AUTH_STATE_PATH);
  if (!hasSession && (!email || !password)) {
    throw new Error("FLOW_EMAIL / FLOW_PASSWORD not set and no .flow-session.json present");
  }
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = hasSession
    ? await browser.newContext({ storageState: AUTH_STATE_PATH })
    : await browser.newContext();
  const page = await context.newPage();
  await ensureLoggedIn(context, page);
  return { browser, context, page };
}

export async function closeFlow(s: FlowSession) {
  await s.browser.close();
}

async function ensureLoggedIn(context: BrowserContext, page: Page) {
  // FlowAccount has two login layers:
  //   1. main flowaccount.com / advance.flowaccount.com login
  //   2. tenant-scoped OIDC login at auth.flowaccount.com/Account/Login
  //      (returnUrl=/connect/authorize/callback…&acr_values=tenant:NXXXX)
  // A persisted session may pass (1) but still bounce through (2). We just
  // navigate to the tenant URL and fill every login form we land on, until
  // we end up on a real /business path.
  const target = `${BASE_URL}${WORKSPACE_PATH}/invoices`;
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await delay(3000);

  for (let attempt = 0; attempt < 4; attempt++) {
    const u = page.url();
    // Always capture per-attempt state — invaluable when CI fails silently.
    await page.screenshot({ path: dbgPath(`flow-debug-attempt-${attempt}.png`), fullPage: true }).catch(() => {});

    // Workspace/tenant selector — click the company that matches our baked-in id.
    // FlowAccount uses several different URLs for this picker over time:
    // /SelectCompany, /select-company, /companies, /workspaces. Match all.
    if (/SelectCompany|select-company|workspaces|\/select|\/companies/i.test(u)) {
      console.log(`[flow] Workspace picker at ${u.slice(0, 90)}…, clicking ${WORKSPACE_PATH}`);
      const tenantId = WORKSPACE_PATH.split("/").filter(Boolean)[0]; // e.g. "N7474669"
      // The picker card may key off the tenant id (in href / data-id), or it
      // may show only the human-readable company name. We accept either.
      // Final fallback: click the first card-shaped element on the page —
      // we only ever have one workspace anyway.
      const candidateSelectors = [
        `a[href*="${tenantId}"]`,
        `button[data-id*="${tenantId}"]`,
        `:text("${tenantId}")`,
        `a:has-text("Head Office")`,
        `button:has-text("Head Office")`,
        `[role="button"]:has-text("Head Office")`,
        `a:has-text("Co.,")`,
        `button:has-text("Co.,")`,
        `[role="button"]:has-text("Co.,")`,
        `[class*="company"]:visible`,
        `[class*="account-card"]:visible`,
        `main a:visible, main button:visible, main [role="button"]:visible`,
      ];
      let clicked = false;
      for (const sel of candidateSelectors) {
        const el = page.locator(sel).first();
        try {
          await el.click({ timeout: 3000 });
          console.log(`[flow] clicked workspace via selector: ${sel}`);
          clicked = true;
          break;
        } catch { /* try next selector */ }
      }
      if (!clicked) {
        console.warn(`[flow] could not click any workspace picker element at ${u}`);
      }
      await delay(4000);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      continue;
    }

    const onLogin =
      u.includes("/login") || u.includes("/Login") ||
      u.includes("/sign-in") || u.includes("/SignIn");
    if (!onLogin) break;
    console.log(`[flow] Login form at ${u.slice(0, 90)}…`);
    if (DEBUG) await page.screenshot({ path: dbgPath(`flow-debug-login-${attempt}.png`) });

    const emailSel = [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="Email"]',                      // .NET Identity (auth.flowaccount.com)
      'input[name="Username"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="@"]',                  // FlowAccount hint: name@example.com
      'input[formcontrolname="email"]',
      'input[formcontrolname="username"]',
      'input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="submit"]):not([type="button"])',
    ].join(", ");
    const passSel = 'input[type="password"], input[name="Password"]';
    const { email: e, password: p } = flowCreds();
    if (!e || !p) {
      throw new Error(`FlowAccount session expired and FLOW_EMAIL / FLOW_PASSWORD are not set — cannot re-login. Refresh .flow-session.json (or FA_SESSION_B64_GZ in CI).`);
    }
    await page.locator(emailSel).first().fill(e);
    await delay(300);
    await page.locator(passSel).first().fill(p);
    await delay(300);
    await page.locator(
      'button[type="submit"], input[type="submit"], button:has-text("เข้าสู่ระบบ"), button:has-text("Sign in"), button:has-text("Login"), button:has-text("Log in")'
    ).first().click();
    await delay(5000);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await delay(1500);

    if (page.url().includes("/select") || page.url().includes("workspaces")) {
      try {
        await page.locator(`a[href*="${WORKSPACE_PATH}"]`).first().click({ timeout: 5000 });
        await delay(3000);
      } catch { /* not present */ }
    }
  }

  if (/login|Login|sign-?in|SignIn|SelectCompany|select-company/.test(page.url())) {
    if (DEBUG) await page.screenshot({ path: dbgPath("flow-debug-postlogin.png") });
    throw new Error(`FlowAccount login failed — still at ${page.url()}. Check creds / 2FA.`);
  }

  await context.storageState({ path: AUTH_STATE_PATH });
  console.log("[flow] Logged in, session saved.");
  if (!page.url().includes("/invoices")) {
    await page.goto(target, { waitUntil: "domcontentloaded" });
    await delay(3000);
  }
}

// ─── List parsing helpers ────────────────────────────────────────────────

function parseAmount(s: string): number {
  const n = Number(String(s).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// FlowAccount renders dates like "12/04/2026" or "12 Apr 2026". Try both.
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
function parseDate(s: string): string {
  s = (s || "").trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()] ?? "01"}-${m[1].padStart(2, "0")}`;
  return s;
}

async function gotoList(page: Page, listPath: string) {
  const url = `${BASE_URL}${WORKSPACE_PATH}${listPath}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await delay(3000);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  // Critical: wait for ngx-datatable to actually render rows. CI is fast
  // enough that page.content() captures the populated DOM, but page.screenshot
  // — and our readDatatableRows() call — were happening before the rows existed.
  // We accept either a real row or an explicit empty-state indicator.
  await page.waitForSelector(
    'datatable-body-row, .datatable-row-wrapper, [class*="empty-row"], [class*="datatable-empty"]',
    { timeout: 30_000 },
  ).catch(() => {
    console.warn(`[flow] gotoList(${listPath}): no rows or empty-state appeared within 30s`);
  });
  await delay(500);
}

// FlowAccount uses ngx-datatable (Angular). Each row has role="row" and class
// "datatable-body-row"; cells inside have role="cell". 9 cells per row:
//   0 checkbox, 1 date, 2 doc#, 3 client, 4 due date, 5 amount, 6 status, 7 ?, 8 actions
//
// `wantPaid` is set when calling on the Receipts list — there the only thing we
// care about is that there IS a row, not what the status says.
async function readDatatableRows(page: Page): Promise<string[][]> {
  const rows = page.locator('[role="row"].datatable-body-row');
  const n = await rows.count();
  const out: string[][] = [];
  for (let i = 0; i < n; i++) {
    const cells = await rows.nth(i).locator('[role="cell"]').allInnerTexts();
    out.push(cells.map(c => c.replace(/\s+/g, " ").trim()));
  }
  return out;
}

// Click the next-page link repeatedly. `onPage` runs after each page load
// and can return false to stop early (when we've paginated past our date
// window — the lists are sorted desc by date so older rows mean we're done).
//
// FlowAccount uses ngx-datatable; the next-page anchor is identified by its
// aria-label, and the disabled state lives on the wrapping <li>.
async function paginateAll(
  page: Page,
  onPage: (rows: string[][]) => boolean | Promise<boolean>,
  maxPages = 60,
) {
  let prevFingerprint = "";
  for (let p = 0; p < maxPages; p++) {
    const rows = await readDatatableRows(page);
    const fp = rows.map(r => r[2]).join("|");      // doc-numbers as page id
    if (p > 0 && fp === prevFingerprint) break;     // pager didn't move
    prevFingerprint = fp;

    const cont = await onPage(rows);
    if (!cont) break;

    const nextSel = 'a[aria-label="go to next page"]';
    const next = page.locator(nextSel).first();
    if (!(await next.count())) break;
    const li = page.locator(`li:has(${nextSel})`).first();
    const isDisabled = (await li.getAttribute("class"))?.includes("disabled");
    if (isDisabled) break;
    await next.click().catch(() => {});
    await delay(1500);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await delay(400);
  }
}

// ─── Invoices ────────────────────────────────────────────────────────────

// Status text on FlowAccount Tax Invoices grid (Thai locale).
//   เปิดใบเสร็จแล้ว = Receipt issued (= Paid via linked receipt)
//   รอดำเนินการ     = Pending (= Unpaid)
//   รอเก็บเงิน      = Awaiting payment (= Unpaid, just a different wording FA uses)
//   ยกเลิก          = Cancelled
//   เกินกำหนด       = Overdue (still unpaid, past due date)
// Also accepts English strings + numeric enum codes the detail-page API
// returns (paymentStatus is e.g. 1, 3, 5… and the filter dropdown in FA's
// own UI uses the same codes — see values in the Tax Invoices listing).
function normalizeFlowStatus(raw: string | number): string {
  const s = String(raw ?? "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.includes("เปิดใบเสร็จแล้ว")) return "Paid";
  if (s.includes("รอดำเนินการ"))    return "Unpaid";
  if (s.includes("รอเก็บเงิน"))     return "Unpaid";
  if (s.includes("เกินกำหนด"))      return "Overdue";
  if (s.includes("ยกเลิก"))         return "Cancelled";
  const en = s.toLowerCase();
  if (en === "paid" || en === "receiptissued")      return "Paid";
  if (en === "void" || en === "cancelled" || en === "canceled") return "Cancelled";
  if (en === "overdue")                              return "Overdue";
  if (en === "open" || en === "pending" || en === "unpaid" || en === "awaitingpayment") return "Unpaid";
  // FA numeric enum: 1 = pending, 3 = awaiting, 5 = paid (receipt issued),
  // 7 = cancelled/void, 9 = partially paid, 11 = bad debt. Map to the same
  // names listing-text parsing produces so the portal filter stays stable.
  switch (s) {
    case "1":  return "Unpaid";
    case "3":  return "Unpaid";
    case "5":  return "Paid";
    case "7":  return "Cancelled";
    case "9":  return "Unpaid";
    case "11": return "BadDebt";
  }
  return String(raw).trim();
}

// Tax invoice grid columns (indexed by [role="cell"]):
//   0 checkbox  1 date  2 doc#  3 client  4 due date  5 amount
//   6 (empty)   7 status (Thai)  8 actions
//
// FlowAccount loads the list via REST API at
//   api-core-canary.flowaccount.com/api/th/tax-invoices?...
// returning JSON with `documentSerial` (e.g. "INV202604280001") and `recordId`
// (the numeric ID used in detail URLs, e.g. /invoices/87955256). We piggyback a
// network listener to capture recordId-by-serial so that detailUrl can be
// constructed without per-row click-through.
export async function listInvoices(
  s: FlowSession,
  fromIso: string,
  toIso: string,
  maxPages = 60,
): Promise<FlowInvoice[]> {
  console.log(`[flow] Listing invoices ${fromIso} → ${toIso} (≤${maxPages} pages)...`);

  const recordIdBySerial = new Map<string, number>();
  const responseListener = async (resp: import("playwright").Response) => {
    const url = resp.url();
    if (!/api.*tax-invoices/i.test(url)) return;
    if (resp.request().method() === "OPTIONS") return;
    try {
      const ct = resp.headers()["content-type"] ?? "";
      if (!ct.includes("json")) return;
      const body = await resp.json();
      const list: any[] = body?.data?.list ?? body?.list ?? [];
      for (const item of list) {
        const serial = item.documentSerial ?? item.invoiceSerial ?? item.referencedToMe?.[0]?.referenceDocumentSerial;
        const recId  = item.recordId;
        if (serial && typeof recId === "number") recordIdBySerial.set(String(serial), recId);
      }
    } catch { /* ignore */ }
  };
  s.page.on("response", responseListener);

  try {
    await gotoList(s.page, "/invoices");
    if (DEBUG) await s.page.screenshot({ path: dbgPath("flow-debug-invoice-list.png"), fullPage: true });

    const invoices: FlowInvoice[] = [];
    // Walk every page. Previously we'd stop early when seeing rows older than
    // fromIso, but that relied on the listing being sorted DESC by date. When
    // FA's UI lands you anywhere else (e.g. last page from a persisted state)
    // the early-stop fires on page 1 and we miss everything. Cheaper to just
    // paginate all ~16 pages and filter in-memory.
    await paginateAll(s.page, (rows) => {
      for (const cells of rows) {
        if (cells.length < 8) continue;
        const issueDate = parseDate(cells[1]);
        const number    = cells[2].trim();
        const client    = cells[3].trim();
        const amount    = parseAmount(cells[5]);
        const status    = normalizeFlowStatus(cells[7]);
        if (!number || !issueDate || amount <= 0) continue;
        if (issueDate < fromIso) continue;
        if (issueDate > toIso) continue;
        invoices.push({ number, issueDate, client, amount, status, detailUrl: "", linkedReceipts: [] });
      }
      return true;
    }, maxPages);

    // Resolve detailUrl from the API-captured map; falls back to "" if not seen.
    for (const inv of invoices) {
      const recId = recordIdBySerial.get(inv.number);
      if (recId) inv.detailUrl = `${BASE_URL}${WORKSPACE_PATH}/invoices/${recId}`;
    }

    const seen = new Set<string>();
    const dedup = invoices.filter(i => seen.has(i.number) ? false : (seen.add(i.number), true));
    const withUrl = dedup.filter(i => i.detailUrl).length;
    console.log(`[flow] ${dedup.length} invoice(s) parsed, ${withUrl} with detailUrl`);

    // If listing came back empty, capture page state unconditionally — this
    // is the most useful artefact for diagnosing why CI silently saw 0 rows.
    if (dedup.length === 0) {
      try {
        await s.page.screenshot({ path: dbgPath("flow-debug-empty-list.png"), fullPage: true });
        const html = await s.page.content();
        fs.writeFileSync(dbgPath("flow-debug-empty-list.html"), html);
        console.log(`[flow] empty listing — saved screenshot + HTML at ${s.page.url()}`);
      } catch (e) {
        console.error("[flow] could not save empty-listing artefacts:", e);
      }
    }

    return dedup;
  } finally {
    s.page.off("response", responseListener);
  }
}

// Open each invoice, read the "Receipts" / "Related documents" section.
// FlowAccount typically shows a sub-table on the invoice detail page listing
// receipts that were applied to it. Selectors are forgiving by design.
export async function enrichInvoicesWithReceipts(s: FlowSession, invoices: FlowInvoice[]) {
  for (const inv of invoices) {
    try {
      // Search by invoice number, click the row link to open detail.
      await gotoFiltered(s.page, "/invoices", inv.issueDate, inv.issueDate);
      const link = s.page.locator(`a:has-text("${inv.number}"), tr:has-text("${inv.number}") a`).first();
      if (!(await link.count())) continue;
      await link.click();
      await delay(2500);
      await s.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      inv.detailUrl = s.page.url();

      // Look for a section labelled like "Receipts" / "ใบเสร็จ" / "Related documents".
      // Pull any rows under it.
      const section = s.page.locator(
        ':text-matches("Receipts?|ใบเสร็จ|Related documents", "i")'
      ).first();
      if (!(await section.count())) continue;
      // Read nearby table.
      const nearbyRows = await s.page
        .locator(':text-matches("Receipts?|ใบเสร็จ", "i") ~ * table tbody tr, :text-matches("Receipts?|ใบเสร็จ", "i") + table tbody tr')
        .all();
      for (const tr of nearbyRows) {
        const cells = (await tr.locator("td").allInnerTexts()).map(c => c.trim()).filter(Boolean);
        const num = cells.find(c => /^[A-Z][A-Z0-9-]{4,}$/i.test(c)) ?? "";
        const dateCell = cells.find(c => /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}|\d{4}-\d{2}-\d{2}/.test(c)) ?? "";
        const amts = cells.filter(c => parseAmount(c) > 0);
        const amount = amts.length ? Math.max(...amts.map(parseAmount)) : 0;
        if (num && dateCell && amount > 0) {
          inv.linkedReceipts.push({ number: num, date: parseDate(dateCell), amount });
        }
      }
    } catch (e) {
      console.warn(`[flow] enrich ${inv.number}: ${e}`);
    }
  }
}

// Open each invoice's detail and scrape product line items from the items table.
// Relies on FlowInvoice.detailUrl having been captured by listInvoices().
//
// FlowAccount detail page hits a per-invoice API
//   api-core-canary.flowaccount.com/api/th/tax-invoice-products?recordId=<id>
// (or similar) returning JSON with {productName, quantity, value, ...}.
// We listen for that response to avoid fragile DOM parsing.
export async function enrichInvoicesWithItems(s: FlowSession, invoices: FlowInvoice[]) {
  for (const inv of invoices) {
    inv.lineItems = [];
    if (!inv.detailUrl) {
      console.warn(`[flow] items: no detailUrl for ${inv.number}`);
      continue;
    }
    const captured: any[] = [];
    const onResp = async (resp: import("playwright").Response) => {
      const url = resp.url();
      if (!/api/i.test(url)) return;
      if (resp.request().method() === "OPTIONS") return;
      try {
        const ct = resp.headers()["content-type"] ?? "";
        if (!ct.includes("json")) return;
        const body = await resp.json();
        captured.push({ url, body });
      } catch {}
    };
    s.page.on("response", onResp);
    try {
      await s.page.goto(inv.detailUrl, { waitUntil: "domcontentloaded" });
      await delay(3000);
      await s.page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await delay(500);
    } catch (e) {
      console.warn(`[flow] nav ${inv.number}: ${e}`);
      s.page.off("response", onResp);
      continue;
    }
    s.page.off("response", onResp);
    if (DEBUG) await s.page.screenshot({ path: dbgPath(`flow-debug-invoice-${inv.number}.png`), fullPage: true });

    // FlowAccount detail API: GET /api/th/tax-invoices/<recordId>
    // Returns { data: { list: [{ productItems: [...] }, ...] } }.
    // Each productItem has: name (description), productQty, productTotal, productPricePerOne, ...
    let items: any[] = [];
    let statusFromApi: string | null = null;
    for (const { url, body } of captured) {
      if (!/api-core-canary.*tax-invoices\/\d+/.test(url)) continue;
      const list: any[] = body?.data?.list ?? [];
      for (const doc of list) {
        if (Array.isArray(doc?.productItems)) items.push(...doc.productItems);
        // Best-effort status extraction. Exact field name varies across FA
        // API versions; try the common shapes and accept the first non-empty.
        if (!statusFromApi) {
          const cand =
            doc?.paymentStatusName ?? doc?.paymentStatus ??
            doc?.documentStatusName ?? doc?.documentStatus ??
            doc?.statusName ?? doc?.status;
          if (cand !== undefined && cand !== null && cand !== "") {
            statusFromApi = String(cand);
          }
        }
      }
      if (items.length) break;
    }
    if (statusFromApi) {
      const normalized = normalizeFlowStatus(statusFromApi);
      if (normalized) inv.status = normalized;
    }
    if (DEBUG && items.length === 0) {
      console.warn(`[flow] items: no productItems for ${inv.number}; captured ${captured.length} responses`);
    }
    for (const it of items) {
      const name = String(it.name ?? it.productName ?? it.productDescription ?? "").trim();
      const qty  = Number(it.productQty ?? it.quantity ?? it.productQuantity ?? 0);
      const amount = Number(it.productTotal ?? it.value ?? it.amount ?? 0);
      if (name && qty > 0) inv.lineItems.push({ name, quantity: qty, amount });
    }
    if (DEBUG) console.log(`[flow] ${inv.number}: ${inv.lineItems.length} line item(s) — ${inv.lineItems.slice(0, 3).map(l => `${l.quantity}× ${l.name}`).join(" | ")}`);
  }
}

// ─── Receipts ────────────────────────────────────────────────────────────

// Receipt grid columns (no due-date column, so layout is shifted vs invoices):
//   0 checkbox  1 date  2 doc#  3 client  4 amount  5 (empty)  6 status  7 actions
//
// FlowAccount embeds a "Reference" popover in the doc# cell that links the
// receipt to the originating tax invoice. The popover content (with the
// invoice number) is rendered into the row HTML, so we don't need to click
// through to a detail page — just regex-scan innerHTML for `INV\d+`.
export async function listReceipts(
  s: FlowSession,
  fromIso: string,
  toIso: string,
  maxPages = 60,
): Promise<FlowReceipt[]> {
  console.log(`[flow] Listing receipts ${fromIso} → ${toIso} (≤${maxPages} pages)...`);
  await gotoList(s.page, "/receipts");
  if (DEBUG) await s.page.screenshot({ path: dbgPath("flow-debug-receipt-list.png"), fullPage: true });

  // After enrichInvoicesWithItems opens many detail pages, Angular's SPA
  // router can land us on /receipts with the previous datatable still in the
  // DOM but no rows freshly rendered. Detect that (0 rows on the first read)
  // and force a hard reload before paginating.
  const initialRowCount = await s.page.locator('[role="row"].datatable-body-row').count();
  if (initialRowCount === 0) {
    console.warn("[flow] /receipts loaded with 0 rows — reloading once");
    await s.page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await delay(3000);
    await s.page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await s.page.waitForSelector(
      'datatable-body-row, .datatable-row-wrapper, [class*="empty-row"], [class*="datatable-empty"]',
      { timeout: 30_000 },
    ).catch(() => {});
  }

  const out: FlowReceipt[] = [];

  // Read cells AND innerHTML side-by-side. We can't piggyback on the existing
  // `paginateAll(rows)` callback (which only sees text), so do the per-row
  // walk inline and call paginateAll just for page advancement.
  await paginateAll(s.page, async () => {
    const rowLocators = s.page.locator('[role="row"].datatable-body-row');
    const n = await rowLocators.count();
    for (let i = 0; i < n; i++) {
      const row = rowLocators.nth(i);
      const cells = (await row.locator('[role="cell"]').allInnerTexts())
        .map(c => c.replace(/\s+/g, " ").trim());
      if (cells.length < 7) continue;
      const date   = parseDate(cells[1]);
      const number = cells[2].trim();
      const client = cells[3].trim();
      const amount = parseAmount(cells[4]);
      if (!number || !date || amount <= 0) continue;
      if (date < fromIso) continue;
      if (date > toIso) continue;
      // Pull INV-numbered references from the row HTML, dedup, drop self.
      const html = await row.innerHTML();
      const refs = Array.from(new Set((html.match(/INV\d{6,}/g) ?? [])))
        .filter(inv => inv !== number);
      out.push({ number, date, client, amount, appliedInvoices: refs });
    }
    return true;
  }, maxPages);

  const seen = new Set<string>();
  const dedup = out.filter(r => seen.has(r.number) ? false : (seen.add(r.number), true));
  console.log(`[flow] ${dedup.length} receipt(s) parsed`);

  // Mirror the empty-listing artefact we save for invoices — most useful
  // signal we have when CI silently sees 0 rows.
  if (dedup.length === 0) {
    try {
      await s.page.screenshot({ path: dbgPath("flow-debug-empty-receipts.png"), fullPage: true });
      const html = await s.page.content();
      fs.writeFileSync(dbgPath("flow-debug-empty-receipts.html"), html);
      console.log(`[flow] empty receipts — saved screenshot + HTML at ${s.page.url()}`);
    } catch (e) {
      console.error("[flow] could not save empty-receipts artefacts:", e);
    }
  }
  return dedup;
}

// Open each receipt's detail page to read which invoice(s) it was applied to.
export async function enrichReceiptsWithInvoices(s: FlowSession, receipts: FlowReceipt[]) {
  for (const rcp of receipts) {
    try {
      await gotoFiltered(s.page, "/receipts", rcp.date, rcp.date);
      const link = s.page.locator(`a:has-text("${rcp.number}"), tr:has-text("${rcp.number}") a`).first();
      if (!(await link.count())) continue;
      await link.click();
      await delay(2000);
      await s.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      // Look for any invoice-number-shaped strings in the page body, restricted
      // to a "Reference / Linked invoice" section if available. Fallback: pick
      // up any INVxxxxx-like tokens visible on the detail.
      const html = await s.page.content();
      const matches = Array.from(new Set(html.match(/INV\d{6,}|[A-Z]{2,4}\d{6,}/g) ?? []));
      rcp.appliedInvoices = matches;
    } catch (e) {
      console.warn(`[flow] enrich receipt ${rcp.number}: ${e}`);
    }
  }
}
