const TOKEN = process.env.APIFY_TOKEN!
const BASE = 'https://api.apify.com/v2'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export type InstagramPost = {
  type: string
  shortCode: string
  url: string
  videoUrl: string | null
  displayUrl: string
  caption: string | null
  hashtags: string[]
  videoPlayCount: number | null
  likesCount: number | null
  commentsCount: number | null
  videoDuration: number | null
  timestamp: string
  ownerUsername: string
  ownerFullName: string | null
}

export type InstagramProfile = {
  username: string
  fullName: string | null
  followersCount: number
  postsCount: number
  isVerified: boolean
}

async function runActor(actorId: string, input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${BASE}/acts/${actorId}/runs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Apify run failed: ${await res.text()}`)
  const { data } = await res.json() as { data: { id: string; defaultDatasetId: string } }
  return data.defaultDatasetId
}

async function pollRun(runId: string, maxWaitMs = 300_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await sleep(10_000)
    const res = await fetch(`${BASE}/actor-runs/${runId}`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    const { data } = await res.json() as { data: { status: string } }
    if (data.status === 'SUCCEEDED') return
    if (data.status === 'FAILED' || data.status === 'ABORTED') throw new Error(`Apify run ${data.status}`)
  }
  throw new Error('Apify run timed out')
}

async function startActor(actorId: string, input: Record<string, unknown>): Promise<{ runId: string; datasetId: string }> {
  const res = await fetch(`${BASE}/acts/${actorId}/runs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Apify start failed: ${await res.text()}`)
  const { data } = await res.json() as { data: { id: string; defaultDatasetId: string } }
  return { runId: data.id, datasetId: data.defaultDatasetId }
}

async function getDataset<T>(datasetId: string): Promise<T[]> {
  const res = await fetch(`${BASE}/datasets/${datasetId}/items?clean=true`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!res.ok) throw new Error(`Dataset fetch failed: ${res.status}`)
  return res.json()
}

export async function scrapeAccountReels(username: string, maxPosts = 50): Promise<InstagramPost[]> {
  const { runId, datasetId } = await startActor('apify~instagram-scraper', {
    usernames: [username],
    resultsType: 'posts',
    resultsLimit: maxPosts,
    addParentData: false,
  })
  await pollRun(runId)
  const items = await getDataset<InstagramPost>(datasetId)
  return items.filter(p => p.type === 'Video')
}

export async function scrapeHashtagReels(hashtag: string, maxPosts = 60): Promise<InstagramPost[]> {
  const { runId, datasetId } = await startActor('apify~instagram-scraper', {
    directUrls:   [`https://www.instagram.com/explore/tags/${hashtag}/`],
    resultsType:  'reels',
    resultsLimit: maxPosts,
  })
  await pollRun(runId)
  const items = await getDataset<InstagramPost>(datasetId)
  return items.filter(p => p.videoPlayCount != null)
}

export async function scrapeProfile(username: string): Promise<InstagramProfile | null> {
  const { runId, datasetId } = await startActor('apify~instagram-profile-scraper', {
    usernames: [username],
  })
  await pollRun(runId, 60_000)
  const items = await getDataset<InstagramProfile>(datasetId)
  return items[0] ?? null
}

void runActor // suppress unused warning — used by startActor internally
