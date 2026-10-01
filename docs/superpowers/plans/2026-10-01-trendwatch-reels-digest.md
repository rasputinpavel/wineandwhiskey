# Trendwatch Reels Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily Telegram digest of wine reels that went viral relative to their own account, collected by the existing GitHub Action, with no web UI and no video generation.

**Architecture:** `03_automation/sync_trends.ts` stays the entry point and keeps all network/database work. Every decision it makes (what counts as a hit, what is fresh enough to notify, how the digest reads) moves into a pure, unit-tested module `03_automation/lib/trends.ts`. Telegram and Apify calls become thin wrappers in `03_automation/lib/telegram.ts` and `03_automation/lib/apify.ts`. The watchlist is maintained from the command line by a new `03_automation/trend_accounts_cli.ts`, because the web UI that used to own that job is not deployed.

**Tech Stack:** TypeScript run through `tsx`, Node 25, vitest (new at the repo root), Supabase JS client (PostgREST), Apify actors `apify~instagram-scraper` and `apify~instagram-profile-scraper`, Telegram Bot API.

**Spec:** `docs/superpowers/specs/2026-10-01-trendwatch-reels-digest-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `vitest.config.ts` (create, root) | Test runner config for `03_automation/`. The root currently has no test setup at all. |
| `package.json` (modify, root) | Add `vitest` devDependency, `test` script, `trends:accounts` script. |
| `03_automation/lib/trends.ts` (create) | **All pure logic**: thresholds, multiple, freshness window, digest selection, message formatting. No I/O. |
| `03_automation/lib/trends.test.ts` (create) | Unit tests for the above. |
| `03_automation/lib/telegram.ts` (create) | `sendMessage` and `sendPhotoFromUrl` (multipart upload). Returns booleans instead of throwing, so one bad thumbnail cannot kill a digest. |
| `03_automation/lib/apify.ts` (create) | `runApify`, `pollApify`, `getDataset`, `getProfile`. Used by the new CLI. |
| `03_automation/sync_trends.ts` (modify) | Daily job: fail fast on missing env, scrape, store, build digest from `lib/trends.ts`, send, then exit non-zero if any account failed. |
| `03_automation/trend_accounts_cli.ts` (create) | Watchlist maintenance: `--list`, `--add`, `--on`, `--off`. |
| `03_automation/discover_trend_accounts.ts` (modify, one line) | Stop resetting `is_active` on re-discovery. |
| `.github/workflows/sync-trends.yml` (modify) | Drop `TRENDWATCH_URL` (no service to link to). |
| `docs/SERVICES.md`, `docs/ARCHITECTURE.md` (modify) | Record that trend collection runs from Actions and the digest is the only consumer. |

`discover_trend_accounts.ts` keeps its own private copies of the Apify helpers. Extracting them is a refactor of a working 500-line script with no tests, and it is deliberately out of scope here.

---

### Task 1: Test harness at the repo root + the hit threshold

The repo root has no test runner. This task adds one and uses it immediately for the threshold that decides what "залетело" means.

**Files:**
- Modify: `package.json` (root)
- Create: `vitest.config.ts` (root)
- Create: `03_automation/lib/trends.ts`
- Test: `03_automation/lib/trends.test.ts`

- [ ] **Step 1: Install the test runner**

Matching the version mission-control already uses, so the monorepo has one vitest major:

```bash
npm install -D vitest@^2.1.8
```

- [ ] **Step 2: Add the config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['03_automation/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 3: Add the test script**

In the root `package.json`, inside `"scripts"`, add:

```json
    "test": "vitest run",
```

- [ ] **Step 4: Write the failing test**

Create `03_automation/lib/trends.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isHit, multiple } from './trends'

describe('multiple', () => {
  it('is views divided by followers', () => {
    expect(multiple(100_000, 10_000)).toBe(10)
  })

  it('is 0 when the follower count is missing or zero', () => {
    expect(multiple(100_000, null)).toBe(0)
    expect(multiple(100_000, 0)).toBe(0)
    expect(multiple(100_000, undefined)).toBe(0)
  })
})

describe('isHit', () => {
  it('accepts a reel exactly on both thresholds', () => {
    // 50_000 views from 10_000 followers is exactly 5x and exactly the floor
    expect(isHit(50_000, 10_000)).toBe(true)
  })

  it('rejects a reel one view under the floor', () => {
    expect(isHit(49_999, 1_000)).toBe(false)
  })

  it('rejects a reel just under the multiple', () => {
    // 4.9x, well over the floor — routine output of a large account
    expect(isHit(245_000, 50_000)).toBe(false)
  })

  it('rejects a tiny account that cannot clear the floor', () => {
    // 10x, but 3_000 views is noise
    expect(isHit(3_000, 300)).toBe(false)
  })

  it('never fires when the follower count is unknown', () => {
    expect(isHit(1_000_000, null)).toBe(false)
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./trends"`.

- [ ] **Step 6: Write the minimal implementation**

Create `03_automation/lib/trends.ts`:

```ts
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
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 7 tests.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts 03_automation/lib/trends.ts 03_automation/lib/trends.test.ts
git commit -m "трендвотч: порог «залетело» = ≥5× подписчиков И ≥50K просмотров

Вместо ≥15K ИЛИ ≥1.5× — то был OR, и дайджест забивала рутина крупных
аккаунтов. Заодно первый тестовый стенд в корне репозитория (vitest)."
```

---

### Task 2: The notify window

Everything above the threshold is stored, but only recent reels are sent. Without this, activating ten accounts dumps each one's entire back catalogue of hits into the chat on day one.

**Files:**
- Modify: `03_automation/lib/trends.ts`
- Test: `03_automation/lib/trends.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `03_automation/lib/trends.test.ts`:

```ts
import { isFreshForDigest } from './trends'

describe('isFreshForDigest', () => {
  const now = new Date('2026-10-01T09:00:00Z')

  it('notifies a reel published 13 days ago', () => {
    expect(isFreshForDigest('2026-09-18T09:00:00Z', now)).toBe(true)
  })

  it('skips a reel published 15 days ago', () => {
    expect(isFreshForDigest('2026-09-16T09:00:00Z', now)).toBe(false)
  })

  it('treats a future timestamp as fresh rather than dropping it', () => {
    // Instagram timestamps occasionally land slightly ahead of our clock
    expect(isFreshForDigest('2026-10-01T11:00:00Z', now)).toBe(true)
  })

  it('skips a missing or unparseable date', () => {
    expect(isFreshForDigest(null, now)).toBe(false)
    expect(isFreshForDigest('не дата', now)).toBe(false)
  })
})
```

Merge the new `import` into the existing one at the top of the file rather than adding a second import line.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `isFreshForDigest is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `03_automation/lib/trends.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add 03_automation/lib/trends.ts 03_automation/lib/trends.test.ts
git commit -m "трендвотч: в дайджест только рилсы не старше 14 дней

Хиты старше сохраняем в базу, но не отправляем — иначе свежеподключённый
аккаунт вывалит в чат весь свой архив."
```

---

### Task 3: Digest selection

**Files:**
- Modify: `03_automation/lib/trends.ts`
- Test: `03_automation/lib/trends.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `03_automation/lib/trends.test.ts`:

```ts
import { pickDigestReels, type DigestReel } from './trends'

function reel(over: Partial<DigestReel> = {}): DigestReel {
  return {
    username: 'shop',
    views: 100_000,
    followers: 10_000,
    url: 'https://www.instagram.com/reel/AAA/',
    publishedAt: '2026-09-28T10:00:00Z',
    durationS: 30,
    caption: 'caption',
    thumbnailUrl: 'https://cdn.example/thumb.jpg',
    ...over,
  }
}

describe('pickDigestReels', () => {
  it('splits 12 hits into 5 photos, 5 list lines and a remainder', () => {
    const hits = Array.from({ length: 12 }, (_, i) =>
      reel({ username: `shop${i}`, followers: 1_000, views: 60_000 + i * 1_000 }),
    )
    const picked = pickDigestReels(hits)
    expect(picked.photos).toHaveLength(5)
    expect(picked.listed).toHaveLength(5)
    expect(picked.omitted).toBe(2)
  })

  it('orders by multiple, not by raw views', () => {
    const big = reel({ username: 'big', followers: 500_000, views: 3_000_000 })   // 6x
    const small = reel({ username: 'small', followers: 4_000, views: 600_000 })   // 150x
    const picked = pickDigestReels([big, small])
    expect(picked.photos.map(r => r.username)).toEqual(['small', 'big'])
    expect(picked.listed).toEqual([])
    expect(picked.omitted).toBe(0)
  })

  it('returns empty groups for no hits', () => {
    expect(pickDigestReels([])).toEqual({ photos: [], listed: [], omitted: 0 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `pickDigestReels is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `03_automation/lib/trends.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add 03_automation/lib/trends.ts 03_automation/lib/trends.test.ts
git commit -m "трендвотч: отбор для дайджеста — 5 с обложками, 5 списком, остальное счётчиком

Сортировка по кратности, а не по просмотрам: 150× на аккаунте в 4K
полезнее, чем 6× на аккаунте в 500K."
```

---

### Task 4: Message formatting

**Files:**
- Modify: `03_automation/lib/trends.ts`
- Test: `03_automation/lib/trends.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `03_automation/lib/trends.test.ts`. These tests reuse the `reel()` helper defined in
Task 3's test block — it is in the same file, so nothing needs redefining:

```ts
import {
  formatHeader,
  formatListLine,
  formatReelCaption,
  formatViews,
  TELEGRAM_CAPTION_LIMIT,
} from './trends'

describe('formatViews', () => {
  it('renders millions, thousands and small numbers', () => {
    expect(formatViews(2_114_943)).toBe('2.1M')
    expect(formatViews(611_417)).toBe('611K')
    expect(formatViews(950)).toBe('950')
  })
})

describe('formatHeader', () => {
  it('counts the reels being sent', () => {
    expect(formatHeader(3)).toBe('📈 <b>Залетело за сутки: 3</b>')
  })
})

describe('formatReelCaption', () => {
  it('puts account, views, multiple, length, date, quote and link in order', () => {
    const caption = formatReelCaption(reel({
      username:    'fabiopicchiquintovizio',
      followers:   4_015,
      views:       611_417,
      durationS:   42,
      publishedAt: '2026-04-12T08:30:00Z',
      caption:     'Questo vino costa 8 euro\nsecond line ignored',
      url:         'https://www.instagram.com/reel/XYZ/',
    }))
    expect(caption).toBe(
      '@fabiopicchiquintovizio · <b>611K просмотров</b> · 152× от своей нормы\n' +
      '0:42 · 12 апреля\n' +
      '«Questo vino costa 8 euro»\n' +
      '<a href="https://www.instagram.com/reel/XYZ/">смотреть рилс →</a>',
    )
  })

  it('escapes HTML in the quoted caption', () => {
    const caption = formatReelCaption(reel({ caption: 'Bordeaux <b>&</b> Rioja' }))
    expect(caption).toContain('«Bordeaux &lt;b&gt;&amp;&lt;/b&gt; Rioja»')
  })

  it('omits the quote line entirely when the caption is empty', () => {
    const caption = formatReelCaption(reel({ caption: null }))
    expect(caption).not.toContain('«')
  })

  it('stays inside the Telegram caption limit and never cuts an HTML entity', () => {
    const caption = formatReelCaption(reel({ caption: 'A & '.repeat(600) }))
    expect(caption.length).toBeLessThanOrEqual(TELEGRAM_CAPTION_LIMIT)
    expect(caption).toContain('…»')
    expect(caption).not.toMatch(/&[a-z]*…/)
    expect(caption.endsWith('</a>')).toBe(true)
  })
})

describe('formatListLine', () => {
  it('is one line with account, views, multiple and link', () => {
    expect(formatListLine(reel({ username: 'shop', followers: 1_000, views: 60_000 }))).toBe(
      '• @shop — <b>60K</b>, 60× — <a href="https://www.instagram.com/reel/AAA/">рилс</a>',
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `formatViews is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `03_automation/lib/trends.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the suite grew past this number as the branch went on; the final count is 44.

If the `152×` assertion fails, check the rounding: 611_417 / 4_015 = 152.28, and `Math.round` gives 152.

- [ ] **Step 5: Commit**

```bash
git add 03_automation/lib/trends.ts 03_automation/lib/trends.test.ts
git commit -m "трендвотч: формат сообщений дайджеста

Факты без AI: аккаунт, просмотры, кратность, длительность, дата, первая
строка подписи, ссылка. Обрезка подписи не рвёт HTML-сущности пополам."
```

---

### Task 5: Telegram wrappers

Thin, failure-tolerant I/O. A thumbnail that will not download must cost us that one photo, not the digest.

**Files:**
- Create: `03_automation/lib/telegram.ts`

- [ ] **Step 1: Write the module**

Create `03_automation/lib/telegram.ts`:

```ts
/**
 * Minimal Telegram Bot API wrappers. Both functions report success as a boolean
 * instead of throwing: a digest half-sent is better than a digest lost.
 */

const API = 'https://api.telegram.org'

export async function sendMessage(token: string, chatId: string, html: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }),
    })
    if (!res.ok) console.error(`  ✗ sendMessage ${res.status}: ${await res.text()}`)
    return res.ok
  } catch (err) {
    console.error('  ✗ sendMessage failed:', err)
    return false
  }
}

/**
 * Download the image ourselves and upload the bytes. Instagram CDN URLs are
 * signed and Telegram's own fetch gets a 403 often enough to matter.
 */
export async function sendPhotoFromUrl(
  token:    string,
  chatId:   string,
  photoUrl: string,
  html:     string,
): Promise<boolean> {
  try {
    const img = await fetch(photoUrl)
    if (!img.ok) {
      console.error(`  ✗ thumbnail ${img.status} for ${photoUrl}`)
      return false
    }
    const form = new FormData()
    form.append('chat_id', chatId)
    form.append('caption', html)
    form.append('parse_mode', 'HTML')
    form.append('photo', await img.blob(), 'thumb.jpg')

    const res = await fetch(`${API}/bot${token}/sendPhoto`, { method: 'POST', body: form })
    if (!res.ok) console.error(`  ✗ sendPhoto ${res.status}: ${await res.text()}`)
    return res.ok
  } catch (err) {
    console.error('  ✗ sendPhoto failed:', err)
    return false
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 03_automation/lib/telegram.ts --target es2022 --module nodenext --moduleResolution nodenext --strict`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add 03_automation/lib/telegram.ts
git commit -m "трендвотч: обёртки Telegram — текст и фото multipart

Обложку скачиваем сами и отправляем байтами: по прямой ссылке Instagram
CDN часто отдаёт телеграму 403. Ошибки возвращаются булевым, не бросаются."
```

---

### Task 6: Rewire the daily job

**Files:**
- Modify: `03_automation/sync_trends.ts`

This replaces three things: the `VIEWS_ABSOLUTE`/`VIEWS_RELATIVE` constants (lines 20-21), the whole `notifyBarrymore` function (lines 66-96), and the end of `main` (lines 198-211). It also adds a fail-fast env check.

- [ ] **Step 1: Replace the thresholds and imports**

At the top of `03_automation/sync_trends.ts`, after the existing imports, add:

```ts
import {
  isFreshForDigest,
  isHit,
  multiple,
  formatHeader,
  formatListLine,
  formatReelCaption,
  pickDigestReels,
  type DigestReel,
} from './lib/trends'
import { sendMessage, sendPhotoFromUrl } from './lib/telegram'
```

Delete these two lines:

```ts
const VIEWS_ABSOLUTE  = 15_000  // catch niche accounts
const VIEWS_RELATIVE  = 1.5     // views/followers ratio
```

- [ ] **Step 2: Add the fail-fast env check**

Replace the client/token setup near the top:

```ts
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const APIFY_TOKEN = process.env.APIFY_TOKEN!
```

with:

```ts
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(
      `✗ ${name} is not set. In CI it comes from a GitHub secret; locally from .env.local. ` +
      `Refusing to run — a silent no-op here went unnoticed for five months.`,
    )
    process.exit(1)
  }
  return value
}

const SUPABASE_URL  = requireEnv('SUPABASE_URL')
const SUPABASE_KEY  = requireEnv('SUPABASE_SERVICE_KEY')
const APIFY_TOKEN   = requireEnv('APIFY_TOKEN')

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
```

- [ ] **Step 3: Scrape fewer posts per account**

In `scrapeAccount`, change the signature default (line 40) from `maxPosts = 30` to:

```ts
async function scrapeAccount(username: string, maxPosts = 10): Promise<Post[]> {
```

The actor bills per result and a daily run only needs recent posts.

- [ ] **Step 4: Replace the hit filter**

In `main`, replace the `highReach` block:

```ts
      const posts = await scrapeAccount(account.username)
      const followers = account.followers_count ?? 0
      const highReach = posts.filter(p => {
        const v = p.videoPlayCount ?? 0
        const absoluteHit  = v >= VIEWS_ABSOLUTE
        const relativeHit  = followers > 0 && v / followers >= VIEWS_RELATIVE
        return absoluteHit || relativeHit
      })

      console.log(`  ${posts.length} Reels found, ${highReach.length} above threshold (≥${(VIEWS_ABSOLUTE/1000).toFixed(0)}K or ≥${VIEWS_RELATIVE}x ratio)`)
```

with:

```ts
      const posts = await scrapeAccount(account.username)
      const followers = account.followers_count ?? 0
      const highReach = posts.filter(p => isHit(p.videoPlayCount ?? 0, followers))

      console.log(`  ${posts.length} Reels found, ${highReach.length} above threshold (≥5× подписчиков и ≥50K)`)
```

- [ ] **Step 5: Collect digest reels instead of three bare fields**

Replace the declaration (line ~128):

```ts
  const newReelNotifications: Array<{ username: string; views: number; url: string }> = []
```

with:

```ts
  const newReelNotifications: DigestReel[] = []
  const failures: Array<{ username: string; message: string }> = []
```

Replace the push inside the loop:

```ts
        newReelNotifications.push({
          username: account.username,
          views: post.videoPlayCount ?? 0,
          url: reelUrl,
        })
```

with:

```ts
        newReelNotifications.push({
          username:     account.username,
          views:        post.videoPlayCount ?? 0,
          followers,
          url:          reelUrl,
          publishedAt:  post.timestamp ?? null,
          durationS:    post.videoDuration ?? null,
          caption:      post.caption ?? null,
          thumbnailUrl: post.displayUrl ?? null,
        })
```

Also set `trigger_type` in the insert to a constant, since the threshold is now an AND and both halves always hold:

```ts
            trigger_type:         'both',
```

Delete the now-unused `triggerType`, `absoluteHit` and `relativeHit` lines above the insert, and replace the `ratio_at_capture` expression with the shared helper:

```ts
            ratio_at_capture:     followers > 0 ? parseFloat(multiple(views, followers).toFixed(2)) : null,
```

- [ ] **Step 6: Record failures instead of swallowing them**

Replace the `catch` inside the account loop:

```ts
    } catch (err) {
      console.error(`  ✗ Failed:`, err)
    }
```

with:

```ts
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`  ✗ Failed: ${message}`)
      failures.push({ username: account.username, message })
    }
```

- [ ] **Step 7: Replace notifyBarrymore**

Delete the entire existing `notifyBarrymore` function and put this in its place:

```ts
function telegramTarget(): { token: string; chatId: string } | null {
  const token  = process.env.BARRYMORE_BOT_TOKEN
  const chatId = process.env.BARRYMORE_OWNER_CHAT_ID ?? process.env.BARRYMORE_CHAT_ID
  if (!token || !chatId) {
    console.error('  ⚠ BARRYMORE_BOT_TOKEN / BARRYMORE_CHAT_ID not set — digest not sent')
    return null
  }
  return { token, chatId }
}

async function sendDigest(reels: DigestReel[]): Promise<void> {
  const fresh = reels.filter(r => isFreshForDigest(r.publishedAt))
  if (fresh.length === 0) {
    console.log(`📭 ${reels.length} new reel(s), none published in the notify window — no digest`)
    return
  }

  const target = telegramTarget()
  if (!target) return
  const { token, chatId } = target

  const { photos, listed, omitted } = pickDigestReels(fresh)

  await sendMessage(token, chatId, formatHeader(fresh.length))

  for (const reel of photos) {
    const caption = formatReelCaption(reel)
    const sent = reel.thumbnailUrl
      ? await sendPhotoFromUrl(token, chatId, reel.thumbnailUrl, caption)
      : false
    // No thumbnail, or Instagram refused it — the reel still deserves a message.
    if (!sent) await sendMessage(token, chatId, caption)
  }

  if (listed.length > 0 || omitted > 0) {
    const tail = [...listed.map(formatListLine)]
    if (omitted > 0) tail.push(`…и ещё ${omitted} — порог прошли, в дайджест не влезли`)
    await sendMessage(token, chatId, tail.join('\n'))
  }

  console.log(`📩 Digest sent: ${photos.length} with thumbnails, ${listed.length} listed, ${omitted} omitted`)
}

async function reportFailures(failures: Array<{ username: string; message: string }>, total: number): Promise<void> {
  const target = telegramTarget()
  if (!target) return
  const lines = [
    `⚠️ <b>Синк трендов упал: ${failures.length} из ${total} аккаунтов</b>`,
    ...failures.map(f => `• @${f.username} — ${f.message}`),
  ]
  await sendMessage(target.token, target.chatId, lines.join('\n'))
}
```

- [ ] **Step 8: Replace the end of main**

Replace the tail of `main`:

```ts
  console.log(`\n✅ Done. New reels: ${totalNew}`)

  if (!isDryRun && newReelNotifications.length > 0) {
    await notifyBarrymore(newReelNotifications)
    console.log('📩 Barrymore notified')
  }
}
```

with:

```ts
  console.log(`\nNew reels: ${totalNew}`)

  // Send what we have BEFORE failing: a non-zero exit must never cost us a
  // digest that is already assembled.
  if (!isDryRun && newReelNotifications.length > 0) {
    await sendDigest(newReelNotifications)
  }

  if (failures.length > 0) {
    if (!isDryRun) await reportFailures(failures, accounts.length)
    console.error(`\n✗ ${failures.length} of ${accounts.length} account(s) failed`)
    process.exit(1)
  }

  console.log('✅ Done.')
}
```

- [ ] **Step 9: Verify the whole suite and the dry run**

Run: `npm test`
Expected: PASS — unchanged by this task (the final branch count is 44).

Run: `npm run trends -- --dry-run --account fabiopicchiquintovizio`
Expected: it scrapes one account and prints `N Reels found, M above threshold (≥5× подписчиков и ≥50K)`. With `--account` the follower count is null, so `M` is 0 — that is correct behaviour, not a bug (see Task 1's last test). No Telegram message is sent in a dry run.

Run: `APIFY_TOKEN= npm run trends -- --dry-run`
Expected: exits immediately with `✗ APIFY_TOKEN is not set...` and a non-zero code. This is the regression that started this whole piece of work.

- [ ] **Step 10: Commit**

```bash
git add 03_automation/sync_trends.ts
git commit -m "трендвотч: синк падает громко и присылает дайджест с обложками

Было: пустой APIFY_TOKEN → ошибка внутри цикла → «✅ Done. New reels: 0»
и зелёный Action. Пять месяцев сбор не работал, и это выглядело нормой.

Теперь: отсутствующий env валит запуск до цикла; упавшие аккаунты
копятся, дайджест по удачным уходит ПЕРЕД exit(1); Бэрримор отдельно
сообщает о падении. Порог — из lib/trends, 10 постов на аккаунт вместо 30."
```

---

### Task 6b: Scrape reels the way that actually works

Added 2026-10-01, after Task 6's dry run printed `0 Reels found` for a live account. This plan
inherited the script's actor input unexamined, and that input is known-broken.
`02_services/trendwatch/lib/apify.ts:75-77` carries both the fix and the reason: "Using
directUrls + resultsType=reels — same pattern that fixed hashtag scraping. The older `usernames
+ resultsType=posts` filter often returned zero videos." That fix never reached the script the
daily Action runs, so the job would have collected nothing even once the token was in place.

The field shapes are identical (`Post` in `sync_trends.ts` and `InstagramPost` in the service
list the same keys), so only the actor input and the filter predicate change.

**Files:**
- Modify: `03_automation/sync_trends.ts`

- [ ] **Step 1: Switch the actor input and the filter**

In `scrapeAccount`, replace the request body:

```ts
    body: JSON.stringify({ usernames: [username], resultsType: 'posts', resultsLimit: maxPosts }),
```

with:

```ts
    // directUrls + resultsType=reels, ported from 02_services/trendwatch/lib/apify.ts:75.
    // The older `usernames` + `resultsType: 'posts'` input returns zero videos for most
    // accounts, which is why this job collected nothing even on the days it ran.
    body: JSON.stringify({
      directUrls:   [`https://www.instagram.com/${username}/reels/`],
      resultsType:  'reels',
      resultsLimit: maxPosts,
    }),
```

and replace the return filter:

```ts
  return items.filter(p => p.type === 'Video')
```

with:

```ts
  console.log(`  ${items.length} items from Apify, ${items.filter(p => p.videoPlayCount != null).length} with a view count`)
  return items.filter(p => p.videoPlayCount != null)
```

- [ ] **Step 2: Prove it returns reels**

Run once: `npm run trends -- --dry-run --account lucialoveswine`

Expected: a non-zero `items from Apify` count and a non-zero "with a view count" count. The
`above threshold` count stays 0, because `--account` supplies no follower count and a relative
threshold cannot be met without one — that is correct behaviour, not a failure.

If this still returns zero items, **stop and report**: the actor's input contract has drifted
again and the fix is not a one-liner.

- [ ] **Step 3: Commit**

Stage `03_automation/sync_trends.ts` and commit with this message:

```
трендвотч: тянуть рилсы рабочим способом, а не возвращать ноль

directUrls + resultsType=reels вместо usernames + posts. Правка давно
жила в 02_services/trendwatch/lib/apify.ts с комментарием «старый
паттерн часто возвращал ноль видео», но до скрипта, который гоняет
Action, так и не доехала.
```

---

### Task 6c: Daily heartbeat, and keep the smoke test consequence-free

Added 2026-10-01 after review. Two small changes to `03_automation/sync_trends.ts`.

**1. A quiet day sends one line.** The user chose a daily heartbeat over weekly or nothing. When
there is nothing to send — no new reels, or new reels none of which fall inside the 14-day notify
window — send `🫧 Проверено аккаунтов: N · рилсов просмотрено: M · залётов нет` instead of staying
silent. Count a failed heartbeat as a failure, exactly like an undelivered digest: the point of
the line is that its absence means something, so it has to actually arrive. Keep it gated on
`!isDryRun` like every other Telegram call.

**2. The all-zero-reels guard must not fire on a dry run.** It currently reddens
`npm run trends -- --dry-run --account <name>` whenever that one account happens to be quiet,
which makes the smoke test unusable for debugging. Gate it on `!isDryRun`. It stays a heuristic:
ten accounts returning nothing on the same morning means the Apify input drifted, but one quiet
account means nothing — worth a comment saying so.

**Files:**
- Modify: `03_automation/sync_trends.ts`

- [ ] **Step 1:** Implement both changes.
- [ ] **Step 2:** `npm test` — expect 31 passing, unchanged.
- [ ] **Step 3:** `APIFY_TOKEN= npm run trends -- --dry-run` — expect the fail-fast message and exit 1.
- [ ] **Step 4:** Stage `03_automation/sync_trends.ts` and commit with a Russian message recording why the heartbeat exists: silence used to mean both "nothing viral" and "everything broke".

---

### Task 7: Watchlist CLI

Promoting, adding and switching accounts was a button in the undeployed web UI. This is its replacement.

**Files:**
- Create: `03_automation/lib/apify.ts`
- Create: `03_automation/trend_accounts_cli.ts`
- Modify: `package.json` (root)

- [ ] **Step 1: Write the Apify helpers**

Create `03_automation/lib/apify.ts`:

```ts
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
```

- [ ] **Step 2: Write the CLI**

Create `03_automation/trend_accounts_cli.ts`:

```ts
/**
 * trend_accounts_cli.ts — maintain the trend watchlist from the command line.
 *
 * The trendwatch web UI owned this job and is not deployed, so this is the only
 * way in. `is_active` is the single switch that costs money: only active
 * accounts are scraped by the daily sync.
 *
 * Usage:
 *   npm run trends:accounts -- --list
 *   npm run trends:accounts -- --add lucialoveswine marcelopinowine
 *   npm run trends:accounts -- --on fabiopicchiquintovizio vinoteca_mendoza
 *   npm run trends:accounts -- --off ingvildtennfjord
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { getProfile } from './lib/apify'
import { multiple } from './lib/trends'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

type Account = {
  username:          string
  category:          string | null
  followers_count:   number | null
  median_reel_views: number | null
  top3_avg_views:    number | null
  tier:              string | null
  is_active:         boolean
}

async function list(): Promise<void> {
  const { data, error } = await supabase
    .from('trend_accounts')
    .select('username, category, followers_count, median_reel_views, top3_avg_views, tier, is_active')
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as Account[]
  rows.sort((a, b) =>
    multiple(b.top3_avg_views ?? 0, b.followers_count) - multiple(a.top3_avg_views ?? 0, a.followers_count))

  const active = rows.filter(r => r.is_active).length
  console.log(`\n${rows.length} account(s), ${active} active (only active ones are scraped daily)\n`)
  console.log('on   username                   followers   median    top3  mult  tier  category')
  console.log('-'.repeat(88))
  for (const r of rows) {
    const mult = multiple(r.top3_avg_views ?? 0, r.followers_count)
    console.log(
      `${r.is_active ? ' ✓  ' : '    '} ` +
      `${r.username.slice(0, 25).padEnd(25)} ` +
      `${String(r.followers_count ?? '—').padStart(9)} ` +
      `${String(r.median_reel_views ?? '—').padStart(8)} ` +
      `${String(r.top3_avg_views ?? '—').padStart(7)} ` +
      `${(mult >= 1 ? `${Math.round(mult)}x` : '—').padStart(5)} ` +
      `${(r.tier ?? '—').padStart(4)}  ${r.category ?? '—'}`,
    )
  }
  console.log()
}

async function add(usernames: string[]): Promise<void> {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error('APIFY_TOKEN is not set — needed to read the follower count')

  for (const raw of usernames) {
    const username = raw.replace(/^@/, '').trim()
    if (username === '') continue

    const { data: existing } = await supabase
      .from('trend_accounts')
      .select('username')
      .eq('username', username)
      .maybeSingle()
    if (existing) {
      console.log(`  = @${username} already in the list`)
      continue
    }

    // Fetch the profile once: without followers_count the multiple is 0 and the
    // account could never produce a digest entry.
    const profile = await getProfile(token, username)
    if (!profile) {
      console.error(`  ✗ @${username} — profile not found, skipped`)
      continue
    }

    const { error } = await supabase.from('trend_accounts').insert({
      username,
      display_name:    profile.fullName,
      followers_count: profile.followersCount,
      category:        'manual',
      is_active:       false,
    })
    if (error) console.error(`  ✗ @${username} — ${error.message}`)
    else console.log(`  + @${username} (${profile.followersCount.toLocaleString()} followers), inactive`)
  }
}

async function setActive(usernames: string[], isActive: boolean): Promise<void> {
  for (const raw of usernames) {
    const username = raw.replace(/^@/, '').trim()
    if (username === '') continue
    const { data, error } = await supabase
      .from('trend_accounts')
      .update({ is_active: isActive })
      .eq('username', username)
      .select('username')
    if (error) console.error(`  ✗ @${username} — ${error.message}`)
    else if (!data?.length) console.error(`  ✗ @${username} — not in the list (add it first)`)
    else console.log(`  ${isActive ? '✓ on ' : '· off'} @${username}`)
  }
}

function valuesAfter(args: string[], flag: string): string[] {
  const i = args.indexOf(flag)
  if (i === -1) return []
  return args.slice(i + 1).filter(a => !a.startsWith('--'))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--list') || args.length === 0) {
    await list()
    return
  }
  if (args.includes('--add'))  await add(valuesAfter(args, '--add'))
  if (args.includes('--on'))   await setActive(valuesAfter(args, '--on'), true)
  if (args.includes('--off'))  await setActive(valuesAfter(args, '--off'), false)
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: Wire the npm script**

In the root `package.json`, next to `"discover-accounts"`, add:

```json
    "trends:accounts": "tsx 03_automation/trend_accounts_cli.ts",
```

- [ ] **Step 4: Verify against the real table**

Run: `npm run trends:accounts -- --list`
Expected: a one-row table — `ingvildtennfjord`, 121,750 followers, marked active. That single row is why the digest would be empty even with a working token.

Run: `npm run trends:accounts -- --off ingvildtennfjord`
Expected: `· off @ingvildtennfjord`. It is `category: other`, admitted with `verdict: maybe`, and not a wine account.

Run: `npm run trends:accounts -- --on nosuchaccount12345`
Expected: `✗ @nosuchaccount12345 — not in the list (add it first)`.

- [ ] **Step 5: Commit**

```bash
git add 03_automation/lib/apify.ts 03_automation/trend_accounts_cli.ts package.json
git commit -m "трендвотч: CLI для watchlist вместо неразвёрнутой админки

npm run trends:accounts -- --list / --add / --on / --off.
--add дёргает профиль один раз: без followers_count кратность всегда 0,
и аккаунт никогда не попал бы в дайджест."
```

---

### Task 8: Re-discovery must not switch the watchlist off

`discover_trend_accounts.ts` upserts candidates with `is_active: false` and `onConflict: 'username'`. Run monthly as the spec intends, it would silently deactivate every account we had turned on.

**Files:**
- Modify: `03_automation/discover_trend_accounts.ts`

- [ ] **Step 1: Reproduce the problem on paper**

Read the upsert block (`supabase.from('trend_accounts').upsert({...}, { onConflict: 'username' })`, around line 470-500). Confirm `is_active: false` is in the payload. With `onConflict`, an existing active account is updated — including that column.

- [ ] **Step 2: Remove the one line**

Delete this line from the upsert payload:

```ts
        is_active:              false,
```

The column is declared `is_active boolean default false` in `02_services/trendwatch/supabase/migrations/001_trendwatch.sql`, so new rows still arrive inactive, while existing rows keep whatever they had.

- [ ] **Step 3: Verify the file still compiles**

Run: `npx tsc --noEmit --target es2022 --module nodenext --moduleResolution nodenext --strict --skipLibCheck 03_automation/discover_trend_accounts.ts`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add 03_automation/discover_trend_accounts.ts
git commit -m "трендвотч: повторный поиск аккаунтов не выключает watchlist

upsert с onConflict нёс is_active:false — месячное обновление списка
погасило бы все включённые аккаунты. Колонка и так default false."
```

---

### Task 9: Secrets and workflow

Code is now correct and still cannot run in CI: the token it needs is not there.

**Files:**
- Modify: `.github/workflows/sync-trends.yml`

- [ ] **Step 1: Set the missing GitHub secrets**

Values live in the local `.env.local`. Read them from the file so nothing is echoed into the terminal:

```bash
gh secret set APIFY_TOKEN        --body "$(grep -E '^APIFY_TOKEN=' .env.local | cut -d= -f2-)"
gh secret set ANTHROPIC_API_KEY  --body "$(grep -E '^ANTHROPIC_API_KEY=' .env.local | cut -d= -f2-)"
gh secret set BARRYMORE_BOT_TOKEN --body "$(grep -E '^BARRYMORE_BOT_TOKEN=' .env.local | cut -d= -f2-)"
gh secret set BARRYMORE_CHAT_ID  --body "$(grep -E '^BARRYMORE_CHAT_ID=' .env.local | cut -d= -f2-)"
```

Verify the names landed (values are never shown):

```bash
gh secret list
```

Expected: `APIFY_TOKEN`, `ANTHROPIC_API_KEY`, `BARRYMORE_BOT_TOKEN`, `BARRYMORE_CHAT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

- [ ] **Step 2: Drop the dead variable from the workflow**

In `.github/workflows/sync-trends.yml`, delete this line from the `env:` block of the "Sync trend reels" step:

```yaml
          TRENDWATCH_URL:       ${{ secrets.TRENDWATCH_URL }}
```

Nothing reads it any more — the digest links straight to Instagram, and there is no deployed service to open.

- [ ] **Step 3: Run the workflow by hand and read the log**

```bash
gh workflow run sync-trends.yml
sleep 60
gh run list --workflow=sync-trends.yml --limit 1
```

Then read it:

```bash
gh run view "$(gh run list --workflow=sync-trends.yml --limit 1 --json databaseId -q '.[0].databaseId')" --log | grep -iE "monitoring|above threshold|digest|failed|✗|✅"
```

Expected: `Monitoring N account(s)` where N is however many are active, no `token-not-provided`, and either a digest line or `none published in the notify window`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/sync-trends.yml
git commit -m "трендвотч: из воркфлоу убран TRENDWATCH_URL

Сервиса нет, дайджест ведёт прямо в Instagram. Секреты APIFY_TOKEN,
ANTHROPIC_API_KEY, BARRYMORE_BOT_TOKEN, BARRYMORE_CHAT_ID заведены в
GitHub — без них синк падал каждое утро с token-not-provided."
```

---

### Task 10: Populate the watchlist (Phase 0 of the spec)

Operational, not code. Nothing above produces a useful digest until real accounts are active.

- [x] **Step 1: Smoke-test the discovery path on one hashtag** — done 2026-10-01, and it is how we learned the path is dead.

Ran: `npm run discover-accounts -- --hashtags=winestore` → **1 reel**, from an unrelated furniture account. A second probe on `#wine`, one of the largest tags on the platform → **3 reels**. Both against `resultsLimit: 60`, with correct code (same `directUrls: explore/tags/<tag>` + `resultsType: 'reels'` pattern the service uses). Instagram no longer serves hashtag browse pages to the scraper.

- [x] **Step 2: ~~Run the full scan~~ — deliberately NOT run.**

Fourteen hashtags would have cost roughly 40 minutes and up to 840 billed Apify results to return what the two probes above returned. **Do not run `npm run discover-accounts` expecting accounts out of it.** Spec §8 records the measurement.

- [x] **Step 3: Build the watchlist by hand instead** — done 2026-10-01.

The Claude verdicts from the 2026-05-27 run are still in `discover_jobs.candidates`; they judged content format and reproducibility, which does not go stale. What *was* stale were the follower counts, so each account went in with `npm run trends:accounts -- --add <username>`, which reads today's number. Two of the chosen handles no longer resolve at all (`degustandoexperience.it`, `grinsteadsonthevine` — Apify returns an error record), which is itself a reason the May metrics could not be trusted as-is.

- [x] **Step 4: Activate them** — done 2026-10-01: ten active, listed in spec §8.

```bash
npm run trends:accounts -- --on <username1> <username2> ... <username10>
npm run trends:accounts -- --list
```

Expected: `10 active` in the header line.

- [ ] **Step 5: Watch the first real digest**

The Action runs at 09:00 Bangkok. The next morning, check the chat and the run:

```bash
gh run list --workflow=sync-trends.yml --limit 1
```

Expected: green, and either a digest in the chat or an honest "none in the notify window". A red run now means something real — read its log.

- [ ] **Step 6: Put the follower refresh in the calendar**

The multiple is computed from `followers_count`, which only changes when somebody refreshes it.
Since the discovery run that used to do this is dead (Steps 1–2), the tool is
`npm run trends:accounts -- --refresh <username…>`. Run it over the active list every month or
two. Skip it and a **growing** account's multiple drifts upward, letting routine posts through
the threshold — `bodegagoulart_oficial` grew 49% in four months, which would have inflated its
multiple by half.

- [ ] **Step 7: Measure the spend before widening**

After a week of daily runs, open the Apify Console usage page and compare against the $29/month STARTER credit. Only then decide whether to activate more accounts. If it runs hot, `maxPosts` in `scrapeAccount` (currently 10) is the cheapest lever.

---

### Task 11: Documentation

**Files:**
- Modify: `docs/SERVICES.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update the service catalogue**

In `docs/SERVICES.md`, the **trendwatch** row's status cell currently describes a parked tile and an undeployed service. Add to it:

```
Trend collection itself runs daily from `.github/workflows/sync-trends.yml` (`npm run trends`)
and its only output is a Telegram digest via Barrymore — see
`docs/superpowers/specs/2026-10-01-trendwatch-reels-digest-design.md`. The watchlist is
maintained with `npm run trends:accounts`. The web UI stays undeployed.
```

- [ ] **Step 2: Note the new test home**

In `docs/ARCHITECTURE.md`, find the `03_automation/` row of the directory table and append:

```
Pure logic lives in `03_automation/lib/` and is unit-tested with vitest from the repo root (`npm test`).
```

- [ ] **Step 3: Commit**

```bash
git add docs/SERVICES.md docs/ARCHITECTURE.md
git commit -m "docs: трендвотч-дайджест и тесты для 03_automation"
```

---

## Done when

- `npm test` passes from the repo root (44 tests).
- `APIFY_TOKEN= npm run trends -- --dry-run` exits non-zero with a named variable instead of `✅ Done`.
- `gh secret list` shows all six secrets.
- `npm run trends:accounts -- --list` shows about 10 active wine accounts.
- A manually triggered `sync-trends.yml` run is green, and its log shows the accounts being monitored.
- The first digest arrives with thumbnails, or the log honestly says nothing was in the notify window.
