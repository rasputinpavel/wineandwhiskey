import Link from 'next/link'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { sbSales } from '@/lib/supabase'
import {
  LEAD_STAGES, LEAD_STAGE_LABEL, ACTIVE_PIPELINE_STAGES,
  type Lead, isStale,
} from '@/lib/sales/types'
import { BUSINESS_KINDS, BUSINESS_KIND_LABEL, PHUKET_DISTRICTS, type BusinessKind } from '@/lib/sales/config'
import { LeadsTableClient } from '@/components/modules/sales/LeadsTableClient'
import { LeadsKanbanClient } from '@/components/modules/sales/LeadsKanbanClient'
import { parseSort, parseDir, type SortDir } from '@/components/shell/SortHeader'

export const dynamic = 'force-dynamic'

const SORT_COLS = [
  'name', 'rating', 'reviews_count', 'last_contact_at',
  'created_at', 'updated_at', 'district', 'stage',
] as const
export type SalesSortCol = (typeof SORT_COLS)[number]

type SearchParams = {
  stage?: string
  kind?: BusinessKind
  district?: string
  q?: string
  view?: 'table' | 'kanban'
  sort?: string
  dir?: 'asc' | 'desc'
  minRating?: string
  minReviews?: string
  stale?: '1'
  hasWebsite?: '1'
  hasPhone?: '1'
  hasMenu?: '1'
  // Multiple checkboxes → Next.js gives us string | string[] depending on how
  // many were checked.
  priceLevel?: string | string[]
}

const PRICE_LEVELS = ['$', '$$', '$$$', '$$$$'] as const

export default async function SalesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const item = findItem('sales-crm')!
  const view: 'table' | 'kanban' = sp.view === 'kanban' ? 'kanban' : 'table'
  const sort: SalesSortCol = parseSort(sp.sort, SORT_COLS, 'updated_at')
  const dir: SortDir = parseDir(sp.dir, 'desc')

  // Compose query — sort respects URL params; filters narrow before fetch.
  let query = sbSales
    .from('lead')
    .select('*')
    .order(sort, { ascending: dir === 'asc', nullsFirst: false })

  if (sp.stage && (LEAD_STAGES as readonly string[]).includes(sp.stage)) {
    query = query.eq('stage', sp.stage)
  }
  if (sp.kind && (BUSINESS_KINDS as readonly string[]).includes(sp.kind)) {
    query = query.eq('business_kind', sp.kind)
  }
  if (sp.district) {
    query = query.eq('district', sp.district)
  }
  if (sp.q) {
    query = query.ilike('name', `%${sp.q}%`)
  }
  if (sp.minRating) {
    const r = parseFloat(sp.minRating)
    if (!isNaN(r)) query = query.gte('rating', r)
  }
  if (sp.minReviews) {
    const n = parseInt(sp.minReviews)
    if (!isNaN(n)) query = query.gte('reviews_count', n)
  }
  if (sp.hasWebsite === '1') query = query.not('website',  'is', null)
  if (sp.hasPhone   === '1') query = query.not('phone',    'is', null)
  if (sp.hasMenu    === '1') query = query.not('menu_url', 'is', null)

  // Price level — exact-match on Google's $..$$$$ indicator. Apify also returns
  // the rarer "$10-20"-style brackets; those won't match here, which is fine
  // because the indicator-style ones are what the filter is meant to bucket.
  const priceLevels = normalizePriceLevels(sp.priceLevel)
  if (priceLevels.length > 0) query = query.in('price_level', priceLevels)

  const { data, error } = await query.limit(500)
  if (error) {
    return (
      <>
        <PaneHeader item={item} />
        <div className="p-6 text-sm">
          <div className="bg-wine-red/10 border border-wine-red/40 text-wine-red rounded-md p-4">
            <div className="font-medium">Failed to load leads</div>
            <div className="mt-1 text-xs">{error.message}</div>
            <div className="mt-2 text-xs text-graphite">
              Likely the <code>013_sales_crm.sql</code> migration hasn’t run on Supabase, or the <code>sales</code> schema isn’t listed under Exposed schemas.
            </div>
          </div>
        </div>
      </>
    )
  }

  let leads = (data ?? []) as Lead[]
  // stale filter is a derived check across last_contact_at / first_taken_at /
  // created_at + stage membership — easier client-side than in PostgREST.
  if (sp.stale === '1') leads = leads.filter(l => isStale(l, 5))

  // Counts for filter chips.
  const counts: Record<string, number> = { all: leads.length }
  for (const s of LEAD_STAGES) counts[s] = 0
  let staleCount = 0
  const now = new Date()
  for (const l of leads) {
    counts[l.stage]++
    if (ACTIVE_PIPELINE_STAGES.includes(l.stage)) {
      const since = l.last_contact_at ?? l.first_taken_at ?? l.created_at
      const d = since ? Math.floor((now.getTime() - new Date(since).getTime()) / 86400000) : 0
      if (d > 5) staleCount++
    }
  }

  return (
    <>
      <PaneHeader
        item={item}
        rightSlot={
          <div className="flex items-center gap-2">
            <div className="flex border border-pale-stone rounded-sm overflow-hidden">
              <Link
                href={makeHref(sp, { view: undefined })}
                className={view === 'table' ? 'text-xs px-3 py-1.5 bg-deep-black text-warm-white' : 'text-xs px-3 py-1.5 text-graphite hover:text-wine-red'}
              >Table</Link>
              <Link
                href={makeHref(sp, { view: 'kanban' })}
                className={view === 'kanban' ? 'text-xs px-3 py-1.5 bg-deep-black text-warm-white' : 'text-xs px-3 py-1.5 text-graphite hover:text-wine-red'}
              >Kanban</Link>
            </div>
            <Link
              href="/m/sales/new"
              className="text-xs px-3 py-1.5 border border-pale-stone hover:border-wine-red hover:text-wine-red text-graphite rounded-sm"
            >
              + Add lead
            </Link>
            <Link
              href="/m/sales/scrape"
              className="text-xs px-3 py-1.5 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep transition-colors"
            >
              New scrape ↗
            </Link>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto bg-warm-white">
        <div className="px-6 py-5 space-y-4">

          {staleCount > 0 && (
            <div className="text-xs bg-wine-red/8 border border-wine-red/30 text-wine-red rounded-sm px-3 py-2">
              {staleCount} {staleCount === 1 ? 'lead' : 'leads'} without contact for more than 5 days
            </div>
          )}

          {/* Stage filter row */}
          <div className="flex flex-wrap gap-2">
            <FilterPill href={makeHref(sp, { stage: undefined })} active={!sp.stage} label="All" count={counts.all} />
            {LEAD_STAGES.map(s => (
              <FilterPill key={s}
                href={makeHref(sp, { stage: s })}
                active={sp.stage === s}
                label={LEAD_STAGE_LABEL[s]}
                count={counts[s] ?? 0}
              />
            ))}
          </div>

          {/* Kind filter pills */}
          <div className="flex flex-wrap gap-2 items-center text-xs">
            <span className="text-graphite">Kind:</span>
            <FilterPill href={makeHref(sp, { kind: undefined })} active={!sp.kind} label="All" />
            {BUSINESS_KINDS.map(k => (
              <FilterPill key={k}
                href={makeHref(sp, { kind: k as BusinessKind })}
                active={sp.kind === k}
                label={BUSINESS_KIND_LABEL[k]}
              />
            ))}
          </div>

          {/* Advanced filters — one GET form so every filter applies on Apply.
              Hidden inputs preserve pill-row selections (stage/kind) and view/sort. */}
          <form action="/m/sales" method="get" className="flex flex-wrap items-center gap-2 text-xs bg-cream/30 border border-pale-stone rounded-sm px-3 py-2">
            <input type="hidden" name="stage" value={sp.stage ?? ''} />
            <input type="hidden" name="kind"  value={sp.kind ?? ''} />
            <input type="hidden" name="view"  value={sp.view ?? ''} />
            <input type="hidden" name="sort"  value={sp.sort ?? ''} />
            <input type="hidden" name="dir"   value={sp.dir ?? ''} />

            <span className="text-graphite">District</span>
            <select name="district" defaultValue={sp.district ?? ''} className="border border-pale-stone bg-warm-white rounded-sm px-1.5 py-0.5">
              <option value="">All</option>
              {PHUKET_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            <span className="text-graphite ml-1">Min ★</span>
            <input type="number" step="0.1" min="0" max="5" name="minRating" defaultValue={sp.minRating ?? ''}
              placeholder="—" className="w-14 border border-pale-stone bg-warm-white rounded-sm px-1.5 py-0.5" />

            <span className="text-graphite ml-1">Min reviews</span>
            <input type="number" min="0" name="minReviews" defaultValue={sp.minReviews ?? ''}
              placeholder="—" className="w-16 border border-pale-stone bg-warm-white rounded-sm px-1.5 py-0.5" />

            <span className="text-graphite ml-2">Price</span>
            {PRICE_LEVELS.map(p => (
              <label key={p} className="flex items-center gap-1 text-graphite">
                <input
                  type="checkbox"
                  name="priceLevel"
                  value={p}
                  defaultChecked={normalizePriceLevels(sp.priceLevel).includes(p)}
                  className="accent-wine-red"
                />
                {p}
              </label>
            ))}

            <label className="flex items-center gap-1 ml-2 text-graphite">
              <input type="checkbox" name="stale" value="1" defaultChecked={sp.stale === '1'} className="accent-wine-red" />
              Stale &gt;5d
            </label>
            <label className="flex items-center gap-1 text-graphite">
              <input type="checkbox" name="hasWebsite" value="1" defaultChecked={sp.hasWebsite === '1'} className="accent-wine-red" />
              has site
            </label>
            <label className="flex items-center gap-1 text-graphite">
              <input type="checkbox" name="hasPhone" value="1" defaultChecked={sp.hasPhone === '1'} className="accent-wine-red" />
              has phone
            </label>
            <label className="flex items-center gap-1 text-graphite">
              <input type="checkbox" name="hasMenu" value="1" defaultChecked={sp.hasMenu === '1'} className="accent-wine-red" />
              has menu
            </label>

            <input name="q" defaultValue={sp.q ?? ''} placeholder="Search name…"
              className="ml-auto border border-pale-stone bg-warm-white rounded-sm px-2 py-0.5 w-full md:w-48" />
            <button type="submit" className="px-3 py-0.5 bg-deep-black text-warm-white rounded-sm">Apply</button>
            {hasActiveFilter(sp) && (
              <a href="/m/sales" className="text-graphite hover:text-wine-red">clear</a>
            )}
          </form>

          {view === 'kanban'
            ? <LeadsKanbanClient leads={leads as Lead[]} />
            : <LeadsTableClient leads={leads as Lead[]} sp={sp} sort={sort} dir={dir} />}
        </div>
      </div>
    </>
  )
}

function FilterPill({ href, active, label, count }: { href: string; active: boolean; label: string; count?: number }) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'text-xs px-2.5 py-1 rounded-sm bg-deep-black text-warm-white'
          : 'text-xs px-2.5 py-1 rounded-sm bg-cream/40 border border-pale-stone text-graphite hover:border-wine-red hover:text-wine-red'
      }
    >
      {label}{count !== undefined && <span className="opacity-60 ml-1">{count}</span>}
    </Link>
  )
}

function makeHref(sp: SearchParams, override: Partial<SearchParams>): string {
  const next: Record<string, string> = {}
  const merged = { ...sp, ...override }
  for (const [k, v] of Object.entries(merged)) {
    if (v) next[k] = String(v)
  }
  const qs = new URLSearchParams(next).toString()
  return qs ? `/m/sales?${qs}` : '/m/sales'
}

function hasActiveFilter(sp: SearchParams): boolean {
  return Boolean(
    sp.district || sp.q || sp.minRating || sp.minReviews
    || sp.stale === '1' || sp.hasWebsite === '1' || sp.hasPhone === '1' || sp.hasMenu === '1'
    || normalizePriceLevels(sp.priceLevel).length > 0
  )
}

function normalizePriceLevels(raw: string | string[] | undefined): string[] {
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  return arr.filter(v => (PRICE_LEVELS as readonly string[]).includes(v))
}

