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
  await page.goto("https://r.loyverse.com/", { waitUntil: "domcontentloaded" });
  await delay(2000);

  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
  await emailInput.waitFor({ timeout: 15_000 });
  await emailInput.fill(LOYVERSE_EMAIL);

  await page.locator('input[type="password"]').first().fill(LOYVERSE_PASSWORD);
  await page.locator('button[type="submit"], input[type="submit"]').first().click();

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
      const orders: any[] = body.purchase_orders ?? body.orders ?? body.data ?? [];
      if (!Array.isArray(orders)) return;
      for (const o of orders) {
        const numId = o.id ?? o.loyverse_id ?? o.order_id;
        const poNum = o.order_number ?? o.po_number ?? o.number ?? o.name;
        if (numId && poNum && /^PO\d+$/i.test(String(poNum))) {
          idMap.set(String(poNum).toUpperCase(), Number(numId));
        }
      }
    } catch { /* non-JSON, skip */ }
  });

  await page.goto("https://r.loyverse.com/dashboard/#/inventory/orders", { waitUntil: "domcontentloaded" });

  let pageNum = 0;
  while (true) {
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    pageNum++;
    process.stdout.write(`  List page ${pageNum}: ${idMap.size} IDs captured...`);

    // DOM fallback: extract IDs from anchor href attributes
    const links = await page.locator('a[href*="orderdetail"]').all();
    for (const link of links) {
      const href = await link.getAttribute("href").catch(() => "");
      const idMatch = href?.match(/id=(\d+)/);
      if (!idMatch) continue;
      const numId = parseInt(idMatch[1]);
      // Walk up to find the PO number text in the row
      const rowText = await link.locator("../..").innerText().catch(
        () => link.locator("..").innerText().catch(() => "")
      );
      const poMatch = rowText.match(/PO\d+/i);
      if (poMatch) idMap.set(poMatch[0].toUpperCase(), numId);
    }

    process.stdout.write(` → ${idMap.size} total\n`);

    // Pagination
    const nextBtn = page.locator(
      '[aria-label="Next page"], [aria-label="next"], button:has-text("Next"), .pagination-next, [class*="next-page"]'
    ).first();
    const count = await nextBtn.count();
    if (!count) break;
    const disabled = await nextBtn.isDisabled().catch(() => true);
    if (disabled) break;

    await nextBtn.click();
    await delay(1500);
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

  // Wait for items table — try several selector patterns
  try {
    await page.waitForSelector(
      "table tbody tr, .order-item, [class*='item'][class*='row'], .po-line",
      { timeout: 20_000 }
    );
  } catch {
    if (DEBUG) await page.screenshot({ path: `debug-${poNumber}.png` });
    throw new Error("Items table not found — run with SCRAPER_HEADFUL=1 to inspect selectors");
  }

  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  if (DEBUG) await page.screenshot({ path: `debug-${poNumber}.png` });

  const rows = await page.locator("table tbody tr").all();
  if (!rows.length) throw new Error("No table rows found");

  const items: LineItem[] = [];
  for (const row of rows) {
    const cells = await row.locator("td").all();
    if (cells.length < 3) continue;

    const texts = await Promise.all(cells.map(c => c.innerText().catch(() => "")));
    const clean = texts.map(t => t.replace(/\s+/g, " ").trim());

    const name = clean[0];
    if (!name || name.length < 2) continue;

    // Column layout varies — use position heuristics based on cell count
    const wide = cells.length >= 6;
    items.push({
      product_name: name,
      sku:          wide ? (clean[1] || null) : null,
      qty_ordered:  parseNum(clean[wide ? 2 : 1]),
      qty_received: parseNum(clean[wide ? 3 : 2]),
      cost_price:   parseNum(clean[wide ? 4 : 3]),
      line_total:   parseNum(clean[wide ? 5 : 4]),
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
