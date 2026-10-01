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

// Also used to escape the href attribute value (see below), so the quote is
// escaped too, not just the three HTML-body special characters. Single-pass
// map form, so there is no replace ordering for a future edit to get wrong
// (chained replaces would corrupt "&amp;quot;" if the quote pass ever ran
// before the ampersand pass) — same pattern as
// 02_services/mission-control/lib/pricelist/template.ts.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

function firstCaptionLine(caption: string | null): string {
  if (!caption) return ''
  return caption.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
}

/**
 * Truncate already-escaped HTML without leaving half an entity or half a
 * surrogate pair behind (`&amp` with no semicolon renders as literal text in
 * Telegram; a lone high surrogate is not valid UTF-8 and Telegram's API
 * rejects the whole send with a 400). Order matters: strip the entity
 * *before* the surrogate. Stripping the entity can itself re-expose a lone
 * high surrogate that sat just before it (e.g. a cut landing on
 * "...\uD83C&am"), so the surrogate check has to run last to see the string
 * as it actually ends up, not as it looked before the entity was removed.
 */
function truncateEscaped(escaped: string, max: number): string {
  if (escaped.length <= max) return escaped
  return escaped.slice(0, max - 1)
    .replace(/&[a-z]{0,5};?$/i, '')    // never leave half an entity
    .replace(/[\uD800-\uDBFF]$/, '')   // never leave half a surrogate pair
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

/**
 * 'account' = a real per-account scrape/insert error (label is an Instagram
 * username, rendered with @). 'system' = a data-quality problem not tied to
 * any one account (e.g. the all-zero-reels guard). 'delivery' = a Telegram
 * send that itself failed (digest or heartbeat) — the caller in sync_trends.ts
 * skips sending a report at all when every failure is 'delivery', since that
 * would go out over the exact channel that just failed.
 */
export type Failure = { kind: 'account' | 'system' | 'delivery'; label: string; message: string }

/** Telegram's hard limit for a text message (distinct from the 1024 photo-caption limit above). */
export const TELEGRAM_TEXT_LIMIT = 4096

/**
 * Per-failure message budget before the whole report gets capped. `message`
 * here is error text from Supabase/Apify, not something we control — an
 * upstream 502 can hand back an HTML error page as the "JSON" body, so
 * `err.message` is genuinely user-hostile input as far as this formatter is
 * concerned, same as a reel caption from Instagram.
 */
const FAILURE_MESSAGE_LIMIT = 300

/**
 * Builds the HTML text for the "the run failed" Telegram alert. This is the
 * one message in the whole pipeline that fires *because* something already
 * went wrong — which is exactly when an unescaped `<html>` from a CDN error
 * page, or a run of failures blowing past 4096 characters, would make
 * Telegram reject the alert itself (400 `Unsupported start tag "html"`, or a
 * flat length rejection) and leave the operator with nothing but a red
 * Action. Escaping and length-bounding this one is not optional the way it
 * might be for friendlier strings.
 */
export function formatFailureReport(failures: Failure[], totalAccounts: number): string {
  const accountFailures = failures.filter(f => f.kind === 'account')
  const otherFailures    = failures.filter(f => f.kind !== 'account')

  const headerParts: string[] = []
  if (accountFailures.length > 0) headerParts.push(`${accountFailures.length} из ${totalAccounts} аккаунтов`)
  if (otherFailures.length > 0)   headerParts.push(`${otherFailures.length} проблем${otherFailures.length === 1 ? 'а' : 'ы'}`)

  const header = `⚠️ <b>Синк трендов упал: ${headerParts.join(' + ')}</b>`

  const lines = failures.map(f => {
    const label   = escapeHtml(f.label)
    const message = truncateEscaped(escapeHtml(f.message), FAILURE_MESSAGE_LIMIT)
    return f.kind === 'account' ? `• @${label} — ${message}` : `• ${label} — ${message}`
  })

  // Telegram rejects the ENTIRE message over TELEGRAM_TEXT_LIMIT characters — a batch
  // of ten verbose failures must not cost the whole alert. Keep whole lines (never
  // truncate mid-failure, that's what FAILURE_MESSAGE_LIMIT is for) and count the
  // rest, same spirit as pickDigestReels' `omitted`.
  const kept: string[] = []
  let used = header.length
  for (const line of lines) {
    if (used + 1 + line.length > TELEGRAM_TEXT_LIMIT) break   // +1 for the joining newline
    kept.push(line)
    used += 1 + line.length
  }

  const omitted = lines.length - kept.length
  if (omitted > 0) {
    const tail = `…и ещё ${omitted}`
    // Not mathematically guaranteed — if the lines right at the edge of the
    // limit left no room at all, drop the tail rather than ever exceed the
    // limit ourselves.
    if (used + 1 + tail.length <= TELEGRAM_TEXT_LIMIT) kept.push(tail)
  }

  return [header, ...kept].join('\n')
}
