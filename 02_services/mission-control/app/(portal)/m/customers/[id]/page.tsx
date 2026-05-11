import Link from 'next/link'
import { sbInventory, type B2bCustomer } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { SortHeader, parseSort, parseDir, cmpBy, type SortDir } from '@/components/shell/SortHeader'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { InvoiceExcludeCell } from '@/components/modules/customers/InvoiceExcludeCell'
import { fmtDate } from '@/lib/fmt'

export const dynamic = 'force-dynamic'

type Tab = 'invoices' | 'deliveries' | 'balance'
type SearchParams = { tab?: Tab; sort?: string; dir?: string }

export default async function CustomerDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}) {
  const { id }   = await params
  const sp       = await searchParams

  const { data: cust, error: custErr } = await sbInventory
    .from('b2b_customer')
    .select('id, flowaccount_name, payment_terms_days, credit_limit, is_consignment, notes')
    .eq('id', id).maybeSingle()
  if (custErr) return <div className="p-6"><SchemaError error={custErr.message} /></div>
  if (!cust)   return <div className="p-6"><div className="text-graphite">Customer not found.</div></div>
  const c = cust as B2bCustomer

  // Self-heal: if customer is consignment but the location row never got
  // created (e.g. flipped before auto-provision was added), create it now.
  if (c.is_consignment) {
    const { data: loc } = await sbInventory
      .from('consignment_location')
      .select('id').eq('customer_id', id).maybeSingle()
    if (!loc) {
      await sbInventory
        .from('consignment_location')
        .insert({ customer_id: id, name: c.flowaccount_name })
    }
  }

  const tab: Tab = sp.tab && ['invoices','deliveries','balance'].includes(sp.tab) ? sp.tab : 'invoices'

  return (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/m/customers" className="text-xs text-graphite hover:text-wine-red">← Back to customers</Link>
          <h2 className="font-heading text-2xl text-deep-black mt-3">{c.flowaccount_name}</h2>
          <div className="text-xs text-graphite mt-1 mb-5">
            {c.is_consignment ? 'Consignment' : 'Regular'} · Terms {c.payment_terms_days} days
          </div>
        </div>
        <DataFreshness sources={['flowaccount_invoices']} />
      </div>

          {/* Tabs */}
          <nav className="border-b border-pale-stone mb-5 flex gap-1 text-sm">
            <TabLink href={`/m/customers/${id}`} active={tab==='invoices'}>Invoices</TabLink>
            {c.is_consignment && (
              <>
                <TabLink href={`/m/customers/${id}?tab=deliveries`} active={tab==='deliveries'}>Deliveries</TabLink>
                <TabLink href={`/m/customers/${id}?tab=balance`}    active={tab==='balance'}>Balance on location</TabLink>
              </>
            )}
          </nav>

          {tab === 'invoices'   && <InvoicesPanel   customerId={id} termsDays={c.payment_terms_days ?? 0} sp={sp} />}
          {tab === 'deliveries' && c.is_consignment && <DeliveriesPanel customerId={id} sp={sp} />}
          {tab === 'balance'    && c.is_consignment && <BalancePanel    customerId={id} sp={sp} />}

      {!c.is_consignment && tab !== 'invoices' && (
        <div className="text-sm text-graphite">
          Этот клиент Regular. Чтобы появилась вкладка Deliveries — отметь его как Consignment в{' '}
          <Link href="/m/customers" className="text-wine-red hover:underline">списке клиентов</Link>.
        </div>
      )}
    </>
  )
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href}
          className={`px-3 py-1.5 -mb-px border-b-2 transition-colors ${
            active
              ? 'border-wine-red text-wine-red'
              : 'border-transparent text-graphite hover:text-deep-black'
          }`}>
      {children}
    </Link>
  )
}

// ─── Invoices panel (mirror of FA) ──────────────────────────────────────
async function InvoicesPanel({ customerId, termsDays, sp }: { customerId: string; termsDays: number; sp: SearchParams }) {
  const { data, error } = await sbInventory
    .from('flowaccount_invoice')
    .select('id, number, issued_at, due_at, status, total, detail_url, excluded')
    .eq('customer_id', customerId)
    .limit(200)
  if (error) return <SchemaError error={error.message} />
  // ВАЖНО: r.due_at от FlowAccount часто приходит пустой строкой '' (не null),
  // поэтому используем || а не ?? — иначе computedDue остаётся '' и Due
  // отрисовывается как «—».
  let rows = ((data ?? []) as any[]).map(r => ({
    ...r,
    computedDue: r.due_at || (termsDays > 0 && r.issued_at ? addDays(r.issued_at, termsDays) : null),
  }))
  if (rows.length === 0) return <div className="text-sm text-graphite">Инвойсов нет.</div>

  const sort = parseSort(sp.sort, ['number','issued_at','due_at','status','total'] as const, 'issued_at')
  const dir: SortDir = parseDir(sp.dir, 'desc')
  rows = [...rows].sort(cmpBy(r => {
    if (sort === 'total')  return Number(r.total ?? 0)
    if (sort === 'due_at') return (r.computedDue as string | null) ?? '9999-12-31'
    return r[sort] as string
  }, dir))

  return (
    <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
      <table className="w-full text-[13px]">
        <thead className="text-graphite border-b border-pale-stone bg-cream/40">
          <tr>
            <SortHeader col="number"    label="Number" sort={sort} dir={dir} sp={sp} keep={['tab']} />
            <SortHeader col="issued_at" label="Issued" sort={sort} dir={dir} sp={sp} keep={['tab']} />
            <SortHeader col="due_at"    label="Due"    sort={sort} dir={dir} sp={sp} keep={['tab']} />
            <SortHeader col="status"    label="Status" sort={sort} dir={dir} sp={sp} keep={['tab']} />
            <SortHeader col="total"     label="Total"  sort={sort} dir={dir} sp={sp} keep={['tab']} align="right" />
            <th className="text-left py-2 px-4 font-medium text-graphite text-[11px]">Excluded</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className={`border-b border-pale-stone/40 last:border-0 hover:bg-cream/40 ${r.excluded ? 'opacity-50' : ''}`}>
              <td className="py-2 px-4 font-mono">
                {r.detail_url
                  ? <a href={r.detail_url} target="_blank" rel="noopener noreferrer" className="hover:text-wine-red">{r.number}</a>
                  : r.number}
              </td>
              <td className="py-2 px-4">{fmtDate(r.issued_at)}</td>
              <td className="py-2 px-4">{fmtDate(r.computedDue)}</td>
              <td className="py-2 px-4">{r.status}</td>
              <td className="py-2 px-4 text-right tabular-nums">฿{Number(r.total).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
              <td className="py-2 px-4"><InvoiceExcludeCell invoiceId={r.id} initial={r.excluded ?? false} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Deliveries panel (consignment only) ────────────────────────────────
async function DeliveriesPanel({ customerId, sp }: { customerId: string; sp: SearchParams }) {
  // Find the consignment_location id.
  const { data: loc } = await sbInventory
    .from('consignment_location')
    .select('id, name')
    .eq('customer_id', customerId)
    .maybeSingle()
  if (!loc) return <div className="text-sm text-graphite">Точка консигнации ещё не создана. Тогл «Consignment» автосоздаст её.</div>

  const { data, error } = await sbInventory
    .from('delivery_note')
    .select('id, number, issued_at, status, delivery_note_line(qty, unit_price)')
    .eq('location_id', loc.id)
    .limit(200)
  if (error) return <SchemaError error={error.message} />

  let notes = ((data ?? []) as any[]).map(n => {
    const lines = (n.delivery_note_line ?? []) as { qty: number; unit_price: number | null }[]
    return {
      ...n,
      line_count: lines.length,
      total_qty:  lines.reduce((s, l) => s + Number(l.qty || 0), 0),
      total_money: lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unit_price || 0), 0),
    }
  })

  const sort = parseSort(sp.sort, ['number','issued_at','status','line_count','total_qty','total_money'] as const, 'issued_at')
  const dir: SortDir = parseDir(sp.dir, 'desc')
  notes = [...notes].sort(cmpBy(n => {
    if (sort === 'line_count')  return n.line_count
    if (sort === 'total_qty')   return n.total_qty
    if (sort === 'total_money') return n.total_money
    return n[sort] as string
  }, dir))

  return (
    <>
      <div className="flex justify-between items-baseline mb-3">
        <div className="text-xs text-graphite">{notes.length} delivery note(s)</div>
        <Link href={`/m/customers/${customerId}/dn/new`}
              className="text-xs px-3 py-1.5 bg-wine-red hover:bg-burgundy-deep text-warm-white rounded-sm">
          + New delivery note
        </Link>
      </div>
      {notes.length === 0 ? (
        <div className="text-sm text-graphite">
          Пока нет ни одной delivery note. Первая может стать «нулевой инвентаризацией»:
          вбей текущий остаток на точке как первую DN, дальше будут только движения.
        </div>
      ) : (
        <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="text-graphite border-b border-pale-stone bg-cream/40">
              <tr>
                <SortHeader col="number"      label="Number"    sort={sort} dir={dir} sp={sp} keep={['tab']} />
                <SortHeader col="issued_at"   label="Issued"    sort={sort} dir={dir} sp={sp} keep={['tab']} />
                <SortHeader col="status"      label="Status"    sort={sort} dir={dir} sp={sp} keep={['tab']} />
                <SortHeader col="line_count"  label="Lines"     sort={sort} dir={dir} sp={sp} keep={['tab']} align="right" />
                <SortHeader col="total_qty"   label="Total qty" sort={sort} dir={dir} sp={sp} keep={['tab']} align="right" />
                <SortHeader col="total_money" label="Total ฿"   sort={sort} dir={dir} sp={sp} keep={['tab']} align="right" />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {notes.map(n => (
                <tr key={n.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                  <td className="py-2 px-4 font-mono">{n.number}</td>
                  <td className="py-2 px-4">{fmtDate(n.issued_at)}</td>
                  <td className="py-2 px-4">{n.status}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{n.line_count}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{n.total_qty}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{n.total_money ? `฿${n.total_money.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}</td>
                  <td className="py-2 px-4 text-right">
                    <Link href={`/print/dn/${n.id}`} target="_blank" className="text-xs text-graphite hover:text-wine-red">
                      Print ↗
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ─── Balance panel — derived from v_consignment_balance ─────────────────
async function BalancePanel({ customerId, sp }: { customerId: string; sp: SearchParams }) {
  const { data: loc } = await sbInventory
    .from('consignment_location')
    .select('id, name')
    .eq('customer_id', customerId)
    .maybeSingle()
  if (!loc) return <div className="text-sm text-graphite">Точка консигнации ещё не создана.</div>

  const { data, error } = await sbInventory
    .from('v_consignment_balance')
    .select('sku_id, qty, sku(name, loyverse_product_code, category)')
    .eq('location_id', loc.id)
  if (error) return <SchemaError error={error.message} />
  let rows = ((data ?? []) as any[]).filter(r => r.qty > 0)

  if (rows.length === 0) {
    return <div className="text-sm text-graphite">Сейчас на точке ничего не лежит.</div>
  }

  // Balance has no date column, so default to Name asc.
  const sort = parseSort(sp.sort, ['code','name','category','qty'] as const, 'name')
  const dir: SortDir = parseDir(sp.dir, sort === 'qty' ? 'desc' : 'asc')
  rows = [...rows].sort(cmpBy(r => {
    if (sort === 'code')     return r.sku?.loyverse_product_code ?? ''
    if (sort === 'name')     return r.sku?.name ?? ''
    if (sort === 'category') return r.sku?.category ?? ''
    return Number(r.qty)
  }, dir))

  const totalQty = rows.reduce((s, r) => s + Number(r.qty || 0), 0)

  return (
    <>
      <div className="text-xs text-graphite mb-3">
        {rows.length} SKU · <span className="text-deep-black tabular-nums font-medium">{totalQty}</span> bottles total ·
        derived from delivery notes minus paid invoice lines
      </div>
      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <SortHeader col="code"     label="Code"     sort={sort} dir={dir} sp={sp} keep={['tab']} />
              <SortHeader col="name"     label="Name"     sort={sort} dir={dir} sp={sp} keep={['tab']} />
              <SortHeader col="category" label="Category" sort={sort} dir={dir} sp={sp} keep={['tab']} />
              <SortHeader col="qty"      label="Qty"      sort={sort} dir={dir} sp={sp} keep={['tab']} align="right" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.sku_id}`} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                <td className="py-2 px-4 font-mono text-graphite">{r.sku?.loyverse_product_code ?? '—'}</td>
                <td className="py-2 px-4">
                  {r.sku?.loyverse_product_code ? (
                    <Link href={`/m/inventory/sku/${encodeURIComponent(r.sku.loyverse_product_code)}`} className="hover:text-wine-red">{r.sku?.name}</Link>
                  ) : r.sku?.name}
                </td>
                <td className="py-2 px-4 text-graphite">{r.sku?.category ?? '—'}</td>
                <td className="py-2 px-4 text-right tabular-nums">{Number(r.qty).toLocaleString('en-US')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
