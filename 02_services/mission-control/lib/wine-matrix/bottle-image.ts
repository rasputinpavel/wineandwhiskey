import 'server-only'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { slugifyProductName } from '@/lib/reactivation/composite'

const PRODUCTS_ROOT = path.join(process.cwd(), 'public', 'brand', 'products')

let cache: Map<string, string> | null = null

async function buildMap(): Promise<Map<string, string>> {
  if (cache) return cache
  const map = new Map<string, string>()
  let entries
  try {
    entries = await readdir(PRODUCTS_ROOT, { withFileTypes: true })
  } catch {
    cache = map; return map
  }
  for (const e of entries) {
    if (e.isFile() && /\.png$/i.test(e.name)) {
      const slug = e.name.replace(/\.png$/i, '').toLowerCase()
      map.set(slug, `/brand/products/${e.name}`)
    } else if (e.isDirectory()) {
      let inner
      try { inner = await readdir(path.join(PRODUCTS_ROOT, e.name), { withFileTypes: true }) }
      catch { continue }
      for (const f of inner) {
        if (f.isFile() && /\.png$/i.test(f.name)) {
          const slug = f.name.replace(/\.png$/i, '').toLowerCase()
          if (!map.has(slug)) map.set(slug, `/brand/products/${e.name}/${f.name}`)
        }
      }
    }
  }
  cache = map
  return map
}

export async function resolveBottleUrl(name: string): Promise<string | null> {
  const slug = slugifyProductName(name)
  if (!slug) return null
  const map = await buildMap()
  if (map.has(slug)) return map.get(slug)!
  // Prefix fallback (truncate by 1–2 trailing tokens) — handles vintages stripped.
  const parts = slug.split('-')
  for (let i = parts.length; i >= Math.max(4, parts.length - 2); i--) {
    const prefix = parts.slice(0, i).join('-')
    if (prefix.length < 8) break
    const exact = map.get(prefix)
    if (exact) return exact
  }
  return null
}
