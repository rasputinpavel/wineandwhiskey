import { describe, it, expect } from 'vitest'
import {
  isHit, isFreshForDigest, multiple, pickDigestReels, type DigestReel,
  formatHeader, formatListLine, formatReelCaption, formatViews, TELEGRAM_CAPTION_LIMIT,
} from './trends'

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

  it('still notifies a reel published exactly 14 days ago', () => {
    // The window is inclusive on purpose — pin it so `<=` cannot quietly become `<`
    expect(isFreshForDigest('2026-09-17T09:00:00Z', now)).toBe(true)
  })

  it('skips a missing or unparseable date', () => {
    expect(isFreshForDigest(null, now)).toBe(false)
    expect(isFreshForDigest('не дата', now)).toBe(false)
  })
})

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

  it('fills the photo group before listing, at 10 and at 11 hits', () => {
    const hits = (n: number) => Array.from({ length: n }, (_, i) =>
      reel({ username: `shop${i}`, followers: 1_000, views: 60_000 + i * 1_000 }))

    const ten = pickDigestReels(hits(10))
    expect([ten.photos.length, ten.listed.length, ten.omitted]).toEqual([5, 5, 0])

    const eleven = pickDigestReels(hits(11))
    expect([eleven.photos.length, eleven.listed.length, eleven.omitted]).toEqual([5, 5, 1])
  })

  it('does not reorder the array it was given', () => {
    const input = [
      reel({ username: 'big', followers: 500_000, views: 3_000_000 }),
      reel({ username: 'small', followers: 4_000, views: 600_000 }),
    ]
    pickDigestReels(input)
    expect(input.map(r => r.username)).toEqual(['big', 'small'])
  })

  it('returns empty groups for no hits', () => {
    expect(pickDigestReels([])).toEqual({ photos: [], listed: [], omitted: 0 })
  })
})

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
