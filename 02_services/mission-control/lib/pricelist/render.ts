import puppeteer, { type Browser } from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { buildHtml } from './template'
import { buildPages } from './layout'
import { qrDataUrl } from './qr'
import type { PriceListDoc } from './types'

const A4 = { width: 794, height: 1123 }

// ─── product image data URLs (mirrors lib/promo/render.ts) ───────────────
let cache: Map<string, string> | null = null
async function productMap(): Promise<Map<string, string>> {
  if (cache) return cache
  const root = path.join(process.cwd(), 'public', 'brand', 'products')
  const map = new Map<string, string>()
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith('.png')) map.set(e.name.replace(/\.png$/i, ''), path.join(root, e.name))
    else if (e.isDirectory()) {
      const inner = await readdir(path.join(root, e.name), { withFileTypes: true }).catch(() => [])
      for (const f of inner) if (f.isFile() && f.name.toLowerCase().endsWith('.png')) {
        const slug = f.name.replace(/\.png$/i, ''); if (!map.has(slug)) map.set(slug, path.join(root, e.name, f.name))
      }
    }
  }
  cache = map; return map
}
async function loadImages(slugs: string[]): Promise<Map<string, string>> {
  const paths = await productMap(); const out = new Map<string, string>()
  for (const slug of slugs) { const p = paths.get(slug); if (!p) continue; const buf = await readFile(p); out.set(slug, `data:image/png;base64,${buf.toString('base64')}`) }
  return out
}

async function launch(): Promise<Browser> {
  const local = process.env.PUPPETEER_EXECUTABLE_PATH
  if (local) return puppeteer.launch({ executablePath: local, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true })
}

export type RenderResult = { pngs: Buffer[]; pdf: Buffer }

export async function renderPricelist(doc: PriceListDoc): Promise<RenderResult> {
  const pages = buildPages(doc.items, doc.settings)
  const slugs = doc.items.map(i => i.imageSlug).filter(Boolean) as string[]
  const imageDataUrls = await loadImages(slugs)
  const qr = doc.settings.qrUrl ? await qrDataUrl(doc.settings.qrUrl) : undefined
  const html = buildHtml({ pages, settings: doc.settings, imageDataUrls, qrDataUrl: qr })

  const browser = await launch()
  const pngs: Buffer[] = []
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: A4.width, height: A4.height, deviceScaleFactor: 2 })
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    await page.evaluate(() => (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready)
    const sections = await page.$$('section.page')
    for (const s of sections) pngs.push(Buffer.from(await s.screenshot({ type: 'png' })))
    await page.close().catch(() => {})
  } finally {
    await browser.close().catch(() => {})
  }

  const pdfDoc = await PDFDocument.create()
  for (const png of pngs) {
    const img = await pdfDoc.embedPng(png)
    const p = pdfDoc.addPage([A4.width, A4.height])
    p.drawImage(img, { x: 0, y: 0, width: A4.width, height: A4.height })
  }
  const pdf = Buffer.from(await pdfDoc.save())
  return { pngs, pdf }
}
