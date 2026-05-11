import Link from 'next/link'
import { sbInventory, type B2bCustomer, type B2bCustomerGroup } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { BulkTermsCell } from '@/components/modules/customers/BulkTermsCell'
import { AutoMatchButton } from '@/components/modules/customers/AutoMatchButton'
import { CustomersTableClient, type CustomerRow, type GroupRow, type Stats } from '@/components/modules/customers/CustomersTableClient'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { SortHeader } from '@/components/shell/SortHeader'

export const dynamic = 'force-dynamic'

type SortKey = 'name' | 'type' | 'terms' | 'open' | 'overdue' | 'this_year' | 'last_year' | 'invoices'
const SORT_KEYS: SortKey[] = ['name', 'type', 'terms', 'open', 'overdue', 'this_year', 'last_year', 'invoices']

type SearchParams = {
  type?: 'all' | 'regular' | 'consignment'
  sort?: SortKey
  dir?: 'asc' | 'desc'
}

type CustomerStats = {
  open: number
  overdue: number
  openCount: number
  thisYearTotal: number
  thisYearCount: number
  lastYearTotal: number
  lastYearCount: number
}

const EMPTY_STATS: CustomerStats = {
  open: 0, overdue: 0, openCount: 0,
  thisYearTotal: 0, thisYearCount: 0,
  lastYearTotal: 0, lastYearCount: 0,
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const typeFilter: SearchParams['type'] = sp.type ?? 'all'
  const sort: SortKey = SORT_KEYS.includes(sp.sort as SortKey) ? (sp.sort as SortKey) : 'name'
  const dir = sp.dir === 'desc' ? 'desc' : 'asc'

  const today = new Date()
  const todayISO = today.toISOString().slice(0, 10)
  const thisYear = today.getUTCFullYear()
  const lastYear = thisYear - 1

  const [custRes, groupRes] = await Promise.all([
    sbInventory
      .from('b2b_customer')
      .select('id, flowaccount_name, payment_terms_days, credit_limit, is_consignment, notes, group_id, loyverse_customer_id')
      .order('flowaccount_name'),
    sbInventory
      .from('b2b_customer_group')
      .select('id, name, notes')
      .order('name'),
  ])
  if (custRes.error)  return <div className="p-6"><SchemaError error={custRes.error.message} /></div>
  if (groupRes.error) return <div className="p-6"><SchemaError error={groupRes.error.message} /></div>

  const all = (custRes.data ?? []) as B2bCustomer[]
  const allGroups = (groupRes.data ?? []) as B2bCustomerGroup[]
  const termsByCustomer = new Map(all.map(c => [c.id, c.payment_terms_days ?? 0]))

  const { data: allInv, error: invErr } = await sbInventory
    .from('flowaccount_invoice')
    .select('customer_id, total, issued_at, status')
    .neq('status', 'Cancelled')
  if (invErr) {
    return <div className="p-6"><SchemaError error={invErr.message} /></div>
  }

  // Loyverse receipts по B2B-клиентам — добавляем к YTD/Last year (но НЕ к Open/Overdue,
  // там только FA-долги, потому что Loyverse платежи всегда мгновенные).
  const { data: lvReceipts } = await sbInventory
    .from('loyverse_receipt')
    .select('customer_id, total, receipt_date, receipt_type')
    .gte('receipt_date', `${lastYear}-01-01`)
  const lvByCustomer = new Map<string, { ytd: number; ly: number; ytdCount: number; lyCount: number }>()
  for (const r of (lvReceipts ?? []) as any[]) {
    if (!r.customer_id) continue
    const sign = r.receipt_type === 'REFUND' ? -1 : 1
    const total = Number(r.total) * sign
    const yr = String(r.receipt_date).slice(0, 4)
    const cur = lvByCustomer.get(r.customer_id) ?? { ytd: 0, ly: 0, ytdCount: 0, lyCount: 0 }
    if (yr === String(thisYear)) { cur.ytd += total; if (sign > 0) cur.ytdCount++ }
    if (yr === String(lastYear)) { cur.ly  += total; if (sign > 0) cur.lyCount++ }
    lvByCustomer.set(r.customer_id, cur)
  }

  // FA → b2b_customer.id (id b2b), Loyverse → loyverse_customer_id. Mapping:
  const lvIdByCustomer = new Map<string, string>(all.filter(c => c.loyverse_customer_id).map(c => [c.id, c.loyverse_customer_id as string]))

  const stats = new Map<string, CustomerStats>()
  function bucket(id: string): CustomerStats {
    let s = stats.get(id)
    if (!s) { s = { ...EMPTY_STATS }; stats.set(id, s) }
    return s
  }
  for (const inv of (allInv ?? []) as any[]) {
    if (!inv.customer_id) continue
    const b = bucket(inv.customer_id)
    const total = Number(inv.total)
    const year = inv.issued_at?.slice(0, 4)
    if (year === String(thisYear)) { b.thisYearTotal += total; b.thisYearCount++ }
    if (year === String(lastYear)) { b.lastYearTotal += total; b.lastYearCount++ }
    if (inv.status === 'Paid') continue
    const terms = termsByCustomer.get(inv.customer_id) ?? 0
    const dueAt = computeDue(inv.issued_at, terms)
    const isOverdue = !!dueAt && dueAt < todayISO
    b.openCount++
    if (isOverdue) b.overdue += total; else b.open += total
  }
  // Подмешиваем Loyverse-цифры по customer'ам с linked loyverse_customer_id
  for (const c of all) {
    if (!c.loyverse_customer_id) continue
    const lv = lvByCustomer.get(c.loyverse_customer_id)
    if (!lv) continue
    const b = bucket(c.id)
    b.thisYearTotal += lv.ytd
    b.thisYearCount += lv.ytdCount
    b.lastYearTotal += lv.ly
    b.lastYearCount += lv.lyCount
  }

  let rows = all
  if (typeFilter === 'regular')     rows = rows.filter(c => !c.is_consignment)
  if (typeFilter === 'consignment') rows = rows.filter(c =>  c.is_consignment)

  // ── Преобразование customer → CustomerRow (для клиентского компонента) ──
  function toRow(c: B2bCustomer): CustomerRow {
    const s = stats.get(c.id) ?? EMPTY_STATS
    return {
      id: c.id,
      name: c.flowaccount_name,
      isConsignment: c.is_consignment,
      paymentTermsDays: c.payment_terms_days,
      groupId: c.group_id,
      stats: { ...s } as Stats,
    }
  }

  // ── Сборка групп и standalone ──────────────────────────────────────────
  const membersByGroup = new Map<string, B2bCustomer[]>()
  for (const c of rows) {
    if (!c.group_id) continue
    const arr = membersByGroup.get(c.group_id) ?? []
    arr.push(c)
    membersByGroup.set(c.group_id, arr)
  }

  // Группа aggregate-stats = сумма stats её members.
  function aggregateOver(customers: B2bCustomer[]): Stats {
    const agg: Stats = { open: 0, overdue: 0, thisYearTotal: 0, thisYearCount: 0, lastYearTotal: 0, lastYearCount: 0 }
    for (const c of customers) {
      const s = stats.get(c.id) ?? EMPTY_STATS
      agg.open          += s.open
      agg.overdue       += s.overdue
      agg.thisYearTotal += s.thisYearTotal
      agg.thisYearCount += s.thisYearCount
      agg.lastYearTotal += s.lastYearTotal
      agg.lastYearCount += s.lastYearCount
    }
    return agg
  }

  const groupRows: GroupRow[] = allGroups
    .map(g => {
      const members = (membersByGroup.get(g.id) ?? [])
        .slice()
        .sort((a, b) => a.flowaccount_name.localeCompare(b.flowaccount_name))
      return { id: g.id, name: g.name, members: members.map(toRow), agg: aggregateOver(members) }
    })
    .filter(g => g.members.length > 0) // не показываем пустые группы

  const standalone = rows.filter(c => !c.group_id).map(toRow)

  // Sort — общий порядок (группы и standalone сортируются по той же колонке).
  // Группы используют aggregate stats, standalone — свои.
  function sortKey(g: { name: string; agg?: Stats; row?: CustomerRow }): number | string {
    const s = g.agg ?? g.row!.stats
    switch (sort) {
      case 'name':      return g.name.toLowerCase()
      case 'type':      return g.row?.isConsignment ? 1 : 0
      case 'terms':     return g.row?.paymentTermsDays ?? 0
      case 'open':      return s.open
      case 'overdue':   return s.overdue
      case 'this_year': return s.thisYearTotal
      case 'last_year': return s.lastYearTotal
      case 'invoices':  return s.thisYearCount + s.lastYearCount
    }
  }
  const cmp = (a: number | string, b: number | string) => (a < b ? -1 : a > b ? 1 : 0) * (dir === 'asc' ? 1 : -1)
  groupRows.sort((a, b) => cmp(sortKey({ name: a.name, agg: a.agg }), sortKey({ name: b.name, agg: b.agg })))
  standalone.sort((a, b) => cmp(sortKey({ name: a.name, row: a }), sortKey({ name: b.name, row: b })))

  const counts = {
    all: all.length,
    regular: all.filter(c => !c.is_consignment).length,
    consignment: all.filter(c => c.is_consignment).length,
  }

  return (
    <>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">B2B Customers</h2>
        <DataFreshness sources={['flowaccount_invoices']} />
      </div>
      <p className="text-graphite text-sm mb-4 max-w-3xl">
        Условия оплаты и пометка «consignment» задаются здесь. Используются на вкладке{' '}
        <a href="/m/customers/outstanding" className="text-wine-red hover:underline">Outstanding Invoices</a>{' '}
        для расчёта <code className="font-mono text-xs">due = issued + terms</code>.
        Колонки <span className="text-deep-black">{thisYear} YTD</span> и{' '}
        <span className="text-deep-black">{lastYear} total</span> — суммы всех инвойсов кроме Cancelled.
      </p>

          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex gap-1 text-xs">
              {(['all', 'regular', 'consignment'] as const).map(k => {
                const active = typeFilter === k
                const params = new URLSearchParams()
                if (k !== 'all') params.set('type', k)
                if (sp.sort) params.set('sort', sp.sort)
                if (sp.dir)  params.set('dir',  sp.dir)
                const qs = params.toString()
                return (
                  <Link key={k}
                    href={qs ? `/m/customers?${qs}` : '/m/customers'}
                    className={`px-3 py-1.5 rounded-sm border transition-colors ${
                      active
                        ? 'bg-wine-red text-warm-white border-wine-red'
                        : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
                    }`}>
                    {k === 'all' ? 'All' : k === 'regular' ? 'Regular' : 'Consignment'}
                    <span className={`ml-1.5 ${active ? 'opacity-80' : 'text-graphite/60'}`}>
                      {counts[k]}
                    </span>
                  </Link>
                )
              })}
            </div>
            <BulkTermsCell endpoint="/api/m/customers/bulk-terms" defaultDays={30} />
            <AutoMatchButton />
          </div>

          <CustomersTableClient
            groups={groupRows}
            standalone={standalone}
            thisYear={thisYear}
            lastYear={lastYear}
            sortHeaders={<>
              <SortHeader col="name"      label="Customer"            sort={sort} dir={dir} sp={sp} keep={['type']} firstDir="asc" />
              <SortHeader col="type"      label="Type"                sort={sort} dir={dir} sp={sp} keep={['type']} firstDir="asc" />
              <SortHeader col="terms"     label="Terms"               sort={sort} dir={dir} sp={sp} keep={['type']} firstDir="asc" />
              <SortHeader col="open"      label="Open"                sort={sort} dir={dir} sp={sp} keep={['type']} align="right" />
              <SortHeader col="overdue"   label="Overdue"             sort={sort} dir={dir} sp={sp} keep={['type']} align="right" />
              <SortHeader col="this_year" label={`${thisYear} YTD`}   sort={sort} dir={dir} sp={sp} keep={['type']} align="right" />
              <SortHeader col="last_year" label={`${lastYear} total`} sort={sort} dir={dir} sp={sp} keep={['type']} align="right" />
              <SortHeader col="invoices"  label={`Inv (${thisYear}/${lastYear})`} sort={sort} dir={dir} sp={sp} keep={['type']} align="right" />
            </>}
          />
    </>
  )
}

function computeDue(issuedAt: string | null | undefined, terms: number | null | undefined): string | null {
  if (!issuedAt || !terms || terms <= 0) return null
  const d = new Date(issuedAt)
  d.setUTCDate(d.getUTCDate() + terms)
  return d.toISOString().slice(0, 10)
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
