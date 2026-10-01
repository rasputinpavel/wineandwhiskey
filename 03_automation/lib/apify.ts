/**
 * Apify helpers for the trend scripts. discover_trend_accounts.ts keeps its own
 * private copies — it is a working 500-line script with no tests, and rewiring
 * it is deliberately out of scope.
 */

const BASE = 'https://api.apify.com/v2'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export type ApifyRun = { runId: string; datasetId: string }

export async function runApify(
  token:   string,
  actorId: string,
  input:   Record<string, unknown>,
): Promise<ApifyRun> {
  const res = await fetch(`${BASE}/acts/${actorId}/runs`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Apify start failed: ${await res.text()}`)
  const { data } = await res.json() as { data: { id: string; defaultDatasetId: string } }
  return { runId: data.id, datasetId: data.defaultDatasetId }
}

export async function pollApify(token: string, runId: string, maxMs = 120_000): Promise<void> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    await sleep(5_000)
    const res = await fetch(`${BASE}/actor-runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const { data } = await res.json() as { data: { status: string } }
    if (data.status === 'SUCCEEDED') return
    if (data.status === 'FAILED' || data.status === 'ABORTED') {
      throw new Error(`Apify run ${data.status}`)
    }
  }
  throw new Error(`Apify run ${runId} timed out`)
}

export async function getDataset<T>(token: string, datasetId: string): Promise<T[]> {
  const res = await fetch(`${BASE}/datasets/${datasetId}/items?clean=true`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Apify dataset fetch failed: ${await res.text()}`)
  return await res.json() as T[]
}

export type ApifyProfile = {
  username:       string
  fullName:       string | null
  followersCount: number
}

export async function getProfile(token: string, username: string): Promise<ApifyProfile | null> {
  const { runId, datasetId } = await runApify(token, 'apify~instagram-profile-scraper', {
    usernames: [username],
  })
  await pollApify(token, runId, 60_000)
  const items = await getDataset<ApifyProfile>(token, datasetId)
  return items[0] ?? null
}
