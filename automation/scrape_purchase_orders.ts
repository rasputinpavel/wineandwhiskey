/**
 * scrape_purchase_orders.ts
 * Scrapes Loyverse purchase order line items via Playwright.
 * Stores results in Supabase: purchase_orders + purchase_order_items.
 *
 * Usage:
 *   npm run orders                    # incremental — only new/errored POs
 *   npm run orders -- --all           # re-scrape all orders
 *   npm run orders -- --po PO2890     # single order
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
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const SHEET_ID = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";

const AUTH_STATE_PATH = path.join(process.cwd(), ".loyverse-session.json");
const HEADLESS = !process.env.SCRAPER_HEADFUL;
const DEBUG    = !!process.env.SCRAPER_DEBUG;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const ALL_MODE  = args.includes("--all");
const SINGLE_PO = (() => {
  const idx = args.indexOf("--po");
  if (idx !== -1) return args[idx + 1] ?? null;
  const eq = args.find(a => a.startsWith("--po="));
  return eq ? eq.split("=")[1] : null;
})();

// ─── Google Sheets helpers ────────────────────────────────────────────────────

let _gtoken: string | null = null;
async function gToken(): Promise<string> {
  if (_gtoken) return _gtoken;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`OAuth2: ${await r.text()}`);
  _gtoken = (await r.json()).access_token;
  return _gtoken!;
}

async function sheetsGet(range: string): Promise<string[][]> {
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${await gToken()}` } }
  );
  if (!r.ok) throw new Error(`Sheets GET ${range}: ${await r.text()}`);
  return (await r.json()).values ?? [];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseSheetDate(s: string): string | null {
  if (!s?.trim()) return null;
  const d = new Date(s.trim());
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseTHB(s: string): number | null {
  if (!s?.trim()) return null;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

function parseNum(s: string): number | null {
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Phase 0: Bootstrap headers from Google Sheets ───────────────────────────

async function bootstrapFromSheets() {
  console.log("[0/4] Reading Google Sheets 'Purcahse Orders' tab...");
  const rows = await sheetsGet("Purcahse Orders!A2:H");
  if (!rows.length) { console.log("  No rows found."); return; }

  const records = rows
    .map(r => ({
      po_number:   r[0]?.trim(),
      order_date:  parseSheetDate(r[1]),
      supplier:    r[2]?.trim() || null,
      store:       r[3]?.trim() || null,
      status:      r[4]?.trim() || null,
      received:    r[5]?.trim() || null,
      expected_on: parseSheetDate(r[6]),
      total_thb:   parseTHB(r[7]),
    }))
    .filter(r => r.po_number);

  const { error } = await supabase
    .from("purchase_orders")
    .upsert(records, { onConflict: "po_number", ignoreDuplicates: true });

  if (error) throw new Error(`Bootstrap upsert: ${error.message}`);
  console.log(`  ✓ Upserted ${records.length} PO headers (headers only, no override).`);
}

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

async function main() {
  console.log("\nWine & Whiskey — Purchase Orders Scraper");
  console.log(`Mode: ${SINGLE_PO ? `single (${SINGLE_PO})` : ALL_MODE ? "all" : "incremental"}\n`);

  // Phase 0: Sync headers from Sheets (skip if running single PO or if Supabase already has data)
  const { count: existingCount } = await supabase.from("purchase_orders").select("*", { count: "exact", head: true });
  if (!SINGLE_PO && (existingCount ?? 0) === 0) {
    await bootstrapFromSheets();
  }

  // Fetch all POs from Supabase
  const { data: allPOs, error: listErr } = await supabase
    .from("purchase_orders")
    .select("po_number, loyverse_id, scrape_error")
    .order("order_date", { ascending: false });
  if (listErr) throw new Error(`Fetch POs: ${listErr.message}`);

  // Find which POs need scraping
  const { data: poWithItems } = await supabase
    .from("purchase_order_items")
    .select("po_number");
  const hasItems = new Set((poWithItems ?? []).map((r: any) => r.po_number as string));

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

  console.log(`[2/3] Starting browser (headless: ${HEADLESS})...`);
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = fs.existsSync(AUTH_STATE_PATH)
    ? await browser.newContext({ storageState: AUTH_STATE_PATH })
    : await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("[2/3] Authenticating...");
    await ensureLoggedIn(context, page);

    console.log(`\n[3/3] Scraping ${targetSet.size} orders via list clicks...`);
    const { success, failed } = await scrapeViaListClick(page, targetSet);

    console.log(`\n✓ Done. ${success} succeeded, ${failed} failed.\n`);

  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
