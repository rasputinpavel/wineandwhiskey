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
