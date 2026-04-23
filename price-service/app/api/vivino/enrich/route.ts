import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const APIFY_TOKEN = process.env.APIFY_TOKEN!
const ACTOR_ID = 'mrbridge~vivino-wine-data-scraper'

type VivinoResult = {
  name?: string
  searchQuery?: string
  average_rating?: number
  ratings_count?: number
  image_url?: string | string[]
  vivino_url?: string
}

export async function POST(req: NextRequest) {
  const { price_list_id } = await req.json()
  if (!price_list_id) return NextResponse.json({ error: 'price_list_id required' }, { status: 400 })
  if (!APIFY_TOKEN) return NextResponse.json({ error: 'APIFY_TOKEN not configured' }, { status: 500 })

  const { data: items, error } = await supabase
    .from('wine_items')
    .select('id, name, year, country')
    .eq('price_list_id', price_list_id)
    .is('vivino_enriched_at', null)
    .not('name', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!items || items.length === 0) return NextResponse.json({ enriched: 0, message: 'Already up to date' })

  console.log(`[vivino] enriching ${items.length} items for price_list ${price_list_id}`)

  enrichInBackground(items).catch(console.error)

  return NextResponse.json({ enriching: items.length, message: 'Enrichment started' })
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function enrichInBackground(items: { id: string; name: string; year: number | null; country: string | null }[]) {
  // Build name→id map for matching results back
  const nameToId = new Map<string, string>()
  const wineNames: string[] = []
  for (const w of items) {
    if (!w.name) continue
    nameToId.set(w.name, w.id)
    wineNames.push(w.name)
  }

  console.log(`[vivino] submitting ${wineNames.length} wines in one run`)

  // Submit single run without waitForFinish — poll manually
  const runRes = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/runs`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ wineNames, maxResultsPerSearch: 1, includeTasteProfile: false }),
    }
  )

  if (!runRes.ok) {
    console.error('[vivino] failed to start run:', await runRes.text())
    return
  }

  const run = await runRes.json() as { data: { id: string; defaultDatasetId: string; status: string } }
  const runId = run.data?.id
  const datasetId = run.data?.defaultDatasetId
  console.log(`[vivino] run started: ${runId}, status: ${run.data?.status}`)

  // Poll until SUCCEEDED or FAILED (max 60 min)
  const MAX_POLLS = 120
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    await sleep(30_000)
    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}`,
      { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } }
    )
    const statusData = await statusRes.json() as { data: { status: string } }
    const status = statusData.data?.status
    console.log(`[vivino] poll ${poll + 1}: ${status}`)
    if (status === 'SUCCEEDED' || status === 'FAILED') break
  }

  // Fetch all results
  const dataRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&limit=10000`,
    { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } }
  )
  const results: VivinoResult[] = await dataRes.json()
  console.log(`[vivino] got ${results.length} results`)

  // Match by searchQuery → wine id
  let enriched = 0
  for (const r of results) {
    const id = r.searchQuery ? nameToId.get(r.searchQuery) : undefined
    if (!id) continue
    const rawImage = r.image_url
    const imageUrl = Array.isArray(rawImage) ? rawImage[0] : (rawImage ?? null)
    await supabase.from('wine_items').update({
      vivino_rating: r.average_rating ?? null,
      vivino_reviews_count: r.ratings_count ?? null,
      vivino_url: r.vivino_url ?? null,
      vivino_image_url: imageUrl,
      vivino_enriched_at: new Date().toISOString(),
    }).eq('id', id)
    enriched++
  }

  // Mark unmatched items as processed so they don't block future runs
  const matchedNames = new Set(results.map(r => r.searchQuery).filter(Boolean))
  const unmatched = wineNames.filter(n => !matchedNames.has(n))
  if (unmatched.length > 0) {
    console.log(`[vivino] ${unmatched.length} wines not found on Vivino, marking as processed`)
    for (const name of unmatched) {
      const id = nameToId.get(name)
      if (id) await supabase.from('wine_items').update({ vivino_enriched_at: new Date().toISOString() }).eq('id', id)
    }
  }

  console.log(`[vivino] done. Enriched: ${enriched}, not found: ${unmatched.length}`)
}
