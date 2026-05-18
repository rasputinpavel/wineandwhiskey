// Promo Pulse — Phase 3 Puppeteer orchestrator.
//
// Launches a single headless Chromium, renders each format sequentially
// (parallel pages would race the 50MB Chromium binary out of memory on
// Railway's smaller dynos), screenshots PNG / prints PDF, returns Buffers.
// Uses @sparticuz/chromium so we don't ship a 280MB binary in the image.

import puppeteer, { type Browser } from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { FORMAT_SPECS, buildHtml, type FormatSpec, type PromoFormatKey } from './visuals'
import { generateAllBackgrounds, type BgAspect } from './nbp'
import type { PromoCampaign } from './types'

export type RenderedAsset = {
  key:    PromoFormatKey
  ext:    'png' | 'pdf'
  buffer: Buffer
}

// ─── Product image loader ──────────────────────────────────────────────────
// Resolves SKU slugs → data URLs by scanning public/brand/products/ and its
// one-level subdirs (16_may/, 17_may/, manual/). Cached at module scope so a
// repeat call within the same process reuses disk reads.

let productPathCache: Map<string, string> | null = null

async function buildProductPathMap(): Promise<Map<string, string>> {
  if (productPathCache) return productPathCache
  const { readdir } = await import('node:fs/promises')
  const root = path.join(process.cwd(), 'public', 'brand', 'products')
  const map = new Map<string, string>()
  const entries = await readdir(root, { withFileTypes: true })
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith('.png')) {
      map.set(e.name.replace(/\.png$/i, ''), path.join(root, e.name))
    } else if (e.isDirectory()) {
      const inner = await readdir(path.join(root, e.name), { withFileTypes: true })
      for (const f of inner) {
        if (f.isFile() && f.name.toLowerCase().endsWith('.png')) {
          // First occurrence wins — top-level slugs take precedence over batches.
          const slug = f.name.replace(/\.png$/i, '')
          if (!map.has(slug)) map.set(slug, path.join(root, e.name, f.name))
        }
      }
    }
  }
  productPathCache = map
  return map
}

async function loadProductDataUrls(slugs: string[]): Promise<Map<string, string>> {
  const paths = await buildProductPathMap()
  const out = new Map<string, string>()
  for (const slug of slugs) {
    const p = paths.get(slug)
    if (!p) continue
    const buf = await readFile(p)
    out.set(slug, `data:image/png;base64,${buf.toString('base64')}`)
  }
  return out
}

// ─── Browser launcher ──────────────────────────────────────────────────────
async function launchBrowser(): Promise<Browser> {
  // On Mac/Linux dev with a system Chrome, set PUPPETEER_EXECUTABLE_PATH and
  // skip the sparticuz binary — it's Linux-only.
  const localExec = process.env.PUPPETEER_EXECUTABLE_PATH
  if (localExec) {
    return puppeteer.launch({
      executablePath: localExec,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
  }
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  })
}

// ─── Main entry ────────────────────────────────────────────────────────────
export async function renderPromoVisuals(c: PromoCampaign): Promise<RenderedAsset[]> {
  // Step 1: AI backgrounds (one per aspect family). Parallel ~5-10s each.
  // Step 2: Puppeteer composites each format on top of the right background.
  const [productDataUrls, backgrounds] = await Promise.all([
    loadProductDataUrls(c.sku_slugs),
    generateAllBackgrounds(c),
  ])

  const browser = await launchBrowser()
  const assets: RenderedAsset[] = []

  try {
    for (const format of FORMAT_SPECS) {
      const backgroundDataUrl = backgrounds[format.axis as BgAspect]
      const html = buildHtml({ campaign: c, format, productDataUrls, backgroundDataUrl })
      const buffer = await renderOne(browser, format, html)
      assets.push({ key: format.key, ext: format.ext, buffer })
    }
  } finally {
    await browser.close().catch(() => {})
  }
  return assets
}

async function renderOne(browser: Browser, format: FormatSpec, html: string): Promise<Buffer> {
  const page = await browser.newPage()
  try {
    await page.setViewport({ width: format.width, height: format.height, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'load', timeout: 20_000 })
    // Wait for Google Fonts to finish loading so headlines render in Bebas Neue.
    // document.fonts.ready resolves once all @font-face declarations are usable.
    await page.evaluate(() => (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready)

    if (format.ext === 'pdf') {
      const pdf = await page.pdf({
        width:  format.width  + 'px',
        height: format.height + 'px',
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      })
      return Buffer.from(pdf)
    }
    const png = await page.screenshot({ type: 'png', omitBackground: false })
    return Buffer.from(png)
  } finally {
    await page.close().catch(() => {})
  }
}
