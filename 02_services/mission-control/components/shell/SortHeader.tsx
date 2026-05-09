// Reusable sortable column header for server-rendered tables.
//
// Usage:
//   const sort = parseSort(sp.sort, ['issued_at','number','status'], 'issued_at')
//   const dir  = sp.dir === 'asc' ? 'asc' : 'desc'
//   ...
//   <SortHeader col="issued_at" label="Issued" sort={sort} dir={dir} sp={sp}
//               keep={['tab']} />
//
// The component preserves whatever query params the page wants to keep across
// sort clicks (e.g. ?tab=balance) — pass them via `keep`.
//
// `prefix` lets a single page host multiple independent sort states, by
// namespacing the sort+dir query keys (e.g. `b2b` → `b2bSort`/`b2bDir`).
//
// Click behaviour: clicking the active column flips direction; clicking a
// different column starts at desc (most recent / largest first), which is the
// portal-wide default.

import Link from 'next/link'

export type SortDir = 'asc' | 'desc'

export function parseSort<K extends string>(
  raw: string | undefined,
  allowed: readonly K[],
  fallback: K,
): K {
  return (allowed as readonly string[]).includes(raw ?? '') ? (raw as K) : fallback
}

export function parseDir(raw: string | undefined, fallback: SortDir = 'desc'): SortDir {
  return raw === 'asc' || raw === 'desc' ? raw : fallback
}

function paramKeys(prefix: string) {
  return prefix
    ? { sort: `${prefix}Sort`, dir: `${prefix}Dir` }
    : { sort: 'sort', dir: 'dir' }
}

export function readSortParams<K extends string>(
  sp: Record<string, string | undefined>,
  allowed: readonly K[],
  fallback: K,
  prefix = '',
  fallbackDir: SortDir = 'desc',
): { sort: K; dir: SortDir } {
  const k = paramKeys(prefix)
  return {
    sort: parseSort(sp[k.sort], allowed, fallback),
    dir:  parseDir(sp[k.dir], fallbackDir),
  }
}

export function SortHeader({
  col, label, sort, dir, sp, keep = [], align = 'left', prefix = '', firstDir = 'desc',
}: {
  col: string
  label: string
  sort: string
  dir: SortDir
  sp: Record<string, string | undefined>
  keep?: string[]
  align?: 'left' | 'right'
  prefix?: string
  // Direction the column starts at when clicked from inactive — defaults to
  // desc (newest/largest first), but textual columns can pass 'asc'.
  firstDir?: SortDir
}) {
  const isActive = sort === col
  const nextDir: SortDir = isActive ? (dir === 'asc' ? 'desc' : 'asc') : firstDir
  const k = paramKeys(prefix)
  const params = new URLSearchParams()
  // Preserve the kept params + every other prefix's sort state, so clicking
  // one section's header doesn't clobber sort state on sibling sections.
  for (const key of Object.keys(sp)) {
    const v = sp[key]
    if (!v) continue
    if (key === k.sort || key === k.dir) continue
    if (keep.includes(key) || /Sort$|Dir$/.test(key)) params.set(key, v)
  }
  params.set(k.sort, col)
  params.set(k.dir, nextDir)
  const arrow = !isActive ? '↕' : (dir === 'asc' ? '↑' : '↓')
  return (
    <th className={`py-2 px-4 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <Link
        href={`?${params.toString()}`}
        className={`whitespace-nowrap ${isActive ? 'text-wine-red' : 'text-graphite hover:text-deep-black'}`}
      >
        {label} <span className="opacity-60">{arrow}</span>
      </Link>
    </th>
  )
}

// Generic comparator that handles string, number, date-iso, and null/undefined.
// Use with Array.prototype.sort: rows.sort(cmpBy(r => r.issued_at, dir))
export function cmpBy<T>(get: (row: T) => string | number | null | undefined, dir: SortDir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1
  return (a: T, b: T) => {
    const av = get(a), bv = get(b)
    // nulls go last regardless of direction
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number') return sign * (av - bv)
    return sign * String(av).localeCompare(String(bv))
  }
}
