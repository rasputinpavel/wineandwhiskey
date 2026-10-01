import { describe, it, expect } from 'vitest'
import { SECTIONS, type Item } from './registry'

const allItems = (): Item[] =>
  SECTIONS.flatMap(s => s.items)

const outboundHref = (item: Item): string | null =>
  item.embed.kind === 'external' ? item.embed.href :
  item.embed.kind === 'iframe'   ? item.embed.src :
  null

describe('registry outbound links', () => {
  // A *.up.railway.app host only answers for a service we actually deployed.
  // Linking one from a tile that isn't live sends staff to a 404 — or, as with
  // trendwatch-production.up.railway.app, to a stranger's app that claimed the
  // free domain while ours was never pushed.
  it('never points a non-live tile at one of our Railway hosts', () => {
    const offenders = allItems()
      .filter(i => i.status !== 'live')
      .map(i => ({ slug: i.slug, href: outboundHref(i) }))
      .filter(x => x.href?.includes('.up.railway.app'))
      .map(x => `${x.slug} → ${x.href}`)

    expect(offenders).toEqual([])
  })
})
