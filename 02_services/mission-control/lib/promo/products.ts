import { readdir } from 'node:fs/promises'
import path from 'node:path'

// List every product PNG that ships into public/brand/products/ via
// scripts/sync-brand-assets.mjs. Recurses one level so date-bucketed batches
// (16_may/, 17_may/, manual/) are surfaced flat.

export type ProductImage = {
  slug: string     // 'brunello-banfi' (filename without .png)
  src:  string     // '/brand/products/brunello-banfi.png' (or subdir-qualified)
  batch: string | null  // '16_may' if from a subfolder, else null
}

const ROOT = path.join(process.cwd(), 'public', 'brand', 'products')

export async function scanProductImages(): Promise<ProductImage[]> {
  const out: ProductImage[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(ROOT, { withFileTypes: true })
  } catch {
    return []
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
      const slug = entry.name.replace(/\.png$/i, '')
      out.push({ slug, src: `/brand/products/${entry.name}`, batch: null })
    } else if (entry.isDirectory()) {
      const sub = path.join(ROOT, entry.name)
      let inner: import('node:fs').Dirent[]
      try {
        inner = await readdir(sub, { withFileTypes: true })
      } catch { continue }
      for (const f of inner) {
        if (f.isFile() && f.name.toLowerCase().endsWith('.png')) {
          const slug = f.name.replace(/\.png$/i, '')
          out.push({
            slug,
            src: `/brand/products/${entry.name}/${f.name}`,
            batch: entry.name,
          })
        }
      }
    }
  }

  // Sort: standalone slugs A-Z, then batches (newer batches likely at the top
  // of the file system but we keep deterministic order).
  out.sort((a, b) => {
    if ((a.batch ?? '') !== (b.batch ?? '')) return (a.batch ?? '').localeCompare(b.batch ?? '')
    return a.slug.localeCompare(b.slug)
  })
  return out
}
