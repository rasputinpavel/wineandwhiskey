/**
 * export_creative.ts
 *
 * Renders a creative HTML file (proposal_mobile.html etc.) into three companion
 * files in the same directory:
 *   - <basename>_scroll.pdf      — single tall page, no page breaks (phone scroll)
 *   - <basename>_preview.png     — full-page screenshot
 *   - <basename>_standalone.html — all file:// resources inlined as data: URIs
 *                                  (portable, can be served from the portal)
 *
 * Usage:
 *   npx tsx 03_automation/export_creative.ts <path-to.html>
 */

import { chromium } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: export_creative.ts <path-to.html>");
    process.exit(1);
  }
  const absInput = path.resolve(input);
  if (!fs.existsSync(absInput)) {
    console.error(`not found: ${absInput}`);
    process.exit(1);
  }
  const dir = path.dirname(absInput);
  const base = path.basename(absInput, path.extname(absInput));
  const pdfOut = path.join(dir, `${base}_scroll.pdf`);
  const pngOut = path.join(dir, `${base}_preview.png`);
  const standaloneOut = path.join(dir, `${base}_standalone.html`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 480, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.emulateMedia({ media: "screen" }); // ignore @media print rules
  await page.goto(`file://${absInput}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500); // fonts / images settle

  const dims = await page.evaluate(() => {
    const article = document.querySelector("article") as HTMLElement | null;
    const el = article ?? document.documentElement;
    return { w: el.scrollWidth, h: el.scrollHeight };
  });
  const widthPx = 480;
  const heightPx = Math.ceil(dims.h);
  console.log(`measured: ${widthPx} × ${heightPx} px`);

  // Resize viewport to the full content height so screenshot + pdf both render
  // the entire document on a single page.
  await page.setViewportSize({ width: widthPx, height: heightPx });
  await page.waitForTimeout(300);

  // PNG screenshot — full page, JPEG-quality not relevant for PNG
  await page.screenshot({ path: pngOut, fullPage: true });
  console.log(`wrote ${pngOut}`);

  // PDF — pass explicit pixel dimensions in inches. 1in = 96px in CSS.
  const widthIn = widthPx / 96;
  const heightIn = heightPx / 96;
  await page.pdf({
    path: pdfOut,
    width: `${widthIn}in`,
    height: `${heightIn}in`,
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    preferCSSPageSize: false,
  });
  console.log(`wrote ${pdfOut}`);

  // ---- Standalone HTML with all file:// resources inlined ----
  const rawHtml = fs.readFileSync(absInput, "utf8");
  const fileUrlRe = /file:\/\/([^'")\s]+)/g;
  const seen = new Map<string, string>(); // path -> data URI
  const matches = Array.from(rawHtml.matchAll(fileUrlRe));
  for (const m of matches) {
    const p = m[1];
    if (seen.has(p)) continue;
    if (!fs.existsSync(p)) {
      console.warn(`skip missing: ${p}`);
      continue;
    }
    const buf = fs.readFileSync(p);
    const ext = path.extname(p).toLowerCase().slice(1);
    const mime: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      webp: "image/webp", svg: "image/svg+xml",
      woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf",
    };
    const m1 = mime[ext] ?? "application/octet-stream";
    seen.set(p, `data:${m1};base64,${buf.toString("base64")}`);
  }
  let standalone = rawHtml;
  for (const [p, dataUri] of seen) {
    // Replace every file:// occurrence of this path with the data URI.
    const fullUrl = `file://${p}`;
    standalone = standalone.split(fullUrl).join(dataUri);
  }
  fs.writeFileSync(standaloneOut, standalone);
  console.log(`wrote ${standaloneOut} (${seen.size} resources inlined)`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
