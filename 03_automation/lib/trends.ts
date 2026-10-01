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

/** Telegram's hard limit for a photo caption. */
export const TELEGRAM_CAPTION_LIMIT = 1024

const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

export function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return ''
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function formatDateRu(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getUTCDate()} ${MONTHS_RU[d.getUTCMonth()]}`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function firstCaptionLine(caption: string | null): string {
  if (!caption) return ''
  return caption.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
}

/**
 * Truncate already-escaped HTML without leaving half an entity behind
 * (`&amp` with no semicolon renders as literal text in Telegram).
 */
function truncateEscaped(escaped: string, max: number): string {
  if (escaped.length <= max) return escaped
  return escaped.slice(0, max - 1).replace(/&[a-z]{0,5};?$/i, '').trimEnd() + '…'
}

export function formatHeader(count: number): string {
  return `📈 <b>Залетело за сутки: ${count}</b>`
}

export function formatReelCaption(reel: DigestReel): string {
  const m = multiple(reel.views, reel.followers)
  const head =
    `@${escapeHtml(reel.username)} · <b>${formatViews(reel.views)} просмотров</b>` +
    (m >= 2 ? ` · ${Math.round(m)}× от своей нормы` : '')

  const meta = [formatDuration(reel.durationS), formatDateRu(reel.publishedAt)]
    .filter(part => part !== '')
    .join(' · ')

  const link = `<a href="${escapeHtml(reel.url)}">смотреть рилс →</a>`
  const lines = meta === '' ? [head] : [head, meta]
  const withoutQuote = [...lines, link].join('\n')

  const quote = escapeHtml(firstCaptionLine(reel.caption))
  if (quote === '') return withoutQuote

  // «», the quote's own newline, and the ellipsis all have to fit too.
  const budget = TELEGRAM_CAPTION_LIMIT - withoutQuote.length - 4
  if (budget < 20) return withoutQuote

  return [...lines, `«${truncateEscaped(quote, budget)}»`, link].join('\n')
}

export function formatListLine(reel: DigestReel): string {
  const m = multiple(reel.views, reel.followers)
  const mult = m >= 2 ? `, ${Math.round(m)}×` : ''
  return `• @${escapeHtml(reel.username)} — <b>${formatViews(reel.views)}</b>${mult} — ` +
    `<a href="${escapeHtml(reel.url)}">рилс</a>`
}
