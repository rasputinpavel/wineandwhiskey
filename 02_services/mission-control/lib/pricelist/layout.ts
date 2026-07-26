import type { LineItem, PageSettings, Row, Page } from './types'
import { PLAQUE_LABELS } from './plaques'

// ─── Grouping ────────────────────────────────────────────────────────────
type Group = { label: string; items: LineItem[] }

function groupItems(items: LineItem[], s: PageSettings): Group[] {
  const g = s.grouping
  if (g === 'manual' || g === 'curated') return [{ label: '', items }]

  const keyOf = (it: LineItem): string => {
    switch (g) {
      case 'producer': return it.producer || 'Other'
      case 'type':     return PLAQUE_LABELS[it.zone]
      case 'region':   return it.region || it.country || 'Other'
      case 'grape':    return it.grape || 'Other'
      case 'tier':     return tierLabel(it.price, s.tierThresholds)
      default:         return ''
    }
  }

  const order: string[] = []
  const map = new Map<string, LineItem[]>()
  for (const it of items) {
    const k = keyOf(it)
    if (!map.has(k)) { map.set(k, []); order.push(k) }
    map.get(k)!.push(it)
  }
  return order.map(label => ({ label, items: map.get(label)! }))
}

function tierLabel(price: number | null, thresholds: number[]): string {
  const p = price ?? 0
  const sorted = [...thresholds].sort((a, b) => a - b)
  let lo = 0
  for (const t of sorted) {
    if (p < t) return `฿${lo || 0}–${t}`
    lo = t
  }
  return `฿${lo}+`
}

// ─── Row packing within one group ──────────────────────────────────────────
function packGroup(items: LineItem[], s: PageSettings): Row[] {
  const rows: Row[] = []
  let i = 0
  while (i < items.length) {
    const a = items[i]
    if (a.rowLayout === 'solo-wide') {
      rows.push({ kind: 'solo-wide', item: a }); i += 1; continue
    }
    const b = items[i + 1]
    if (!b) {
      // trailing odd item
      if (s.oddItemMode === 'solo-wide') rows.push({ kind: 'solo-wide', item: a })
      else rows.push({ kind: 'pair', items: [a, null as unknown as LineItem] })
      i += 1; continue
    }
    if (b.rowLayout === 'solo-wide') {
      // a alone, then b handled next loop
      rows.push({ kind: 'solo-wide', item: a }); i += 1; continue
    }
    rows.push({ kind: 'pair', items: [a, b] }); i += 2
  }
  return rows
}

// ─── Pagination ─────────────────────────────────────────────────────────────
// A divider counts as 0 cards; pair = 2, solo-wide = 1. Never end a page on a
// divider — push it to the next page with its following row.
function paginate(rows: Row[], cardsPerPage: number): Page[] {
  const pages: Page[] = []
  let cur: Row[] = []
  let count = 0
  // A `tight` odd row is a pair with an empty second slot → counts as 1 card.
  const cardCost = (r: Row) => (r.kind === 'pair' ? (r.items[1] ? 2 : 1) : r.kind === 'solo-wide' ? 1 : 0)

  for (const r of rows) {
    const cost = cardCost(r)
    if (count + cost > cardsPerPage && cur.length) {
      pages.push({ rows: cur }); cur = []; count = 0
    }
    cur.push(r); count += cost
  }
  if (cur.length) pages.push({ rows: cur })

  // Guard: if any page ends on a divider, move it to the next page's front.
  for (let p = 0; p < pages.length - 1; p++) {
    const rowsP = pages[p].rows
    while (rowsP.length && rowsP[rowsP.length - 1].kind === 'divider') {
      const d = rowsP.pop()!
      pages[p + 1].rows.unshift(d)
    }
  }
  // Last page ending on a divider = a group with no items; drop it.
  const last = pages[pages.length - 1]?.rows
  while (last && last.length && last[last.length - 1].kind === 'divider') last.pop()

  return pages.filter(p => p.rows.length)
}

// ─── Public entry ────────────────────────────────────────────────────────────
export function buildPages(items: LineItem[], s: PageSettings): Page[] {
  const groups = groupItems(items, s)
  const rows: Row[] = []
  for (const grp of groups) {
    if (s.showDividers && grp.label) rows.push({ kind: 'divider', label: grp.label })
    rows.push(...packGroup(grp.items, s))
  }
  return paginate(rows, s.cardsPerPage)
}
