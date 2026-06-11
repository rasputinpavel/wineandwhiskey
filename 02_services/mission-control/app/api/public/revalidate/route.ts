import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { RECEIPTS_CACHE_TAG } from '@/lib/receipts-cache'

// On-demand cache bust for the shared receipt history. The GitHub Actions
// receipt sync (3×/day) POSTs here after writing fresh receipts so the portal
// reflects them immediately instead of waiting out the 10-minute revalidate.
//
// Lives under /api/public/ so middleware skips the cookie check (the runner has
// no session) — guarded instead by a bearer secret.

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secret = process.env.RECEIPTS_REVALIDATE_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'revalidate not configured' }, { status: 503 })
  }

  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.headers.get('x-revalidate-secret') ?? ''
  if (token !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  revalidateTag(RECEIPTS_CACHE_TAG)
  return NextResponse.json({ ok: true, revalidated: RECEIPTS_CACHE_TAG })
}
