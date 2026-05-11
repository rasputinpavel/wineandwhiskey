// Thin wrapper around Apify's `compass/crawler-google-places` actor.
// Pattern mirrors lib/sales/types but matches the Vivino integration in
// price-service/lib/vivino/apify.ts — start run, poll until terminal status,
// fetch dataset items.
//
// Apify rate-limits per token but we run scrapes manually from the UI, so a
// simple long poll inside the API route is fine for now. If we move to bigger
// runs (>5 min wait), switch to a webhook or a returning-202 + client-polling
// pattern.

import type { ApifyPlaceItem } from './types'

const APIFY_TOKEN = process.env.APIFY_TOKEN
const ACTOR_ID = 'compass~crawler-google-places'
const BASE = 'https://api.apify.com/v2'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export class ApifyError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message)
  }
}

export function apifyConfigured(): boolean {
  return Boolean(APIFY_TOKEN)
}

export type PlacesInput = {
  searchStringsArray:        string[]
  locationQuery?:            string                  // single free-text location
  categoryFilterWords?:      string[]
  placeMinimumStars?:        string                  // '' | 'two' | 'four' | 'fourAndHalf' ...
  maxCrawledPlacesPerSearch?: number
  language?:                 string
  countryCode?:              string
  // Image/review extras — we explicitly disable to keep cost predictable.
  maxImages?:                number
  maxReviews?:               number
  scrapeReviewsPersonalData?: boolean
}

export type StartedRun = { runId: string; datasetId: string }

// Kick off a run. Returns immediately with the run id + dataset id; status
// lives on the `actor-runs/{id}` endpoint and on our scrape_run row.
export async function startPlacesRun(input: PlacesInput): Promise<StartedRun> {
  if (!APIFY_TOKEN) throw new ApifyError('APIFY_TOKEN not configured', false)

  const body: Record<string, unknown> = {
    searchStringsArray:        input.searchStringsArray,
    maxCrawledPlacesPerSearch: input.maxCrawledPlacesPerSearch ?? 50,
    language:                  input.language ?? 'en',
    countryCode:               input.countryCode ?? 'th',
    maxImages:  input.maxImages ?? 0,
    maxReviews: input.maxReviews ?? 0,
    scrapeReviewsPersonalData: input.scrapeReviewsPersonalData ?? false,
  }
  if (input.locationQuery)            body.locationQuery       = input.locationQuery
  if (input.categoryFilterWords?.length) body.categoryFilterWords = input.categoryFilterWords
  if (input.placeMinimumStars)        body.placeMinimumStars   = input.placeMinimumStars

  const res = await fetch(`${BASE}/acts/${ACTOR_ID}/runs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new ApifyError(`places run start failed: ${res.status} ${txt}`,
      res.status >= 500 || res.status === 429)
  }
  const json = await res.json() as { data?: { id?: string; defaultDatasetId?: string } }
  const runId     = json.data?.id
  const datasetId = json.data?.defaultDatasetId
  if (!runId || !datasetId) throw new ApifyError('no run id returned', true)
  return { runId, datasetId }
}

export type RunStatus = 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTED' | 'TIMING-OUT' | 'TIMED-OUT'

export async function getRunStatus(runId: string): Promise<{ status: RunStatus; stats?: { datasetItemCount?: number } }> {
  if (!APIFY_TOKEN) throw new ApifyError('APIFY_TOKEN not configured', false)
  const res = await fetch(`${BASE}/actor-runs/${runId}`, {
    headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
  })
  if (!res.ok) throw new ApifyError(`run status fetch ${res.status}`, true)
  const json = await res.json() as { data: { status: RunStatus; stats?: { datasetItemCount?: number } } }
  return { status: json.data.status, stats: json.data.stats }
}

export async function fetchDatasetItems(datasetId: string): Promise<ApifyPlaceItem[]> {
  if (!APIFY_TOKEN) throw new ApifyError('APIFY_TOKEN not configured', false)
  const res = await fetch(`${BASE}/datasets/${datasetId}/items?clean=true`, {
    headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
  })
  if (!res.ok) throw new ApifyError(`dataset fetch ${res.status}`, true)
  const items = await res.json()
  return Array.isArray(items) ? items as ApifyPlaceItem[] : []
}

// Convenience for terminal states.
export function isTerminal(status: RunStatus): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT'
}

export { sleep }
