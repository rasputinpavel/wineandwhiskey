import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const APIFY_TOKEN = process.env.APIFY_TOKEN!
const ACTOR_ID = 'mrbridge~vivino-wine-data-scraper'

type VivinoGrape = string | { name: string }

type VivinoResult = {
  searchQuery?: string
  average_rating?: number
  ratings_count?: number
  image_url?: string | string[]
  vivino_url?: string
  grapes?: VivinoGrape[]
  winery?: string | { name: string }
  wine_type_id?: number
  type?: string
}

const VIVINO_WINE_TYPES: Record<number, 'red' | 'white' | 'sparkling' | 'rose'> = {
  1: 'red',
  2: 'white',
  3: 'sparkling',
  4: 'rose',
}

function parseWineType(r: VivinoResult): 'red' | 'white' | 'rose' | 'sparkling' | null {
  if (r.wine_type_id && VIVINO_WINE_TYPES[r.wine_type_id]) return VIVINO_WINE_TYPES[r.wine_type_id]
  const t = (r.type ?? '').toLowerCase()
  if (t.includes('red')) return 'red'
  if (t.includes('white')) return 'white'
  if (t.includes('ros')) return 'rose'
  if (t.includes('spark') || t.includes('champagne') || t.includes('prosecco')) return 'sparkling'
  return null
}

function parseGrapes(grapes?: VivinoGrape[]): string | null {
  if (!grapes || grapes.length === 0) return null
  return grapes.map(g => (typeof g === 'string' ? g : g.name)).filter(Boolean).join(', ')
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
    .select('id, name, grape_variety, winery, wine_type')
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
  // Submit without waitForFinish, then poll
  const runRes = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/runs`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ wineNames, maxResultsPerSearch: 1, includeTasteProfile: false }),
    }
  )
  if (!runRes.ok) { console.error('[vivino] run failed:', await runRes.text()); return [] }

  const run = await runRes.json() as { data: { id: string; defaultDatasetId: string; status: string } }
  const runId = run.data?.id
  const datasetId = run.data?.defaultDatasetId
  if (!runId || !datasetId) return []

  // Poll until done (max 10 min)
  for (let i = 0; i < 20; i++) {
    await sleep(30_000)
    const s = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } })
    const { data } = await s.json() as { data: { status: string } }
    if (data.status === 'SUCCEEDED') break
    if (data.status === 'FAILED' || data.status === 'ABORTED') { console.error(`[vivino] run ${runId} ${data.status}`); return [] }
  }

  const dataRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true`,
    { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } }
  )
  return dataRes.json()
}

async function enrichInBackground(items: { id: string; name: string; grape_variety: string | null; winery: string | null; wine_type: string | null }[]) {
  const BATCH = 20
  const nameToItem = new Map(items.map(w => [w.name, w]))
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
        const item = nameToItem.get(r.searchQuery)
        if (!item) continue
        matched.add(r.searchQuery)
        const rawImage = r.image_url
        const grapes = parseGrapes(r.grapes)
        const winery = r.winery ? (typeof r.winery === 'string' ? r.winery : r.winery.name) : null
        const vivinoWineType = parseWineType(r)
        const update: Record<string, unknown> = {
          vivino_rating: r.average_rating ?? null,
          vivino_reviews_count: r.ratings_count ?? null,
          vivino_url: r.vivino_url ?? null,
          vivino_image_url: Array.isArray(rawImage) ? rawImage[0] : (rawImage ?? null),
          vivino_enriched_at: new Date().toISOString(),
          category: 'wine',
        }
        if (grapes && !item.grape_variety) update.grape_variety = grapes
        if (winery && !item.winery) update.winery = winery
        if (vivinoWineType && !item.wine_type) update.wine_type = vivinoWineType
        await supabase.from('wine_items').update(update).eq('id', item.id)
        enriched++
      }

      // Mark unmatched as processed
      for (const name of wineNames) {
        if (!matched.has(name)) {
          const item = nameToItem.get(name)
          if (item) await supabase.from('wine_items').update({ vivino_enriched_at: new Date().toISOString() }).eq('id', item.id)
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
