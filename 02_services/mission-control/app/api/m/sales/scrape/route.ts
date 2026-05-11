// POST /api/m/sales/scrape
// Body: ScrapeFormPayload. Splits districts × business_kind into N scrape_run
// rows, kicks off one Apify run per row, returns [{id, district}] for polling.
//
// Apify runs are started but not awaited — the UI polls each via
// /api/m/sales/scrape/[id] until status flips to 'succeeded', then triggers
// /import to materialize leads.

import { NextResponse } from 'next/server'
import { startPlacesRun, apifyConfigured } from '@/lib/sales/apify-places'
import { createScrapeRun, setRunStarted, setRunStatus } from '@/lib/sales/queries'
import {
  BUSINESS_KINDS, MIN_STARS_OPTIONS,
  PHUKET_DISTRICT_GEO, circleToPolygon,
  type District,
} from '@/lib/sales/config'
import type { ScrapeFormPayload, ScrapeInput } from '@/lib/sales/types'

export async function POST(req: Request) {
  if (!apifyConfigured()) {
    return NextResponse.json({ error: 'APIFY_TOKEN not configured' }, { status: 500 })
  }

  let body: ScrapeFormPayload
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  // Validation — keep loose, but enums must match DB and Apify constraints.
  if (!Array.isArray(body.districts) || body.districts.length === 0) {
    return NextResponse.json({ error: 'pick at least one district' }, { status: 400 })
  }
  if (!BUSINESS_KINDS.includes(body.business_kind)) {
    return NextResponse.json({ error: 'invalid business_kind' }, { status: 400 })
  }
  if (!Array.isArray(body.search_terms) || body.search_terms.length === 0) {
    return NextResponse.json({ error: 'search_terms required' }, { status: 400 })
  }
  if (body.min_stars && !(MIN_STARS_OPTIONS as readonly string[]).includes(body.min_stars)) {
    return NextResponse.json({ error: 'invalid min_stars' }, { status: 400 })
  }
  const maxPerSearch = Math.max(5, Math.min(200, body.max_per_search ?? 30))

  const created: Array<{ id: string; district: string }> = []
  for (const district of body.districts) {
    const input: ScrapeInput = {
      district,
      business_kind:   body.business_kind,
      search_terms:    body.search_terms,
      category_filter: body.category_filter ?? [],
      min_stars:       body.min_stars,
      min_reviews:     Math.max(0, body.min_reviews ?? 0),
      price_levels:    body.price_levels ?? [],
      max_per_search:  maxPerSearch,
    }

    let runRow
    try {
      runRow = await createScrapeRun(input)
    } catch (err) {
      return NextResponse.json({ error: `db insert failed: ${(err as Error).message}` }, { status: 500 })
    }

    const geo = PHUKET_DISTRICT_GEO[district as District]
    try {
      const { runId, datasetId } = await startPlacesRun({
        searchStringsArray:        input.search_terms,
        // Hand-coded polygon per Phuket district — bypasses Nominatim, which
        // misresolves short names. Falls back to locationQuery only if the
        // district isn't in our map (free-text override path).
        customGeolocation:         geo
          ? { type: 'Polygon', coordinates: circleToPolygon(geo.lat, geo.lng, geo.radiusKm) }
          : undefined,
        locationQuery:             geo ? undefined : `${district}, Phuket, Thailand`,
        categoryFilterWords:       input.category_filter.length ? input.category_filter : undefined,
        placeMinimumStars:         input.min_stars || undefined,
        maxCrawledPlacesPerSearch: maxPerSearch,
      })
      await setRunStarted(runRow.id, runId, datasetId)
      created.push({ id: runRow.id, district })
    } catch (err) {
      await setRunStatus(runRow.id, 'failed', (err as Error).message).catch(() => {})
      return NextResponse.json({
        error: `Apify start failed for ${district}: ${(err as Error).message}`,
        partial: created,
      }, { status: 502 })
    }
  }

  return NextResponse.json({ runs: created })
}
