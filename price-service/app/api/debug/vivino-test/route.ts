import { NextResponse } from 'next/server'

const APIFY_TOKEN = process.env.APIFY_TOKEN!
const ACTOR_ID = 'mrbridge~vivino-wine-data-scraper'

export async function GET() {
  // Test batch of 2 known wines to verify batch mode works
  const input = { wineNames: ['Chateau Margaux 2015', 'Opus One 2018'], maxResultsPerSearch: 1 }

  const runRes = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?waitForFinish=180`,
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

  return NextResponse.json({ input, status: run?.data?.status, itemCount: Array.isArray(items) ? items.length : -1, names: Array.isArray(items) ? items.map((r: unknown) => (r as Record<string, unknown>).name) : [] })
}
