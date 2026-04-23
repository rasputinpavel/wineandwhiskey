import { NextResponse } from 'next/server'

const APIFY_TOKEN = process.env.APIFY_TOKEN!
const ACTOR_ID = 'mrbridge~vivino-wine-data-scraper'

export async function GET() {
  // Test with one well-known wine, try different input formats
  const inputs = [
    { wineNames: ['Chateau Margaux 2015'] },
    { queries: ['Chateau Margaux 2015'] },
    { query: 'Chateau Margaux 2015' },
    { searchTerms: ['Chateau Margaux 2015'] },
  ]

  const results: Record<string, unknown>[] = []

  for (const input of inputs) {
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?waitForFinish=120`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    )
    const run = await runRes.json()
    const datasetId = run?.data?.defaultDatasetId
    let items: unknown[] = []
    if (datasetId) {
      const dataRes = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true`,
        { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } }
      )
      items = await dataRes.json()
    }
    results.push({ input, status: run?.data?.status, datasetId, itemCount: Array.isArray(items) ? items.length : -1, firstItem: Array.isArray(items) ? items[0] : items })
    if (Array.isArray(items) && items.length > 0) break // found working format
  }

  return NextResponse.json(results)
}
