import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";
import * as fs from "node:fs";

const AUTH_STATE_PATH = ".loyverse-session.json";
function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = fs.existsSync(AUTH_STATE_PATH)
    ? await browser.newContext({ storageState: AUTH_STATE_PATH })
    : await browser.newContext();
  const page = await context.newPage();

  // Intercept ALL XHR before navigating
  const captured: string[] = [];
  let detailBody: any = null;
  page.on("response", async response => {
    const url = response.url();
    if (!url.includes("loyverse.com")) return;
    if (response.status() !== 200) return;
    const ct = response.headers()["content-type"] ?? "";
    if (!ct.includes("json")) return;
    try {
      const body = await response.json();
      const keys = Object.keys(body).join(", ");
      const snippet = JSON.stringify(body).slice(0, 200);
      captured.push(`URL: ${url.slice(0, 100)}\n  keys: ${keys}\n  data: ${snippet}`);
      if (url.includes("getPurchaseOrderDetail")) detailBody = body;
    } catch {}
  });

  // Navigate to PO list
  await page.goto("https://r.loyverse.com/dashboard/#/inventory/purchase?page=0&limit=50", { waitUntil: "networkidle" });
  await delay(4000);

  console.log(`\n=== XHR responses on list load (${captured.length}) ===`);
  for (const c of captured.slice(0, 5)) console.log(c, "\n");

  // Click first PO row and see what URL we land on
  captured.length = 0;
  const firstRow = page.locator("tr.tableBodyBody.list").first();
  const poText = await firstRow.locator("td.item").first().innerText().catch(() => "?");
  console.log(`\nClicking first row: "${poText.trim()}"`);

  await firstRow.click();
  await delay(3000);

  const urlAfterClick = page.url();
  console.log("URL after click:", urlAfterClick);

  // Print full getPurchaseOrderDetail response
  if (detailBody) {
    console.log("\n=== orderData ===");
    console.log(JSON.stringify(detailBody.orderData, null, 2));
    console.log("\n=== items[0] (first item) ===");
    console.log(JSON.stringify(detailBody.items?.[0], null, 2));
    console.log("\n=== items count:", detailBody.items?.length);
    console.log("=== landedCosts:", JSON.stringify(detailBody.landedCosts));
  }

  // Navigate back to list and check second PO
  await page.goBack();
  await delay(2000);
  console.log("\nURL after goBack:", page.url());

  // Try navigating to the list page explicitly
  await page.evaluate(() => { window.location.hash = "/inventory/purchase?page=0&limit=50"; });
  await delay(2000);
  console.log("URL after hash nav:", page.url());

  // Check rows are still there
  const rowsAfter = await page.locator("tr.tableBodyBody.list").count();
  console.log("Rows after navigation:", rowsAfter);

  await browser.close();
}

main().catch(console.error);
