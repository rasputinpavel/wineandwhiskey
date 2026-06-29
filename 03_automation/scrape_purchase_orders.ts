/**
 * scrape_purchase_orders.ts
 * Scrapes Loyverse purchase order line items via Playwright.
 * Stores results in Supabase: purchase_orders + purchase_order_items.
 *
 * Usage:
 *   npm run orders                                # default: discover newest POs + scrape new/errored
 *   npm run orders -- --all                       # re-scrape every PO in Supabase
 *   npm run orders -- --po PO2890                 # single order
 *   npm run orders -- --no-discover               # skip the discover pass
 *   npm run orders -- --discover-pages 10         # widen the discover scan (default 5)
 *
 * Discover pass walks the Loyverse PO list page and inserts headers for any
 * po_number not yet in Supabase. This is the only way new POs enter the system.
 *
 * Env flags:
 *   SCRAPER_HEADFUL=1   open a visible browser (for selector debugging)
 *   SCRAPER_DEBUG=1     save screenshots on errors
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium, BrowserContext, Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Config ───────────────────────────────────────────────────────────────────

const LOYVERSE_EMAIL    = process.env.LOYVERSE_EMAIL!;
const LOYVERSE_PASSWORD = process.env.LOYVERSE_PASSWORD!;
const SUPABASE_URL      = process.env.SUPABASE_URL!;
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_KEY!;

const AUTH_STATE_PATH = path.join(process.cwd(), ".loyverse-session.json");
const HEADLESS = !process.env.SCRAPER_HEADFUL;
const DEBUG    = !!process.env.SCRAPER_DEBUG;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
// Separate client pinned to the `inventory` schema — that's where the
// supplier registry (inventory.supplier) lives. POs are in `public`.
const sbInventory = createClient(SUPABASE_URL, SUPABASE_KEY, { db: { schema: "inventory" } });

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const ALL_MODE  = args.includes("--all");
const NO_DISCOVER = args.includes("--no-discover");
const SINGLE_PO = (() => {
  const idx = args.indexOf("--po");
  if (idx !== -1) return args[idx + 1] ?? null;
  const eq = args.find(a => a.startsWith("--po="));
  return eq ? eq.split("=")[1] : null;
})();
// --month YYYY-MM: re-scrape every PO whose order_date falls inside that
// calendar month. Useful for refreshing totals after we changed the parser.
const MONTH_FILTER = (() => {
  const idx = args.indexOf("--month");
  const v = idx !== -1 ? args[idx + 1] : args.find(a => a.startsWith("--month="))?.split("=")[1];
  return v && /^\d{4}-\d{2}$/.test(v) ? v : null;
})();
// How many Loyverse list pages to scan during discover (50 POs/page).
// Default 5 ≈ 250 newest POs — comfortably covers a week's worth.
const DISCOVER_PAGES = (() => {
  const idx = args.indexOf("--discover-pages");
  const v = idx !== -1 ? args[idx + 1] : args.find(a => a.startsWith("--discover-pages="))?.split("=")[1];
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 5;
})();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Remove the Cookiebot consent dialog from the DOM so it can't intercept
// pointer events. Clicking the "Allow all" button worked sometimes but the
// banner kept re-rendering and blocked the login submit. Just nuke it.
async function nukeCookieConsent(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const ids = [
        "CybotCookiebotDialog",
        "CybotCookiebotDialogBody",
        "CybotCookiebotDialogBodyUnderlay",
      ];
      for (const id of ids) document.getElementById(id)?.remove();
      // Defensive: clear any leftover Cybot* elements
      document.querySelectorAll('[id^="CybotCookiebot"]').forEach(el => el.remove());
    });
  } catch { /* page closed / non-existent */ }
}

// ─── Phase 1: Auth ────────────────────────────────────────────────────────────

const IS_CI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;

async function ensureLoggedIn(context: BrowserContext, page: Page) {
  // Try saved session
  if (fs.existsSync(AUTH_STATE_PATH)) {
    await page.goto("https://r.loyverse.com/dashboard/#/inventory/orders", { waitUntil: "domcontentloaded" });
    await delay(3000);
    const url = page.url();
    if (!url.includes("login") && !url.includes("sign-in") && !url.includes("r.loyverse.com/#")) {
      console.log("  ✓ Reusing saved session.");
      return;
    }
    console.log("  Session expired.");
    fs.unlinkSync(AUTH_STATE_PATH);
    if (IS_CI) {
      // Loyverse triggers hCaptcha on automated headless logins, so CI cannot
      // re-authenticate by itself. Operator must refresh the secret manually
      // (see workflow file for the procedure).
      throw new Error(
        "Loyverse session expired. Refresh LOYVERSE_SESSION_B64 secret: " +
        "run scraper locally with SCRAPER_HEADFUL=1, solve captcha, then " +
        "`base64 -i .loyverse-session.json | pbcopy` and update the GitHub secret."
      );
    }
  } else if (IS_CI) {
    throw new Error(
      "No .loyverse-session.json present in CI. The workflow should decode " +
      "LOYVERSE_SESSION_B64 into this file before running the scraper."
    );
  }

  // Fresh login
  await page.goto("https://r.loyverse.com/", { waitUntil: "networkidle" });
  await delay(2000);

  // Strip the cookie banner up-front so it can't intercept clicks or
  // navigation. We do it again right before submit just in case the page
  // re-injects it during/after Angular bootstraps the form.
  await nukeCookieConsent(page);

  if (DEBUG) await page.screenshot({ path: "debug-login.png" });

  // Loyverse may use Angular with ng- attributes — try broad set of selectors
  const emailSelector = [
    'input[type="email"]',
    'input[name="email"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="Email" i]',
    'input[formcontrolname="email"]',
    'input[formcontrolname="login"]',
    'input[formcontrolname="username"]',
    'input:not([type="password"]):not([type="hidden"]):not([type="checkbox"])',
  ].join(", ");

  const emailInput = page.locator(emailSelector).first();
  await emailInput.waitFor({ timeout: 20_000 });
  await emailInput.fill(LOYVERSE_EMAIL);
  await delay(500);

  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill(LOYVERSE_PASSWORD);
  await delay(300);

  // Cookie banner sometimes re-renders late — strip it again just before submit.
  await nukeCookieConsent(page);

  // Submit by pressing Enter from the password field — Angular's form bound
  // ngSubmit handler fires natively, no overlay-blocked button click needed.
  await passwordInput.press("Enter");

  // Loyverse logs the user into a hash-routed dashboard URL. Wait up to 15s
  // for the URL to leave the login screen.
  for (let i = 0; i < 30; i++) {
    await delay(500);
    const u = page.url();
    if (!u.includes("login") && !u.includes("sign-in") && !/r\.loyverse\.com\/?$/.test(u)) break;
  }

  const urlAfter = page.url();
  if (urlAfter.includes("login") || urlAfter.includes("sign-in") || /r\.loyverse\.com\/?$/.test(urlAfter)) {
    if (DEBUG) await page.screenshot({ path: "debug-login-failed.png" });
    throw new Error(`Login failed — URL still ${urlAfter}. Check LOYVERSE_EMAIL/PASSWORD.`);
  }

  await context.storageState({ path: AUTH_STATE_PATH });
  console.log("  ✓ Logged in, session saved.");
}

// ─── Phase 2: ID Discovery ────────────────────────────────────────────────────

// ─── Phase 2+3: Click-based scraping (replaces XHR id-discovery + DOM scraping) ─

interface LineItem {
  product_name: string;
  sku: string | null;
  qty_ordered: number | null;
  qty_received: number | null;
  cost_price: number | null;
  line_total: number | null;
}

// Parse items from getPurchaseOrderDetail XHR response.
// Loyverse stores qty in milliunits (×1000) and prices in centimes (×100).
function parseXHRItems(rawItems: any[]): LineItem[] {
  return (rawItems ?? [])
    .filter(i => i.name?.trim() && !i.deleted)
    .map(i => ({
      product_name: i.name.trim(),
      sku:          i.article?.trim() || null,
      qty_ordered:  i.quantity  != null ? Math.round(i.quantity)  / 1000 : null,
      qty_received: i.received  != null ? Math.round(i.received)  / 1000 : null,
      cost_price:   i.supplyCost != null ? Math.round(i.supplyCost) / 100 : null,
      line_total:   i.amount    != null ? Math.round(i.amount)    / 100  : null,
    }));
}

// Navigate to the PO list via the sidebar.
async function navigateToPOList(page: Page) {
  await page.goto("https://r.loyverse.com/dashboard/", { waitUntil: "networkidle" });
  await delay(3000);

  if (DEBUG) await page.screenshot({ path: "debug-sidebar.png" });

  const menuItem = page.locator(".nav-parent.inventory, #lv_menu_item_inventory_small").first();
  await menuItem.waitFor({ timeout: 10_000 });
  await menuItem.click();
  await delay(2000);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

  const poSubMenu = page.locator('text="Purchase orders"').first();
  await poSubMenu.waitFor({ timeout: 10_000 });
  await poSubMenu.click();
  await delay(3000);
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

  if (DEBUG) await page.screenshot({ path: "debug-po-list.png" });
}

// Discover newest POs from the Loyverse PO list and insert headers for any
// po_number not already in Supabase. Reads each row's columns directly (no
// detail click), so it's much faster than full scraping.
async function discoverNewPOs(page: Page, pagesToScan: number): Promise<number> {
  await navigateToPOList(page);
  const LIMIT = 50;

  // Snapshot all existing po_numbers (Supabase select() caps at 1000 rows
  // unless we page — without this the set silently misses older POs and we
  // re-upsert headers we already have).
  const known = new Set<string>();
  let cur = 0;
  while (true) {
    const { data, error } = await supabase
      .from("purchase_orders").select("po_number").range(cur, cur + 999);
    if (error) throw new Error(`Discover snapshot: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) known.add((r as any).po_number as string);
    if (data.length < 1000) break;
    cur += 1000;
  }

  const newRecords: any[] = [];
  for (let pageNum = 0; pageNum < pagesToScan; pageNum++) {
    await page.evaluate(({ p, l }) => {
      window.location.hash = `/inventory/purchase?page=${p}&limit=${l}`;
    }, { p: pageNum, l: LIMIT });
    await delay(1500);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await delay(500);

    const rows = page.locator("tr.tableBodyBody.list");
    const rowCount = await rows.count();
    if (rowCount === 0) break;

    let foundOnPage = 0;
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      // Read all td.item cells in order. Layout (Loyverse PO list):
      //   0: PO number, 1: store, 2: supplier, 3: status, 4: received,
      //   5: expected_on, 6: order_date, 7: total
      const cells = await row.locator("td.item").allInnerTexts();
      const poText = (cells[0] ?? "").trim();
      const m = poText.match(/\b(PO\d+)\b/i);
      if (!m) continue;
      const poNumber = m[1].toUpperCase();

      // Loyverse PO list page layout (verified May 2026):
      //   0: PO number     1: order date      2: supplier
      //   3: store         4: status          5: received "X of Y"
      //   6: expected_on   7: total ฿
      const ordDate = (cells[1] ?? "").trim();
      const expDate = (cells[6] ?? "").trim();
      // Loyverse renders dates in one of two formats — historical "Apr 28,
      // 2026" (Mon DD, YYYY) and current "20 May 2026" (DD Mon YYYY). The
      // switch happened around May 2026; new POs from then on returned
      // NULL order_date until this parser learned both shapes.
      // We do NOT use new Date(s) because in a non-UTC timezone (e.g.
      // Bangkok) toISOString shifts the calendar date back by one day.
      const MONTHS: Record<string, string> = {
        Jan:"01", Feb:"02", Mar:"03", Apr:"04", May:"05", Jun:"06",
        Jul:"07", Aug:"08", Sep:"09", Oct:"10", Nov:"11", Dec:"12",
      };
      const toIso = (s: string): string | null => {
        if (!s) return null;
        // "Apr 28, 2026" — historical
        const mUS = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
        if (mUS && MONTHS[mUS[1]]) return `${mUS[3]}-${MONTHS[mUS[1]]}-${mUS[2].padStart(2, "0")}`;
        // "20 May 2026" — current (verified May 2026)
        const mEU = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
        if (mEU && MONTHS[mEU[2]]) return `${mEU[3]}-${MONTHS[mEU[2]]}-${mEU[1].padStart(2, "0")}`;
        // Fallback for ISO-ish input
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        return null;
      };
      // Strip currency / spaces; thousands separator is "," and decimal "." (US-style).
      const totalStr = (cells[7] ?? "").replace(/[^\d.\-]/g, "");
      const total = Number(totalStr);

      newRecords.push({
        po_number:   poNumber,
        order_date:  toIso(ordDate),
        supplier:    (cells[2] ?? "").trim() || null,
        store:       (cells[3] ?? "").trim() || null,
        status:      (cells[4] ?? "").trim() || null,
        received:    (cells[5] ?? "").trim() || null,
        expected_on: toIso(expDate),
        total_thb:   Number.isFinite(total) && total > 0 ? total : null,
      });
      known.add(poNumber);
      foundOnPage++;
    }
    console.log(`  Discover page ${pageNum}: ${foundOnPage} PO row(s) from ${rowCount}`);
    if (rowCount < LIMIT) break;
  }

  if (newRecords.length === 0) {
    console.log("  No POs discovered from Loyverse.");
    return 0;
  }
  // Upsert WITH overwrite: if Loyverse list shows different status / total now
  // than what's in DB, trust Loyverse. This is how we self-correct stale data.
  const { error } = await supabase
    .from("purchase_orders")
    .upsert(newRecords, { onConflict: "po_number", ignoreDuplicates: false });
  if (error) throw new Error(`Discover upsert: ${error.message}`);
  console.log(`  ✓ Upserted ${newRecords.length} PO header row(s).`);
  return newRecords.length;
}

// Single-pass click-based scraper.
// - Paginates through the PO list.
// - For each row matching a target PO: clicks the row, intercepts getPurchaseOrderDetail
//   XHR response (which contains correct loyverse_id + items), upserts to Supabase.
// - Uses page.goBack() to return to the list after each order.
//
// Why click-based instead of XHR interception on the list view:
//   The Loyverse list API returns a different numeric id than the orderdetail URL
//   parameter, so XHR-captured IDs were pointing to the wrong detail pages.
//   Clicking a row and reading the resulting URL id is always correct.
async function scrapeViaListClick(
  page: Page,
  targetPOs: Set<string>,
): Promise<{ success: number; failed: number }> {
  let success = 0, failed = 0;

  await navigateToPOList(page);

  const LIMIT = 50;
  let pageNum = 0;

  while (targetPOs.size > 0 && pageNum <= 40) {
    await page.evaluate(({ p, l }) => {
      window.location.hash = `/inventory/purchase?page=${p}&limit=${l}`;
    }, { p: pageNum, l: LIMIT });
    await delay(2000);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await delay(800);

    const rows = page.locator("tr.tableBodyBody.list");
    const rowCount = await rows.count();
    if (rowCount === 0) break;

    // Read all PO numbers on this page
    const pagePoNums: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      const text = await rows.nth(i).locator("td.item").first().innerText().catch(() => "");
      const m = text.trim().match(/\b(PO\d+)\b/i);
      if (m) pagePoNums.push(m[1].toUpperCase());
    }

    const onThisPage = pagePoNums.filter(p => targetPOs.has(p));
    process.stdout.write(`  Page ${pageNum}: ${rowCount} rows, ${onThisPage.length} to scrape\n`);

    if (onThisPage.length === 0) {
      if (rowCount < LIMIT) break;
      pageNum++;
      continue;
    }

    for (const poNum of onThisPage) {
      // Ensure we're on the right list page
      if (!page.url().includes(`page=${pageNum}`)) {
        await page.evaluate(({ p, l }) => {
          window.location.hash = `/inventory/purchase?page=${p}&limit=${l}`;
        }, { p: pageNum, l: LIMIT });
        await delay(1500);
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
        await delay(500);
      }

      const row = page.locator("tr.tableBodyBody.list").filter({ hasText: poNum }).first();
      if (!(await row.count())) {
        console.warn(`  ⚠ Row for ${poNum} not found on page ${pageNum}`);
        targetPOs.delete(poNum);
        failed++;
        continue;
      }

      // Arm XHR interceptor before clicking
      const detailPromise = page.waitForResponse(
        r => r.url().includes("getPurchaseOrderDetail"),
        { timeout: 25_000 }
      );

      await row.click();

      try {
        const detailResp = await detailPromise;
        const body = await detailResp.json();

        // loyverse_id: prefer URL param, fallback to orderData.id (they match)
        const urlNow = page.url();
        const idMatch = urlNow.match(/[?&]id=(\d+)/);
        const loyverseId: number = idMatch ? parseInt(idMatch[1]) : (body.orderData?.id ?? 0);

        const items = parseXHRItems(body.items ?? []);

        // Loyverse stores money in centimes. orderData.amount is the
        // PRE-DISCOUNT items sum. PO-level discount and VAT both live as
        // separate rows in landedCosts:
        //   negative amount → discount    (e.g. -64000 = "-640 ฿")
        //   positive amount → VAT or shipping  (e.g. 17920 = "179.20 ฿")
        // Net (after discount, before VAT) = items + Σ negative landedCosts.
        // VAT = Σ positive landedCosts.
        // Total = Net + VAT (= what the supplier invoice / bookkeeper reflects).
        const itemsCentimes = Number(body.orderData?.amount ?? 0);
        const lc = (body.landedCosts ?? []) as any[];
        const negLcCentimes = lc.filter(x => Number(x?.amount ?? 0) < 0)
                                .reduce((s, x) => s + Number(x.amount ?? 0), 0);
        const posLcCentimes = lc.filter(x => Number(x?.amount ?? 0) > 0)
                                .reduce((s, x) => s + Number(x.amount ?? 0), 0);
        const subtotalThb = (itemsCentimes + negLcCentimes) / 100;
        const vatThb      = posLcCentimes / 100;
        const totalThb    = subtotalThb + vatThb;

        // poDateTS / expectedDateTS are stored as UTC midnight of the
        // *Bangkok-local* day (e.g. PO created at 9am BKK on Apr 1 →
        // "2026-03-31T17:00:00.000+00:00"). Loyverse's own list page
        // confusingly shows the UTC calendar date, but the operator (and
        // bookkeeper) reasons about it in Bangkok time. Convert to BKK
        // before writing.
        const bkkDate = (iso?: string) => iso
          ? new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
          : undefined;
        const headerExtras = {
          status:       body.orderData?.status ? String(body.orderData.status) : undefined,
          supplier:     body.orderData?.supplier ?? body.supplier?.name ?? undefined,
          store:        body.orderData?.store ?? undefined,
          subtotal_thb: Number.isFinite(subtotalThb) && subtotalThb > 0 ? subtotalThb : undefined,
          vat_thb:      Number.isFinite(vatThb) ? vatThb : undefined,
          total_thb:    Number.isFinite(totalThb) && totalThb > 0 ? totalThb : undefined,
          order_date:   bkkDate(body.orderData?.poDateTS),
          expected_on:  bkkDate(body.orderData?.expectedDateTS),
        };

        await upsertOrder(poNum, loyverseId, items, headerExtras);
        console.log(`  ✓ ${poNum} — ${items.length} items, total=${totalThb.toFixed(2)} ฿`);
        targetPOs.delete(poNum);
        success++;
      } catch (err) {
        console.error(`  ✗ ${poNum}: ${err}`);
        await supabase.from("purchase_orders")
          .update({ scrape_error: String(err) })
          .eq("po_number", poNum);
        targetPOs.delete(poNum);
        failed++;
      }

      // Return to list
      await page.goBack();
      await delay(1000);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await delay(500);
    }

    if (rowCount < LIMIT) break;
    pageNum++;
  }

  if (targetPOs.size > 0) {
    console.warn(`  ⚠ ${targetPOs.size} POs not found in list: ${[...targetPOs].slice(0, 10).join(", ")}`);
  }

  return { success, failed };
}

// ─── Phase 4: Supabase upsert ─────────────────────────────────────────────────

async function upsertOrder(
  poNumber: string,
  loyverseId: number,
  items: LineItem[],
  extras: { status?: string; supplier?: string; store?: string; subtotal_thb?: number; vat_thb?: number; total_thb?: number; order_date?: string; expected_on?: string } = {},
) {
  // Build a single upsert payload that includes both the always-on fields
  // (loyverse_id / url / scraped_at) and any header values we extracted from
  // the XHR detail. We OMIT undefined keys so a missing field never clobbers
  // a known good value already in DB.
  const payload: any = {
    po_number: poNumber,
    loyverse_id: loyverseId,
    url: `https://r.loyverse.com/dashboard/#/inventory/orderdetail?id=${loyverseId}`,
    scraped_at: new Date().toISOString(),
    scrape_error: null,
  };
  for (const [k, v] of Object.entries(extras)) {
    if (v !== undefined && v !== null && v !== "") payload[k] = v;
  }
  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .upsert(payload, { onConflict: "po_number" })
    .select("id")
    .single();

  if (poErr) throw new Error(`PO upsert: ${poErr.message}`);

  await supabase.from("purchase_order_items").delete().eq("po_id", po.id);

  if (items.length > 0) {
    const { error: itemErr } = await supabase
      .from("purchase_order_items")
      .insert(items.map(i => ({ ...i, po_id: po.id, po_number: poNumber, scraped_at: new Date().toISOString() })));
    if (itemErr) throw new Error(`Items insert: ${itemErr.message}`);
  }
}

// Auto-register suppliers. Any supplier name that appears on a PO but is not
// yet in inventory.supplier gets created with table defaults (type=regular,
// payment_terms_days=0) — the operator fills Type/Terms in the portal later.
// This is what makes a brand-new Loyverse supplier show up in the portal's
// Suppliers list without manual SQL.
//
// Idempotent and case-insensitive: we compare on lower(trim(name)) so we never
// create a case/whitespace variant of an existing supplier (e.g. "BB&B" when
// "bb&b" already exists). The join in the portal is also case-insensitive, so
// keeping one canonical row per name keeps PO stats attached to it.
async function syncSuppliersFromPOs(): Promise<number> {
  // 1. Distinct supplier names seen on POs (paged — select caps at 1000 rows).
  const seen = new Map<string, string>(); // lower(trim) -> original spelling
  let cur = 0;
  while (true) {
    const { data, error } = await supabase
      .from("purchase_orders").select("supplier").range(cur, cur + 999);
    if (error) throw new Error(`Supplier sync (read POs): ${error.message}`);
    if (!data?.length) break;
    for (const r of data) {
      const name = ((r as any).supplier ?? "").trim();
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
    if (data.length < 1000) break;
    cur += 1000;
  }

  // 2. Existing supplier names (lower(trim)) from inventory.supplier.
  const existing = new Set<string>();
  cur = 0;
  while (true) {
    const { data, error } = await sbInventory
      .from("supplier").select("name").range(cur, cur + 999);
    if (error) throw new Error(`Supplier sync (read registry): ${error.message}`);
    if (!data?.length) break;
    for (const r of data) existing.add(((r as any).name as string).trim().toLowerCase());
    if (data.length < 1000) break;
    cur += 1000;
  }

  // 3. Insert the difference. ignoreDuplicates guards against a race on the
  //    unique(name) constraint; the lower() filter guards against case variants.
  const toAdd = [...seen.entries()]
    .filter(([lower]) => !existing.has(lower))
    .map(([, name]) => ({ name }));
  if (toAdd.length === 0) {
    console.log("  No new suppliers to register.");
    return 0;
  }
  const { error } = await sbInventory
    .from("supplier")
    .upsert(toAdd, { onConflict: "name", ignoreDuplicates: true });
  if (error) throw new Error(`Supplier sync (insert): ${error.message}`);
  console.log(`  ✓ Registered ${toAdd.length} new supplier(s): ${toAdd.map(s => s.name).join(", ")}`);
  return toAdd.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// Pull all distinct po_numbers that already have items (paged — Supabase caps select() at 1000 rows).
async function loadPOsWithItems(): Promise<Set<string>> {
  const uniq = new Set<string>();
  let cur = 0;
  while (true) {
    const { data, error } = await supabase
      .from("purchase_order_items")
      .select("po_number")
      .range(cur, cur + 999);
    if (error) throw new Error(`Load items index: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) uniq.add((r as any).po_number as string);
    if (data.length < 1000) break;
    cur += 1000;
  }
  return uniq;
}

async function main() {
  const doDiscover = !SINGLE_PO && !NO_DISCOVER;
  console.log("\nWine & Whiskey — Purchase Orders Scraper");
  const modeLabel = SINGLE_PO ? `single (${SINGLE_PO})`
                  : MONTH_FILTER ? `month (${MONTH_FILTER}) — re-scrape all in range`
                  : ALL_MODE ? "all" : "incremental";
  console.log(`Mode: ${modeLabel}${doDiscover ? ` + discover (${DISCOVER_PAGES} page(s))` : ""}\n`);

  console.log(`[1/3] Starting browser (headless: ${HEADLESS})...`);
  const browser = await chromium.launch({ headless: HEADLESS });
  // Pin browser timezone to Bangkok. Loyverse renders PO dates relative to
  // the browser timezone — headless chromium defaults to UTC, which shifted
  // every date back by one day (a PO created at 00:00 BKK was rendered as
  // "previous day 17:00 UTC"). Pinning BKK makes the rendered date match
  // what the user sees in their normal browser.
  const ctxOpts = { timezoneId: 'Asia/Bangkok' as const, locale: 'en-US' as const };
  const context = fs.existsSync(AUTH_STATE_PATH)
    ? await browser.newContext({ storageState: AUTH_STATE_PATH, ...ctxOpts })
    : await browser.newContext(ctxOpts);
  const page = await context.newPage();

  try {
    console.log("[2/3] Authenticating...");
    await ensureLoggedIn(context, page);

    if (doDiscover) {
      console.log(`\n[2.5/3] Discovering new POs from Loyverse list (${DISCOVER_PAGES} page(s))...`);
      await discoverNewPOs(page, DISCOVER_PAGES);
    }

    const { data: allPOs, error: listErr } = await supabase
      .from("purchase_orders")
      .select("po_number, scrape_error")
      .order("order_date", { ascending: false, nullsFirst: false });
    if (listErr) throw new Error(`Fetch POs: ${listErr.message}`);

    const hasItems = await loadPOsWithItems();
    let allPOList = allPOs ?? [];
    if (SINGLE_PO) allPOList = allPOList.filter(po => po.po_number === SINGLE_PO);
    if (MONTH_FILTER) {
      // Widen the filter by ±1 day to catch timezone-edge POs whose
      // order_date currently sits on the last day of the prior month or
      // the first day of the next month due to UTC↔Bangkok shifts.
      const [yy, mm] = MONTH_FILTER.split("-").map(Number);
      const firstOfMonth = new Date(Date.UTC(yy, mm - 1, 1));
      const dayBefore   = new Date(firstOfMonth.getTime() - 86_400_000).toISOString().slice(0, 10);
      const firstNext   = new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 10);
      const dayAfterEnd = new Date(new Date(firstNext).getTime() + 86_400_000).toISOString().slice(0, 10);
      const { data: dated, error: e2 } = await supabase
        .from("purchase_orders")
        .select("po_number, order_date, scrape_error")
        .gte("order_date", dayBefore)
        .lt("order_date", dayAfterEnd);
      if (e2) throw new Error(`Month filter fetch: ${e2.message}`);
      allPOList = (dated ?? []).map(d => ({ po_number: d.po_number, scrape_error: d.scrape_error }));
    }

    // --month implies a forced re-scrape of every PO in that range.
    const forceAll = ALL_MODE || MONTH_FILTER !== null;
    const targetSet: Set<string> = forceAll
      ? new Set(allPOList.map(po => po.po_number))
      : new Set(allPOList
          .filter(po => !hasItems.has(po.po_number) || po.scrape_error)
          .map(po => po.po_number));

    if (targetSet.size === 0) {
      console.log("Nothing to scrape — all orders are up to date.");
    } else {
      console.log(`\n[3/3] Scraping ${targetSet.size} orders via list clicks...`);
      const { success, failed } = await scrapeViaListClick(page, targetSet);
      console.log(`\n✓ Done. ${success} succeeded, ${failed} failed.`);
    }

    // Register any new suppliers seen on POs into inventory.supplier so they
    // appear in the portal Suppliers list. Runs every pass — cheap and idempotent.
    console.log("\n[+] Syncing suppliers from POs into registry...");
    await syncSuppliersFromPOs();
    console.log("");

  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
