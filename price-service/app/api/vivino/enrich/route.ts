import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const APIFY_TOKEN = process.env.APIFY_TOKEN!
const ACTOR_ID = 'mrbridge~vivino-wine-data-scraper'

type VivinoResult = {
  searchQuery?: string
  average_rating?: number
  ratings_count?: number
  image_url?: string | string[]
  vivino_url?: string
}

export async function POST(req: NextRequest) {
  const { price_list_id, force } = await req.json()
  if (!price_list_id) return NextResponse.json({ error: 'price_list_id required' }, { status: 400 })
  if (!APIFY_TOKEN) return NextResponse.json({ error: 'APIFY_TOKEN not configured' }, { status: 500 })

  // Reset enrichment status if force re-run requested
  if (force) {
    await supabase.from('wine_items').update({ vivino_enriched_at: null }).eq('price_list_id', price_list_id)
  }

  const { data: items, error } = await supabase
    .from('wine_items')
    .select('id, name')
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

async function runBatch(wineNames: string[]): Promise<VivinoResult[]> {
  const runRes = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?waitForFinish=300`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ wineNames, maxResultsPerSearch: 1, includeTasteProfile: false }),
    }
  )
  if (!runRes.ok) { console.error('[vivino] run failed:', await runRes.text()); return [] }

  const run = await runRes.json() as { data: { defaultDatasetId: string; status: string } }
  console.log(`[vivino] batch status: ${run.data?.status}`)
  if (run.data?.status === 'FAILED') return []

  const datasetId = run.data?.defaultDatasetId
  if (!datasetId) return []

  const dataRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true`,
    { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } }
  )
  return dataRes.json()
}

async function enrichInBackground(items: { id: string; name: string }[]) {
  const BATCH = 20
  const nameToId = new Map(items.map(w => [w.name, w.id]))
  let enriched = 0
  let notFound = 0

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH)
    const wineNames = batch.map(w => w.name)
    console.log(`[vivino] batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(items.length / BATCH)}: ${wineNames[0]}...`)

    try {
      const results = await runBatch(wineNames)

      // Match by searchQuery
      const matched = new Set<string>()
      for (const r of results) {
        if (!r.searchQuery) continue
        const id = nameToId.get(r.searchQuery)
        if (!id) continue
        matched.add(r.searchQuery)
        const rawImage = r.image_url
        await supabase.from('wine_items').update({
          vivino_rating: r.average_rating ?? null,
          vivino_reviews_count: r.ratings_count ?? null,
          vivino_url: r.vivino_url ?? null,
          vivino_image_url: Array.isArray(rawImage) ? rawImage[0] : (rawImage ?? null),
          vivino_enriched_at: new Date().toISOString(),
        }).eq('id', id)
        enriched++
      }

      // Mark unmatched as processed
      for (const name of wineNames) {
        if (!matched.has(name)) {
          const id = nameToId.get(name)
          if (id) await supabase.from('wine_items').update({ vivino_enriched_at: new Date().toISOString() }).eq('id', id)
          notFound++
        }
      }

      console.log(`[vivino] enriched: ${enriched}, not found: ${notFound}`)
    } catch (err) {
      console.error('[vivino] batch error:', err)
    }

    // Small pause between batches to avoid Apify throttling
    if (i + BATCH < items.length) await sleep(5000)
  }

  console.log(`[vivino] done. Enriched: ${enriched}, not found on Vivino: ${notFound}`)
}
