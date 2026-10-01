/**
 * Decision logic and Telegram message formatting for the trend digest, kept
 * dependency-free (no network, no database) so it can be unit-tested and so
 * sync_trends.ts holds nothing but I/O. The formatting half also owns the
 * Russian copy, Telegram's HTML-subset dialect and its length limits.
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
  // 999_500 and up round to "1.0M" anyway — gate here so the K branch never
  // rounds a value past its own ceiling into e.g. "1000K".
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

// `null` and `0` both render as "unknown duration" (empty string) here — that's
// intentional, not an oversight. Above an hour this renders as pure minutes
// (3661 -> '61:01'), which is fine for reels and not worth an hours field.
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
  // Also used to escape the href attribute value (see below), so the quote
  // must be escaped too, not just the three HTML-body special characters.
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function firstCaptionLine(caption: string | null): string {
  if (!caption) return ''
  return caption.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
}

/**
 * Truncate already-escaped HTML without leaving half an entity or half a
 * surrogate pair behind (`&amp` with no semicolon renders as literal text in
 * Telegram; a lone high surrogate is not valid UTF-8 and Telegram's API
 * rejects the whole send with a 400). Order matters: strip the surrogate
 * before the entity, since an entity never contains a surrogate but a cut
 * could land right between the two cleanups.
 */
function truncateEscaped(escaped: string, max: number): string {
  if (escaped.length <= max) return escaped
  return escaped.slice(0, max - 1)
    .replace(/[\uD800-\uDBFF]$/, '')   // never leave half a surrogate pair
    .replace(/&[a-z]{0,5};?$/i, '')    // never leave half an entity
    .trimEnd() + '…'
}

export function formatHeader(count: number): string {
  return `📈 <b>Залетело за сутки: ${count}</b>`
}

/**
 * The "×× от своей нормы" / ", ××" label, shared by the caption and the list
 * line. The `< 2` gate is only reachable when followers is missing or zero —
 * `isHit()` already requires the multiple to be >= 5 before a reel ever
 * reaches these formatters — but it is kept here so neither caller has to
 * special-case a followers-unknown reel on its own.
 */
function multipleLabel(m: number): string {
  return m >= 2 ? `${Math.round(m)}×` : ''
}

export function formatReelCaption(reel: DigestReel): string {
  const mLabel = multipleLabel(multiple(reel.views, reel.followers))
  const head =
    `@${escapeHtml(reel.username)} · <b>${formatViews(reel.views)} просмотров</b>` +
    (mLabel ? ` · ${mLabel} от своей нормы` : '')

  const meta = [formatDuration(reel.durationS), formatDateRu(reel.publishedAt)]
    .filter(part => part !== '')
    .join(' · ')

  const link = `<a href="${escapeHtml(reel.url)}">смотреть рилс →</a>`
  const lines = meta === '' ? [head] : [head, meta]
  const withoutQuote = [...lines, link].join('\n')

  const quote = escapeHtml(firstCaptionLine(reel.caption))
  if (quote === '') return withoutQuote

  // «» plus the quote's own newline cost 3 characters; truncateEscaped itself
  // reserves the 4th by capping at `max - 1` before appending the ellipsis.
  const budget = TELEGRAM_CAPTION_LIMIT - withoutQuote.length - 4
  if (budget < 20) return withoutQuote

  return [...lines, `«${truncateEscaped(quote, budget)}»`, link].join('\n')
}

export function formatListLine(reel: DigestReel): string {
  const mLabel = multipleLabel(multiple(reel.views, reel.followers))
  return `• @${escapeHtml(reel.username)} — <b>${formatViews(reel.views)}</b>${mLabel ? `, ${mLabel}` : ''} — ` +
    `<a href="${escapeHtml(reel.url)}">рилс</a>`
}
