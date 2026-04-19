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
  console.log("[0/4] Reading Google Sheets 'Suppliers' tab...");
  const rows = await sheetsGet("Suppliers!A2:H");
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

async function discoverIds(page: Page): Promise<Map<string, number>> {
  const idMap = new Map<string, number>(); // "PO2890" → 1594655

  // Intercept XHR responses — Loyverse SPA makes internal API calls
  page.on("response", async response => {
    if (!response.url().includes("loyverse.com")) return;
    if (response.status() !== 200) return;
    const ct = response.headers()["content-type"] ?? "";
    if (!ct.includes("json")) return;
    try {
      const body = await response.json();
      if (DEBUG) console.log(`  [xhr] ${response.url().slice(0, 80)} → keys: ${Object.keys(body).join(", ")}`);
      const orders: any[] = body.purchase_orders ?? body.orders ?? body.data ?? body.items ?? [];
      if (!Array.isArray(orders)) return;
      for (const o of orders) {
        if (DEBUG) console.log(`  [xhr-item] keys: ${Object.keys(o).join(", ")}, sample: ${JSON.stringify(o).slice(0, 100)}`);
        const numId = o.id ?? o.loyverse_id ?? o.order_id;
        const poNum = o.order ?? o.order_number ?? o.po_number ?? o.number ?? o.name;
        if (numId && poNum && /^PO\d+$/i.test(String(poNum))) {
          idMap.set(String(poNum).toUpperCase(), Number(numId));
        }
      }
    } catch { /* non-JSON, skip */ }
  });

  // Navigate to dashboard, then click Items (goods) → Purchase Orders
  await page.goto("https://r.loyverse.com/dashboard/", { waitUntil: "networkidle" });
  await delay(3000);

  if (DEBUG) await page.screenshot({ path: "debug-sidebar.png" });

  // Loyverse Angular sidebar: menu items are div.nav-parent with class = section name
  // "goods" = Items section (contains Purchase Orders per user guidance)
  // Try "goods" first, fallback to "inventory"
  const menuItem = page.locator(".nav-parent.inventory, #lv_menu_item_inventory_small").first();
  await menuItem.waitFor({ timeout: 10_000 });
  await menuItem.click();
  await delay(2000);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  if (DEBUG) await page.screenshot({ path: "debug-after-goods.png" });

  // Click "Purchase orders" in the submenu (exact text from DOM)
  const poSubMenu = page.locator('text="Purchase orders"').first();
  await poSubMenu.waitFor({ timeout: 10_000 });
  await poSubMenu.click();
  await delay(3000);
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  if (DEBUG) await page.screenshot({ path: "debug-after-po-click.png" });

  // Paginate through all pages — XHR interceptor captures IDs automatically
  const LIMIT = 50;
  let pageNum = 0;
  let lastSize = -1;
  while (true) {
    await page.evaluate(({ p, l }) => {
      window.location.hash = `/inventory/purchase?page=${p}&limit=${l}`;
    }, { p: pageNum, l: LIMIT });
    await delay(1500);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await delay(500);

    const currentSize = idMap.size;
    process.stdout.write(`  Page ${pageNum}: ${currentSize} IDs total\n`);

    // Stop when no new IDs were captured (end of list)
    if (currentSize === lastSize) break;
    // Safety: stop after 40 pages (2000 orders)
    if (pageNum >= 40) break;

    lastSize = currentSize;
    pageNum++;
  }

  return idMap;
}

// ─── Phase 3: Scrape order detail ────────────────────────────────────────────

interface LineItem {
  product_name: string;
  sku: string | null;
  qty_ordered: number | null;
  qty_received: number | null;
  cost_price: number | null;
  line_total: number | null;
}

async function scrapeDetail(page: Page, loyverseId: number, poNumber: string): Promise<LineItem[]> {
  await page.goto(
    `https://r.loyverse.com/dashboard/#/inventory/orderdetail?id=${loyverseId}`,
    { waitUntil: "domcontentloaded" }
  );

  // Wait for data rows (skip header row which has class checkbox-table-header-row)
  try {
    await page.waitForSelector("tr.checkbox-table-row", { timeout: 20_000 });
  } catch {
    if (DEBUG) await page.screenshot({ path: `debug-${poNumber}.png` });
    throw new Error("Items table not found");
  }
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

  // Loyverse detail table: Item | Quantity | Purchase cost | Amount
  const rows = await page.locator("tr.checkbox-table-row").all();
  if (!rows.length) throw new Error("No item rows found");

  const items: LineItem[] = [];
  for (const row of rows) {
    // Product name is in .purchase-order-item-name span
    const name = await row.locator(".purchase-order-item-name span").first()
      .innerText().catch(() => "");
    if (!name.trim()) continue;

    // SKU is in .purchase-order-item-sku (text like "SKU 10510")
    const skuRaw = await row.locator(".purchase-order-item-sku").first()
      .innerText().catch(() => "");
    const sku = skuRaw.replace(/^SKU\s*/i, "").trim() || null;

    // Numeric cells: td[1]=qty, td[2]=cost, td[3]=amount
    const cells = await row.locator("td").all();
    const cellTexts = await Promise.all(cells.map(c => c.innerText().catch(() => "")));

    items.push({
      product_name: name.trim(),
      sku,
      qty_ordered:  parseNum(cellTexts[1] ?? ""),
      qty_received: null, // not shown on detail page
      cost_price:   parseNum(cellTexts[2] ?? ""),
      line_total:   parseNum(cellTexts[3] ?? ""),
    });
  }

  return items;
}

// ─── Phase 4: Supabase upsert ─────────────────────────────────────────────────

async function upsertOrder(poNumber: string, loyverseId: number, items: LineItem[]) {
  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .upsert(
      { po_number: poNumber, loyverse_id: loyverseId, scraped_at: new Date().toISOString(), scrape_error: null },
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

  // Phase 0: Sync headers from Sheets
  await bootstrapFromSheets();

  // Fetch all POs from Supabase
  const { data: allPOs, error: listErr } = await supabase
    .from("purchase_orders")
    .select("po_number, loyverse_id, scrape_error")
    .order("order_date", { ascending: false });
  if (listErr) throw new Error(`Fetch POs: ${listErr.message}`);

  // Find which POs already have items
  const { data: poWithItems } = await supabase
    .from("purchase_order_items")
    .select("po_number");
  const hasItems = new Set((poWithItems ?? []).map((r: any) => r.po_number as string));

  let targetPOs = allPOs ?? [];
  if (SINGLE_PO) targetPOs = targetPOs.filter(po => po.po_number === SINGLE_PO);

  const needsId = targetPOs.filter(po => !po.loyverse_id);
  const needsScrape: Array<{ po_number: string; loyverse_id: number }> = ALL_MODE
    ? targetPOs.filter(po => po.loyverse_id).map(po => ({ po_number: po.po_number, loyverse_id: po.loyverse_id! }))
    : targetPOs
        .filter(po => po.loyverse_id && (!hasItems.has(po.po_number) || po.scrape_error))
        .map(po => ({ po_number: po.po_number, loyverse_id: po.loyverse_id! }));

  if (needsId.length === 0 && needsScrape.length === 0) {
    console.log("Nothing to do — all orders are up to date.\n");
    return;
  }

  console.log(`[1/4] Starting browser (headless: ${HEADLESS})...`);
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = fs.existsSync(AUTH_STATE_PATH)
    ? await browser.newContext({ storageState: AUTH_STATE_PATH })
    : await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("[2/4] Authenticating...");
    await ensureLoggedIn(context, page);

    // ID Discovery
    if (needsId.length > 0) {
      console.log(`\n[2.5/4] Discovering IDs for ${needsId.length} orders without loyverse_id...`);
      const idMap = await discoverIds(page);
      console.log(`  Found ${idMap.size} IDs total.`);

      // Upsert discovered IDs and queue for scraping
      for (const po of needsId) {
        const id = idMap.get(po.po_number.toUpperCase());
        if (!id) { console.log(`  ⚠ No ID found for ${po.po_number}`); continue; }
        await supabase.from("purchase_orders")
          .update({ loyverse_id: id })
          .eq("po_number", po.po_number)
          .is("loyverse_id", null);
        if (!hasItems.has(po.po_number)) {
          needsScrape.push({ po_number: po.po_number, loyverse_id: id });
        }
      }
    }

    // Detail scraping
    const toScrape = [...new Map(needsScrape.map(po => [po.po_number, po])).values()];
    console.log(`\n[3/4] Scraping ${toScrape.length} order detail pages...`);

    let success = 0, failed = 0;
    for (const po of toScrape) {
      try {
        const items = await scrapeDetail(page, po.loyverse_id, po.po_number);
        await upsertOrder(po.po_number, po.loyverse_id, items);
        console.log(`  ✓ ${po.po_number} — ${items.length} items`);
        success++;
        await delay(1500);
      } catch (err) {
        console.error(`  ✗ ${po.po_number}: ${err}`);
        await supabase.from("purchase_orders")
          .update({ scrape_error: String(err) })
          .eq("po_number", po.po_number);
        failed++;
      }
    }

    console.log(`\n✓ Done. ${success} succeeded, ${failed} failed.\n`);

  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
