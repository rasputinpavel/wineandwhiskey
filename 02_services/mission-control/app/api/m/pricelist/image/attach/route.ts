import { NextResponse } from 'next/server'
import { setSkuPhoto } from '@/lib/pricelist/photo'

export const dynamic = 'force-dynamic'

// POST JSON: { code, image_slug?, image_url? }. Persists a SKU's chosen photo
// — pick a library slug, set an uploaded url, or clear (null). Used when the
// user attaches an existing bottle shot or removes a photo.
export async function POST(req: Request) {
  try {
    const { code, image_slug, image_url } = await req.json() as
      { code?: string; image_slug?: string | null; image_url?: string | null }
    if (!code) return NextResponse.json({ error: 'no code' }, { status: 400 })
    const patch: { image_slug?: string | null; image_url?: string | null } = {}
    if (image_slug !== undefined) patch.image_slug = image_slug
    if (image_url !== undefined) patch.image_url = image_url
    await setSkuPhoto(code, patch)
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
