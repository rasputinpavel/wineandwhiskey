import { NextResponse } from 'next/server'
import { removeBgAndUpload, setSkuPhoto } from '@/lib/pricelist/photo'
import { slugify } from '@/lib/pricelist/images'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BYTES = 12 * 1024 * 1024 // 12 MB — a screenshot, not a raw photo dump

// POST multipart: file (required), code + name (optional). Removes the
// background, uploads to Storage, persists to the SKU when a code is given.
export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof Blob)) return NextResponse.json({ error: 'no file' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: `file too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 })
    if (file.type && !file.type.startsWith('image/')) return NextResponse.json({ error: 'not an image' }, { status: 400 })

    const code = (form.get('code') as string) || ''
    const name = (form.get('name') as string) || 'bottle'
    const base = (code || slugify(name) || 'bottle').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'bottle'

    const buf = Buffer.from(await file.arrayBuffer())
    const url = await removeBgAndUpload(buf, file.type || 'image/png', base)
    if (code) await setSkuPhoto(code, { image_url: url })
    return NextResponse.json({ url })
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
