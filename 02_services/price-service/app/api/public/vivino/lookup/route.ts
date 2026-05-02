import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { normalizeForMatch } from '@/lib/vivino/normalize'

const STOREFRONT_API_KEY = process.env.STOREFRONT_API_KEY ?? ''

// Storefront origins — Lovable preview/prod and our future custom domain.
// Add the prod custom domain to ALLOWED_ORIGINS_EXTRA env when wired up.
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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

type Candidate = {
  id: string
  name: string
  winery: string | null
  year: number | null
  country: string | null
  grape_variety: string | null
  description: string | null
  wine_type: string | null
  vivino_rating: number | null
  vivino_reviews_count: number | null
  vivino_url: string | null
  vivino_image_url: string | null
  vivino_alcohol: number | null
  vivino_body: string | null
  vivino_year: number | null
  vivino_flavors: string[] | null
  vivino_food_pairings: string[] | null
  vivino_region_hierarchy: { country: string | null; region: string | null; subregion: string | null; appellation: string | null } | null
}

function tokens(s: string): Set<string> {
  return new Set(
    normalizeForMatch(s).split(' ').filter(t => t.length >= 3)
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let overlap = 0
  for (const t of a) if (b.has(t)) overlap++
  const union = new Set([...a, ...b]).size
  return overlap / union
}

const MIN_CONFIDENCE = 0.4

const SELECT_FIELDS = `
  id, name, winery, year, country, grape_variety, description, wine_type,
  vivino_rating, vivino_reviews_count, vivino_url, vivino_image_url,
  vivino_alcohol, vivino_body, vivino_year,
  vivino_flavors, vivino_food_pairings, vivino_region_hierarchy
`

async function fetchCandidates(tokens: string[], limit: number): Promise<{ data: Candidate[]; error: string | null }> {
  if (tokens.length === 0) return { data: [], error: null }
  const orFilter = tokens
    .map(t => `name.ilike.%${t.replace(/[%,]/g, '')}%`)
    .join(',')
  const { data, error } = await supabase
    .from('wine_items')
    .select(SELECT_FIELDS)
    .not('vivino_rating', 'is', null)
    .or(orFilter)
    .limit(limit)
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as Candidate[], error: null }
}

export async function GET(req: NextRequest) {
  const headers = corsHeaders(req.headers.get('origin'))

  if (!STOREFRONT_API_KEY) {
    return NextResponse.json({ error: 'server not configured' }, { status: 503, headers })
  }
  const apiKey = req.headers.get('x-api-key') ?? ''
  if (apiKey !== STOREFRONT_API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers })
  }

  const { searchParams } = req.nextUrl
  const name = (searchParams.get('name') ?? '').trim()
  const winery = (searchParams.get('winery') ?? '').trim()
  const yearRaw = searchParams.get('year')
  const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null

  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400, headers })
  }

  const inputTokens = tokens(`${winery} ${name}`)
  const allTokens = [...inputTokens]
  if (allTokens.length === 0) {
    return NextResponse.json({ match: null, reason: 'no_significant_tokens' }, { headers })
  }

  // Two-tier candidate fetch:
  //   1. OR-ILIKE on the first 5 tokens (cheap, hits the GIN(name) index).
  //   2. Fallback if 0 rows: OR-ILIKE on the 3 longest tokens (most distinctive).
  // Both passes scored client-side via Jaccard.
  const primary = allTokens.slice(0, 5)
  const r1 = await fetchCandidates(primary, 80)
  if (r1.error) {
    return NextResponse.json({ error: r1.error }, { status: 500, headers })
  }

  let candidates = r1.data
  let usedFallback = false
  if (candidates.length === 0) {
    const distinctive = [...allTokens]
      .sort((a, b) => b.length - a.length)
      .slice(0, 3)
    const r2 = await fetchCandidates(distinctive, 120)
    if (r2.error) {
      return NextResponse.json({ error: r2.error }, { status: 500, headers })
    }
    candidates = r2.data
    usedFallback = true
  }

  if (candidates.length === 0) {
    return NextResponse.json({ match: null, reason: 'no_candidates' }, { headers })
  }

  type Best = { row: Candidate; score: number }
  let best: Best | null = null
  for (const row of candidates) {
    const rowTokens = tokens(`${row.winery ?? ''} ${row.name}`)
    let score = jaccard(inputTokens, rowTokens)
    if (year && (row.vivino_year === year || row.year === year)) score += 0.05
    score = Math.min(1, score)
    const cur: Best = { row, score }
    if (best === null) best = cur
    else if (score > best.score) best = cur
    else if (score === best.score) {
      const a = row.vivino_reviews_count ?? 0
      const b = best.row.vivino_reviews_count ?? 0
      if (a > b) best = cur
    }
  }

  const topScore = best ? best.score : 0
  if (best === null || topScore < MIN_CONFIDENCE) {
    return NextResponse.json(
      { match: null, reason: 'low_confidence', topScore, usedFallback },
      { headers }
    )
  }

  const r = best.row
  return NextResponse.json(
    {
      match: {
        rating: r.vivino_rating,
        reviews_count: r.vivino_reviews_count,
        image_url: r.vivino_image_url,
        country: r.country ?? r.vivino_region_hierarchy?.country ?? null,
        grape: r.grape_variety,
        description: r.description,
        wine_type: r.wine_type,
        year: r.vivino_year ?? r.year,
        alcohol: r.vivino_alcohol,
        body: r.vivino_body,
        flavors: r.vivino_flavors,
        food_pairings: r.vivino_food_pairings,
        region: r.vivino_region_hierarchy?.region ?? null,
        vivino_url: r.vivino_url,
      },
      confidence: Math.round(best.score * 100) / 100,
      usedFallback,
    },
    { headers }
  )
}
