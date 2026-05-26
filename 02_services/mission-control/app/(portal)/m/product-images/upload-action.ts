'use server'

import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { revalidatePath } from 'next/cache'

// Upload writes to BOTH the canonical 04_brand/products/ (so the file survives
// the next `sync-brand-assets` run) and the served public/brand/products/ mirror
// (so the new image appears immediately without rebuilding). On Railway the
// canonical write hits the deploy container's working copy and is gone on next
// deploy — flag this in the UI; for prod images, commit + push.

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const MAX_BYTES = 8 * 1024 * 1024  // 8 MB per file

function sanitizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

export type UploadResult =
  | { ok: true; written: string[] }
  | { ok: false; error: string }

export async function uploadProductImage(formData: FormData): Promise<UploadResult> {
  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) return { ok: false, error: 'No files selected.' }

  const serviceRoot = process.cwd()
  const repoRoot = path.resolve(serviceRoot, '../..')
  const canonicalDir = path.join(repoRoot, '04_brand/products')
  const mirrorDir = path.join(serviceRoot, 'public/brand/products')

  await mkdir(canonicalDir, { recursive: true })
  await mkdir(mirrorDir, { recursive: true })

  const written: string[] = []
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      return { ok: false, error: `${file.name}: too large (max ${MAX_BYTES / 1024 / 1024} MB).` }
    }
    const ext = path.extname(file.name).toLowerCase()
    if (!ALLOWED_EXT.has(ext)) {
      return { ok: false, error: `${file.name}: unsupported extension (allowed: ${[...ALLOWED_EXT].join(', ')}).` }
    }
    const slug = sanitizeSlug(file.name.slice(0, file.name.length - ext.length))
    if (!slug) return { ok: false, error: `${file.name}: filename did not produce a usable slug.` }

    const filename = `${slug}${ext}`
    const buf = Buffer.from(await file.arrayBuffer())
    await writeFile(path.join(canonicalDir, filename), buf)
    await writeFile(path.join(mirrorDir, filename), buf)
    written.push(filename)
  }

  revalidatePath('/m/product-images')
  return { ok: true, written }
}

// Replace the file at an existing slug with a new file. The new file may have
// a different extension; we delete any prior file matching the slug across all
// allowed extensions so the slug ends up pointing at exactly one image.
export async function replaceProductImage(slug: string, formData: FormData): Promise<UploadResult> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'No file selected.' }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `${file.name}: too large (max ${MAX_BYTES / 1024 / 1024} MB).` }
  }
  const ext = path.extname(file.name).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) {
    return { ok: false, error: `${file.name}: unsupported extension (allowed: ${[...ALLOWED_EXT].join(', ')}).` }
  }
  const cleanSlug = sanitizeSlug(slug)
  if (!cleanSlug || cleanSlug !== slug) {
    return { ok: false, error: `Invalid slug "${slug}".` }
  }

  const serviceRoot = process.cwd()
  const repoRoot = path.resolve(serviceRoot, '../..')
  const canonicalDir = path.join(repoRoot, '04_brand/products')
  const mirrorDir = path.join(serviceRoot, 'public/brand/products')

  // Strip any prior file with this slug — across all allowed extensions —
  // so a png→jpg replacement doesn't leave a stale png lying around.
  for (const dir of [canonicalDir, mirrorDir]) {
    for (const e of ALLOWED_EXT) {
      try { await unlink(path.join(dir, `${cleanSlug}${e}`)) } catch {}
    }
  }

  const filename = `${cleanSlug}${ext}`
  const buf = Buffer.from(await file.arrayBuffer())
  await mkdir(canonicalDir, { recursive: true })
  await mkdir(mirrorDir, { recursive: true })
  await writeFile(path.join(canonicalDir, filename), buf)
  await writeFile(path.join(mirrorDir, filename), buf)

  revalidatePath('/m/product-images')
  return { ok: true, written: [filename] }
}
