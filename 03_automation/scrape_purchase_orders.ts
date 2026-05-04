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

// ─── Phase 1: Auth ────────────────────────────────────────────────────────────

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
    console.log("  Session expired, re-authenticating...");
    fs.unlinkSync(AUTH_STATE_PATH);
  }

  // Fresh login
  await page.goto("https://r.loyverse.com/", { waitUntil: "networkidle" });
  await delay(2000);

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

  await page.locator('input[type="password"]').first().fill(LOYVERSE_PASSWORD);
  await delay(300);
  // Dismiss CybotCookiebot dialog if it's blocking the submit button
  try {
    await page.locator('#CybotCookiebotDialogBodyButtonAccept, #CybotCookiebotDialogBodyLevelButtonAccept, button[id*="CybotCookiebot"][id*="Accept"]').first().click({ timeout: 3000 });
    await delay(500);
  } catch { /* dialog not present */ }

  await page.locator('button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")').first().click();

  // Wait for navigation (hash routing may not trigger waitForURL)
  await delay(5000);
  const urlAfter = page.url();
  if (urlAfter.includes("login") || urlAfter.includes("sign-in")) {
    throw new Error("Login failed — check LOYVERSE_EMAIL and LOYVERSE_PASSWORD");
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
      if (known.has(poNumber)) continue;

      // Date strings come like "Apr 18, 2026"; new Date() parses these fine.
      const expDate  = (cells[5] ?? "").trim();
      const ordDate  = (cells[6] ?? "").trim();
      const toIso = (s: string): string | null => {
        if (!s) return null;
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      };
      const totalStr = (cells[7] ?? "").replace(/[^\d.,-]/g, "").replace(/,/g, ".");
      const total = Number(totalStr);

      newRecords.push({
        po_number:   poNumber,
        order_date:  toIso(ordDate),
        supplier:    (cells[2] ?? "").trim() || null,
        store:       (cells[1] ?? "").trim() || null,
        status:      (cells[3] ?? "").trim() || null,
        received:    (cells[4] ?? "").trim() || null,
        expected_on: toIso(expDate),
        total_thb:   Number.isFinite(total) ? total : null,
      });
      known.add(poNumber);
      foundOnPage++;
    }
    console.log(`  Discover page ${pageNum}: ${foundOnPage} new PO header(s) from ${rowCount} rows`);
    if (rowCount < LIMIT) break;
  }

  if (newRecords.length === 0) {
    console.log("  No new POs discovered from Loyverse.");
    return 0;
  }
  const { error } = await supabase
    .from("purchase_orders")
    .upsert(newRecords, { onConflict: "po_number", ignoreDuplicates: true });
  if (error) throw new Error(`Discover upsert: ${error.message}`);
  console.log(`  ✓ Inserted ${newRecords.length} new PO header(s).`);
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
        await upsertOrder(poNum, loyverseId, items);
        console.log(`  ✓ ${poNum} — ${items.length} items`);
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

async function upsertOrder(poNumber: string, loyverseId: number, items: LineItem[]) {
  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .upsert(
      { po_number: poNumber, loyverse_id: loyverseId, url: `https://r.loyverse.com/dashboard/#/inventory/orderdetail?id=${loyverseId}`, scraped_at: new Date().toISOString(), scrape_error: null },
      { onConflict: "po_number" }
    )
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
  console.log(`Mode: ${SINGLE_PO ? `single (${SINGLE_PO})` : ALL_MODE ? "all" : "incremental"}${doDiscover ? ` + discover (${DISCOVER_PAGES} page(s))` : ""}\n`);

  console.log(`[1/3] Starting browser (headless: ${HEADLESS})...`);
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = fs.existsSync(AUTH_STATE_PATH)
    ? await browser.newContext({ storageState: AUTH_STATE_PATH })
    : await browser.newContext();
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

    const targetSet: Set<string> = ALL_MODE
      ? new Set(allPOList.map(po => po.po_number))
      : new Set(allPOList
          .filter(po => !hasItems.has(po.po_number) || po.scrape_error)
          .map(po => po.po_number));

    if (targetSet.size === 0) {
      console.log("Nothing to do — all orders are up to date.\n");
      return;
    }

    console.log(`\n[3/3] Scraping ${targetSet.size} orders via list clicks...`);
    const { success, failed } = await scrapeViaListClick(page, targetSet);
    console.log(`\n✓ Done. ${success} succeeded, ${failed} failed.\n`);

  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
