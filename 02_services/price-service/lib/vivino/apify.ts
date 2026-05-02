import type { VivinoResult } from './types'

const APIFY_TOKEN = process.env.APIFY_TOKEN
const ACTOR_ID = 'mrbridge~vivino-wine-data-scraper'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export class ApifyError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message)
  }
}

export function apifyConfigured(): boolean {
  return Boolean(APIFY_TOKEN)
}

// Run the Vivino actor for a batch of queries.
// Throws ApifyError on transport / actor failure (caller decides retry).
// Successful run with zero hits returns []; that is NOT an error.
export async function runVivinoActor(wineNames: string[]): Promise<VivinoResult[]> {
  if (!APIFY_TOKEN) throw new ApifyError('APIFY_TOKEN not configured', false)
  if (wineNames.length === 0) return []

  const runRes = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/runs`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
      // 5 candidates per query — Vivino's search ranks by brand popularity,
      // so the top hit is often a different product from the same winery
      // (e.g. "Eisele Vineyard Grappa" instead of "Altagracia Cabernet").
      // We pick the best candidate locally via match.ts:pickBestMatch.
      body: JSON.stringify({ wineNames, maxResultsPerSearch: 5, includeTasteProfile: true }),
    }
  )
  if (!runRes.ok) {
    const body = await runRes.text().catch(() => '')
    throw new ApifyError(`actor start failed: ${runRes.status} ${body}`, runRes.status >= 500 || runRes.status === 429)
  }

  const run = await runRes.json() as { data?: { id?: string; defaultDatasetId?: string } }
  const runId = run.data?.id
  const datasetId = run.data?.defaultDatasetId
  if (!runId || !datasetId) throw new ApifyError('no run id returned', true)

  // Poll up to ~10 min, every 30s.
  const POLL_MS = 30_000
  const POLL_LIMIT = 20
  for (let i = 0; i < POLL_LIMIT; i++) {
    await sleep(POLL_MS)
    const s = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } })
    if (!s.ok) continue
    const { data } = await s.json() as { data: { status: string } }
    if (data.status === 'SUCCEEDED') break
    if (data.status === 'FAILED' || data.status === 'ABORTED' || data.status === 'TIMED-OUT') {
      throw new ApifyError(`actor run ${runId} ${data.status}`, true)
    }
  }

  const dataRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true`,
    { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } }
  )
  if (!dataRes.ok) throw new ApifyError(`dataset fetch failed: ${dataRes.status}`, true)
  const items = await dataRes.json()
  return Array.isArray(items) ? items as VivinoResult[] : []
}

// Run the Vivino actor against direct wine URLs (manual override path).
// Same actor, but we feed `startUrls` instead of `wineNames` so we get the
// exact wine the user picked rather than search-ranked results.
export async function runVivinoActorByUrl(url: string): Promise<VivinoResult[]> {
  if (!APIFY_TOKEN) throw new ApifyError('APIFY_TOKEN not configured', false)

  const runRes = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/runs`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
      // Actor input schema (mrbridge~vivino-wine-data-scraper v0.2.119) takes
      // `wineUrls` as a plain string array — not Apify's generic `startUrls`
      // shape. Verified against /v2/acts/.../builds/<latest> inputSchema.
      body: JSON.stringify({ wineUrls: [url], includeTasteProfile: true }),
    }
  )
  if (!runRes.ok) {
    const body = await runRes.text().catch(() => '')
    throw new ApifyError(`actor start failed: ${runRes.status} ${body}`, runRes.status >= 500 || runRes.status === 429)
  }

  const run = await runRes.json() as { data?: { id?: string; defaultDatasetId?: string } }
  const runId = run.data?.id
  const datasetId = run.data?.defaultDatasetId
  if (!runId || !datasetId) throw new ApifyError('no run id returned', true)

  const POLL_MS = 15_000
  const POLL_LIMIT = 20  // ~5 min — direct URL scrape should be fast
  for (let i = 0; i < POLL_LIMIT; i++) {
    await sleep(POLL_MS)
    const s = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } })
    if (!s.ok) continue
    const { data } = await s.json() as { data: { status: string } }
    if (data.status === 'SUCCEEDED') break
    if (data.status === 'FAILED' || data.status === 'ABORTED' || data.status === 'TIMED-OUT') {
      throw new ApifyError(`actor run ${runId} ${data.status}`, true)
    }
  }

  const dataRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true`,
    { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } }
  )
  if (!dataRes.ok) throw new ApifyError(`dataset fetch failed: ${dataRes.status}`, true)
  const items = await dataRes.json()
  return Array.isArray(items) ? items as VivinoResult[] : []
}

// Try a batch with bounded retries on retryable errors.
export async function runVivinoActorWithRetry(wineNames: string[], maxAttempts = 3): Promise<VivinoResult[]> {
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runVivinoActor(wineNames)
    } catch (err) {
      lastErr = err as Error
      const retryable = err instanceof ApifyError ? err.retryable : true
      if (!retryable || attempt === maxAttempts) throw err
      const backoff = Math.min(60_000, 5_000 * 2 ** (attempt - 1))
      console.warn(`[vivino:apify] attempt ${attempt} failed (${(err as Error).message}); retrying in ${backoff}ms`)
      await sleep(backoff)
    }
  }
  throw lastErr ?? new ApifyError('exhausted retries', false)
}
