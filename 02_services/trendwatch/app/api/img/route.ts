import { NextRequest, NextResponse } from 'next/server'

export const runtime     = 'nodejs'
export const dynamic     = 'force-dynamic'
export const maxDuration = 30

// Whitelist of upstream image hosts. Prevents SSRF — only Instagram/Facebook CDNs.
const ALLOWED_HOST_RE = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url')
  if (!raw) return NextResponse.json({ error: 'missing url' }, { status: 400 })

  let target: URL
  try { target = new URL(raw) } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 })
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOST_RE.test(target.hostname)) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 403 })
  }

  try {
    const upstream = await fetch(target.toString(), {
      // No Referer/cookies — same as referrerPolicy=no-referrer but enforced server-side.
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrendwatchProxy/1.0)' },
      cache: 'no-store',
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 })
    }
    const buf  = await upstream.arrayBuffer()
    const type = upstream.headers.get('content-type') ?? 'image/jpeg'
    return new NextResponse(buf, {
      headers: {
        'Content-Type':  type,
        // Browser-side caching — Instagram URLs are signed, but the bytes don't change
        // during the URL's lifetime, so caching for a day is safe.
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
