import Link from 'next/link'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { sbSales } from '@/lib/supabase'
import {
  LEAD_STAGES, LEAD_STAGE_LABEL, ACTIVE_PIPELINE_STAGES,
  type Lead,
} from '@/lib/sales/types'
import { BUSINESS_KINDS, BUSINESS_KIND_LABEL, PHUKET_DISTRICTS, type BusinessKind } from '@/lib/sales/config'
import { LeadsTableClient } from '@/components/modules/sales/LeadsTableClient'

export const dynamic = 'force-dynamic'

type SearchParams = {
  stage?: string
  kind?: BusinessKind
  district?: string
  q?: string
  view?: 'table' | 'kanban'
}

export default async function SalesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const item = findItem('sales-crm')!

  // Compose query.
  let query = sbSales
    .from('lead')
    .select('*')
    .order('updated_at', { ascending: false })

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

  const leads = (data ?? []) as Lead[]

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
          <Link
            href="/m/sales/scrape"
            className="text-xs px-3 py-1.5 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep transition-colors"
          >
            New scrape ↗
          </Link>
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

          {/* Secondary filters */}
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
            <span className="text-graphite ml-3">District:</span>
            <form action="/m/sales" method="get" className="inline-flex items-center gap-1">
              <input type="hidden" name="stage" value={sp.stage ?? ''} />
              <input type="hidden" name="kind" value={sp.kind ?? ''} />
              <select name="district" defaultValue={sp.district ?? ''} className="text-xs border border-pale-stone bg-warm-white rounded-sm px-1.5 py-0.5">
                <option value="">All</option>
                {PHUKET_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input name="q" defaultValue={sp.q ?? ''} placeholder="Search name…" className="text-xs border border-pale-stone bg-warm-white rounded-sm px-2 py-0.5 w-40" />
              <button type="submit" className="text-xs px-2 py-0.5 border border-pale-stone hover:border-wine-red hover:text-wine-red rounded-sm">Apply</button>
            </form>
          </div>

          <LeadsTableClient leads={leads as Lead[]} />
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

