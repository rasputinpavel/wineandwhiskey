// Server-side composite: drop a customer's favourite bottle into the empty
// spotlight on the seasonal reactivation banner.
//
// The product PNGs live in public/brand/products/ (mirrored from
// 04_brand/products/ at predev/prebuild). They are background-removed via
// 03_automation/lift_subject.py and named by slugified product name —
// e.g. "Catena Malbec" → catena-malbec.png. We try to resolve the
// customer's top in-stock product to one of these files; if it isn't on
// disk we just return the base banner (the spotlight stays empty).
//
// Coordinates are tuned to the current rainy-season banner (1024×1024).
// If the base banner is regenerated with a different composition, retune
// BOTTLE_PLACEMENT below.

import sharp from 'sharp'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const BANNER_PATH = path.join(
  process.cwd(),
  'public', 'creative', 'reactivation-rainy-season_2026-05.png',
)
const PRODUCTS_ROOT = path.join(process.cwd(), 'public', 'brand', 'products')

// Tuned visually for the rainy-season banner. Bottle bottom rests just
// inside the warm spotlight pool, slightly right of centre — keeps the
// wine glass visible on the left and minimises overlap with the bottom
// "with love from Wine & Whiskey" line.
const BOTTLE_PLACEMENT = {
  bottomY: 900,   // y of bottle base on the 1024-tall banner
  centerX: 720,   // x of bottle vertical axis
  height:  520,   // resized bottle height; width is derived from aspect
} as const

// ─── Slugify (matches the existing 04_brand/products filename convention) ──
//
// "Catena Zapata Malbec Argentino Red'21" → "catena-zapata-malbec-argentino-red-21"
// "Marcello Del Majno Prosecco Brut, 0.75" → "marcello-del-majno-prosecco-brut-0-75"
export function slugifyProductName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')          // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')              // any non-alphanumeric → dash
    .replace(/^-+|-+$/g, '')                  // trim
}

// ─── Product PNG path resolver ─────────────────────────────────────────────
// Scans public/brand/products/ recursively one level deep (top-level + dated
// batch subdirs like 17_may/, manual/), caches the slug→path Map at module
// scope. First occurrence wins so top-level files override batches.

let pathCache: Map<string, string> | null = null

async function buildPathMap(): Promise<Map<string, string>> {
  if (pathCache) return pathCache
  const map = new Map<string, string>()
  let entries
  try {
    entries = await readdir(PRODUCTS_ROOT, { withFileTypes: true })
  } catch {
    pathCache = map
    return map
  }
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith('.png')) {
      map.set(e.name.replace(/\.png$/i, '').toLowerCase(), path.join(PRODUCTS_ROOT, e.name))
    } else if (e.isDirectory()) {
      const inner = await readdir(path.join(PRODUCTS_ROOT, e.name), { withFileTypes: true })
      for (const f of inner) {
        if (f.isFile() && f.name.toLowerCase().endsWith('.png')) {
          const slug = f.name.replace(/\.png$/i, '').toLowerCase()
          if (!map.has(slug)) map.set(slug, path.join(PRODUCTS_ROOT, e.name, f.name))
        }
      }
    }
  }
  pathCache = map
  return map
}

export async function findBottlePngForProductName(productName: string): Promise<string | null> {
  const slug = slugifyProductName(productName)
  if (!slug) return null
  const map = await buildPathMap()
  // 1) exact slug match
  if (map.has(slug)) return map.get(slug)!
  // 2) prefix match — handles "Vaso Cabernet Sauvignon 2019" → "vaso-cabernet-sauvignon" file
  //    Only use prefix if it disambiguates to a single candidate to avoid wrong matches.
  const prefix = slug.split('-').slice(0, Math.min(4, slug.split('-').length)).join('-')
  if (prefix.length < 6) return null  // too short, would over-match
  const hits: string[] = []
  for (const k of map.keys()) {
    if (k === prefix || k.startsWith(prefix + '-')) hits.push(k)
  }
  if (hits.length === 1) return map.get(hits[0])!
  return null
}

// ─── Composite ────────────────────────────────────────────────────────────

let bannerBufferCache: Buffer | null = null
async function loadBaseBanner(): Promise<Buffer> {
  if (bannerBufferCache) return bannerBufferCache
  bannerBufferCache = await readFile(BANNER_PATH)
  return bannerBufferCache
}

/** Compose the banner with `bottlePngPath` standing in the spotlight.
 *  Returns a PNG buffer ready to send as the API response. */
export async function compositeBannerWithBottle(bottlePngPath: string): Promise<Buffer> {
  const baseBuf = await loadBaseBanner()

  // Resize the bottle while keeping aspect ratio.
  const bottle = await sharp(bottlePngPath)
    .resize({ height: BOTTLE_PLACEMENT.height, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer({ resolveWithObject: true })

  const bottleW = bottle.info.width
  const bottleH = bottle.info.height
  const top  = BOTTLE_PLACEMENT.bottomY - bottleH
  const left = Math.round(BOTTLE_PLACEMENT.centerX - bottleW / 2)

  return sharp(baseBuf)
    .composite([{ input: bottle.data, top, left }])
    .png()
    .toBuffer()
}

/** Pass-through helper for the case where no bottle PNG could be resolved.
 *  Lets the API route uniformly return a PNG buffer. */
export async function readBaseBanner(): Promise<Buffer> {
  return loadBaseBanner()
}
