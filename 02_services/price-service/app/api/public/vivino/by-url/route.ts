import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { runVivinoActorByUrl, ApifyError } from '@/lib/vivino/apify'
import { toPublicShape } from '@/lib/vivino/match'
import type { VivinoResult } from '@/lib/vivino/types'

const STOREFRONT_API_KEY = process.env.STOREFRONT_API_KEY ?? ''

const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/[a-z0-9-]+\.lovable\.app$/i,
  /^https:\/\/[a-z0-9-]+\.lovableproject\.com$/i,
  /^http:\/\/localhost(:\d+)?$/i,
]
const EXTRA_ORIGINS = (process.env.STOREFRONT_ALLOWED_ORIGINS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && (ALLOWED_ORIGIN_PATTERNS.some(re => re.test(origin)) || EXTRA_ORIGINS.includes(origin))
      ? origin
      : null
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'x-api-key, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed
  return headers
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

const VIVINO_URL_RX = /^https?:\/\/(www\.)?vivino\.com\//i

// Long timeout — Apify actor for a direct URL run takes 30-90s typically.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req.headers.get('origin'))

  if (!STOREFRONT_API_KEY) {
    return NextResponse.json({ error: 'server not configured' }, { status: 503, headers })
  }
  const apiKey = req.headers.get('x-api-key') ?? ''
  if (apiKey !== STOREFRONT_API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers })
  }

  let body: { url?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400, headers })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url || !VIVINO_URL_RX.test(url)) {
    return NextResponse.json({ error: 'vivino url required' }, { status: 400, headers })
  }

  // Cache lookup — if we've fetched this URL before within 90 days, reuse it.
  // The vivino_cache table is keyed by query string; we use the URL as the key,
  // namespaced with `url:` to avoid collision with search-query keys.
  const cacheKey = `url:${url}`
  const { data: cached } = await supabase
    .from('vivino_cache')
    .select('found, raw, fetched_at')
    .eq('query', cacheKey)
    .gte('fetched_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
    .maybeSingle()

  if (cached) {
    if (!cached.found || !cached.raw) {
      return NextResponse.json({ match: null, reason: 'apify_no_data', cached: true }, { headers })
    }
    const raw = Array.isArray(cached.raw) ? (cached.raw as VivinoResult[])[0] : (cached.raw as VivinoResult)
    return NextResponse.json({ match: toPublicShape(raw), cached: true }, { headers })
  }

  // Live Apify run.
  let items: VivinoResult[]
  try {
    items = await runVivinoActorByUrl(url)
  } catch (err) {
    const msg = err instanceof ApifyError ? err.message : String(err)
    return NextResponse.json({ error: `apify failed: ${msg}` }, { status: 502, headers })
  }

  if (!items || items.length === 0) {
    // Don't cache negative results on the manual path — admins paste URLs
    // because they expect data. A transient Apify hiccup shouldn't lock in
    // a null answer for 90 days; let them retry.
    return NextResponse.json({ match: null, reason: 'apify_no_data' }, { headers })
  }

  const first = items[0]
  await supabase
    .from('vivino_cache')
    .upsert({ query: cacheKey, found: true, raw: items, fetched_at: new Date().toISOString() }, { onConflict: 'query' })

  return NextResponse.json({ match: toPublicShape(first) }, { headers })
}
