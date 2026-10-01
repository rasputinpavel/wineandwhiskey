/**
 * Pure decision logic for the trend digest. No network, no database — so it can
 * be unit-tested and so sync_trends.ts holds nothing but I/O.
 */

/** A reel must beat its own account by this factor. */
export const VIEWS_MULTIPLE = 5

/** ...and still clear this absolute floor, so a 300-follower account at 10x is not a "hit". */
export const VIEWS_FLOOR = 50_000

export function multiple(views: number, followers: number | null | undefined): number {
  if (!followers || followers <= 0) return 0
  if (!Number.isFinite(views) || views <= 0) return 0
  return views / followers
}

export function isHit(views: number, followers: number | null | undefined): boolean {
  return views >= VIEWS_FLOOR && multiple(views, followers) >= VIEWS_MULTIPLE
}

/** A stored hit is only worth a Telegram message if it is this new. */
export const NOTIFY_MAX_AGE_DAYS = 14

const MS_PER_DAY = 86_400_000

export function isFreshForDigest(
  publishedAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!publishedAt) return false
  const published = publishedAt instanceof Date ? publishedAt : new Date(publishedAt)
  if (Number.isNaN(published.getTime())) return false
  const ageDays = (now.getTime() - published.getTime()) / MS_PER_DAY
  return ageDays <= NOTIFY_MAX_AGE_DAYS
}

/** Reels sent as photo messages; the rest become one text list. */
export const DIGEST_PHOTO_COUNT = 5

/** Hard cap on reels mentioned in one digest, so the chat stays readable. */
export const DIGEST_MAX_NOTIFIED = 10

export type DigestReel = {
  username:     string
  views:        number
  followers:    number | null
  url:          string
  publishedAt:  string | null
  durationS:    number | null
  caption:      string | null
  thumbnailUrl: string | null
}

export type DigestSelection = {
  photos:  DigestReel[]
  listed:  DigestReel[]
  omitted: number
}

export function pickDigestReels(reels: DigestReel[]): DigestSelection {
  const sorted = [...reels].sort(
    (a, b) => multiple(b.views, b.followers) - multiple(a.views, a.followers),
  )
  return {
    photos:  sorted.slice(0, DIGEST_PHOTO_COUNT),
    listed:  sorted.slice(DIGEST_PHOTO_COUNT, DIGEST_MAX_NOTIFIED),
    omitted: Math.max(0, sorted.length - DIGEST_MAX_NOTIFIED),
  }
}
