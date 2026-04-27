import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const dir = path.dirname(fileURLToPath(import.meta.url));

const formats = [
  {
    file:   "slides-stories.html",
    out:    "stories",
    width:  1080,
    height: 1920,
    // preview is 360×640 → scale 3×
    viewW:  1400,
    viewH:  640,
    scale:  3,
  },
  {
    file:   "slides-post.html",
    out:    "post",
    width:  1080,
    height: 1350,
    // preview is 360×450 → scale 3×
    viewW:  1400,
    viewH:  450,
    scale:  3,
  },
];

const browser = await puppeteer.launch();

for (const fmt of formats) {
  const outDir = path.join(dir, fmt.out);
  fs.mkdirSync(outDir, { recursive: true });

  const page = await browser.newPage();
  await page.setViewport({ width: fmt.viewW, height: fmt.viewH });
  await page.goto(`file://${dir}/${fmt.file}`, { waitUntil: "networkidle0" });

  const slides = await page.$$(".slide");
  console.log(`\n[${fmt.out}] ${slides.length} slides (${fmt.width}×${fmt.height})`);

  for (let i = 0; i < slides.length; i++) {
    const num = String(i + 1).padStart(2, "0");
    const out = path.join(outDir, `slide_${num}.png`);

    // Screenshot at preview size then scale via deviceScaleFactor isn't enough
    // — capture the element and let puppeteer scale via the viewport
    const box = await slides[i].boundingBox();
    const buf = await page.screenshot({
      clip: {
        x: box.x, y: box.y,
        width: box.width, height: box.height,
      },
    });

    // Write PNG — scaling to final resolution handled separately
    // For true 1080px output: re-render at device scale factor
    const scalePage = await browser.newPage();
    await scalePage.setViewport({
      width:             Math.round(fmt.viewW),
      height:            Math.round(fmt.viewH),
      deviceScaleFactor: fmt.scale,
    });
    await scalePage.goto(`file://${dir}/${fmt.file}`, { waitUntil: "networkidle0" });
    const scaleSlides = await scalePage.$$(".slide");
    await scaleSlides[i].screenshot({ path: out });
    await scalePage.close();

    console.log(`  ✓ ${fmt.out}/slide_${num}.png`);
  }

  await page.close();
}

await browser.close();
console.log("\nDone.");
