import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const APIFY_TOKEN = process.env.APIFY_TOKEN!
const ACTOR_ID = 'mrbridge~vivino-wine-data-scraper'

type VivinoResult = {
  name?: string
  vintage?: number | string
  rating?: { average?: number; reviews_count?: number }
  image?: { location?: string }
  url?: string
  // actor may return slightly different shapes
  wineRating?: number
  ratingsCount?: number
  imageUrl?: string
  wineUrl?: string
}

export async function POST(req: NextRequest) {
  const { price_list_id } = await req.json()
  if (!price_list_id) return NextResponse.json({ error: 'price_list_id required' }, { status: 400 })
  if (!APIFY_TOKEN) return NextResponse.json({ error: 'APIFY_TOKEN not configured' }, { status: 500 })

  // Fetch wine items for this price list that haven't been enriched yet
  const { data: items, error } = await supabase
    .from('wine_items')
    .select('id, name, year, country')
    .eq('price_list_id', price_list_id)
    .is('vivino_enriched_at', null)
    .not('name', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!items || items.length === 0) return NextResponse.json({ enriched: 0, message: 'Already up to date' })

  console.log(`[vivino] enriching ${items.length} items for price_list ${price_list_id}`)

  // Run enrichment in background — respond immediately
  enrichInBackground(items).catch(console.error)

  return NextResponse.json({ enriching: items.length, message: 'Enrichment started' })
}

async function enrichInBackground(items: { id: string; name: string; year: number | null; country: string | null }[]) {
  const BATCH = 50
  let enriched = 0

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH)
    const wineNames = batch.map(w => w.year ? `${w.name} ${w.year}` : w.name)

    try {
      // Run actor synchronously (wait up to 5 min for batch)
      const runRes = await fetch(
        `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?waitForFinish=300`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ wineNames, maxResultsPerSearch: 1, includeTasteProfile: false }),
        }
      )

      if (!runRes.ok) {
        console.error('[vivino] run failed:', await runRes.text())
        continue
      }

      const run = await runRes.json() as { data: { defaultDatasetId: string; status: string } }
      const datasetId = run.data?.defaultDatasetId
      if (!datasetId) { console.error('[vivino] no dataset'); continue }

      // Fetch results
      const dataRes = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true`,
        { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } }
      )
      const results: VivinoResult[] = await dataRes.json()
      console.log(`[vivino] batch ${i / BATCH + 1}: got ${results.length} results`)

      // Match results back to items by index (Apify returns in same order)
      for (let j = 0; j < batch.length; j++) {
        const r = results[j]
        if (!r) continue
        const data = {
          vivino_rating: r.rating?.average ?? (r.wineRating as number | undefined) ?? null,
          vivino_reviews_count: r.rating?.reviews_count ?? (r.ratingsCount as number | undefined) ?? null,
          vivino_url: r.url ?? r.wineUrl ?? null,
          vivino_image_url: r.image?.location ?? r.imageUrl ?? null,
          vivino_enriched_at: new Date().toISOString(),
        }
        await supabase.from('wine_items').update(data).eq('id', batch[j].id)
      }

      enriched += results.length
      console.log(`[vivino] enriched so far: ${enriched}`)
    } catch (err) {
      console.error('[vivino] batch error:', err)
    }
  }

  console.log(`[vivino] done. Total enriched: ${enriched}`)
}
