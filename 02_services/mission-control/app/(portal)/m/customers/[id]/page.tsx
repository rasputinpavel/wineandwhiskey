import Link from 'next/link'
import { sbInventory, type B2bCustomer } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { SortHeader, parseSort, parseDir, cmpBy, type SortDir } from '@/components/shell/SortHeader'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { InvoiceExcludeCell } from '@/components/modules/customers/InvoiceExcludeCell'
import { CustomerLoyverseCell } from '@/components/modules/customers/CustomerLoyverseCell'
import { DeliveryRowActions } from '@/components/modules/customers/DeliveryRowActions'
import { fmtDate } from '@/lib/fmt'

export const dynamic = 'force-dynamic'

type Tab = 'invoices' | 'loyverse' | 'deliveries' | 'balance'
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
    .select('id, flowaccount_name, brand_name, payment_terms_days, credit_limit, is_consignment, notes, loyverse_customer_id')
    .eq('id', id).maybeSingle()
  if (custErr) return <div className="p-6"><SchemaError error={custErr.message} /></div>
  if (!cust)   return <div className="p-6"><div className="text-graphite">Customer not found.</div></div>
  const c = cust as B2bCustomer

  // Подгружаем имя linked Loyverse customer'а (для отображения в pill'е)
  let lvName: string | null = null
  if (c.loyverse_customer_id) {
    const { data: lv } = await sbInventory
      .from('loyverse_customer')
      .select('name')
      .eq('id', c.loyverse_customer_id)
      .maybeSingle()
    lvName = lv?.name ?? null
  }

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

  const tab: Tab = sp.tab && ['invoices','loyverse','deliveries','balance'].includes(sp.tab) ? sp.tab : 'invoices'

  return (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/m/customers" className="text-xs text-graphite hover:text-wine-red">← Back to customers</Link>
          <h2 className="font-heading text-2xl text-deep-black mt-3">{c.flowaccount_name}</h2>
          <div className="text-xs text-graphite mt-1 mb-1">
            {c.brand_name && <>{c.brand_name} · </>}
            {c.is_consignment ? 'Consignment' : 'Regular'} · Terms {c.payment_terms_days} days
          </div>
          <div className="mb-5">
            <CustomerLoyverseCell
              customerId={c.id}
              initialLoyverseId={c.loyverse_customer_id}
              initialLoyverseName={lvName}
            />
          </div>
        </div>
        <DataFreshness sources={['flowaccount_invoices']} />
      </div>

          {/* Tabs */}
          <nav className="border-b border-pale-stone mb-5 flex gap-1 text-sm">
            <TabLink href={`/m/customers/${id}`} active={tab==='invoices'}>Tax Invoices</TabLink>
            <TabLink href={`/m/customers/${id}?tab=loyverse`} active={tab==='loyverse'}>Loyverse Sales</TabLink>
            {c.is_consignment && (
              <>
                <TabLink href={`/m/customers/${id}?tab=deliveries`} active={tab==='deliveries'}>Deliveries</TabLink>
                <TabLink href={`/m/customers/${id}?tab=balance`}    active={tab==='balance'}>Balance on location</TabLink>
              </>
            )}
          </nav>

          {tab === 'invoices'   && <InvoicesPanel   customerId={id} termsDays={c.payment_terms_days ?? 0} sp={sp} />}
          {tab === 'loyverse'   && <LoyverseSalesPanel loyverseId={c.loyverse_customer_id} sp={sp} />}
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

// ─── Loyverse Sales panel ──────────────────────────────────────────────
async function LoyverseSalesPanel({ loyverseId, sp }: { loyverseId: string | null; sp: SearchParams }) {
  if (!loyverseId) {
    return (
      <div className="text-sm text-graphite">
        Этот клиент не привязан к Loyverse. Жми <span className="text-deep-black">+ link Loyverse</span> в заголовке —
        выбери, и список Loyverse-receipts появится здесь.
      </div>
    )
  }
  const { data, error } = await sbInventory
    .from('loyverse_receipt')
    .select('id, receipt_number, receipt_date, receipt_type, total, cost_total, is_b2b, is_bank_transfer')
    .eq('customer_id', loyverseId)
    .order('receipt_date', { ascending: false })
    .limit(300)
  if (error) return <SchemaError error={error.message} />
  const rows = (data ?? []) as any[]
  if (rows.length === 0) {
    return <div className="text-sm text-graphite">Loyverse receipts по этому клиенту нет. Прогони <code className="font-mono text-xs">npm run inv:receipts</code> (или подожди ежедневного крона).</div>
  }

  const sort = parseSort(sp.sort, ['receipt_number','receipt_date','receipt_type','total','cost_total'] as const, 'receipt_date')
  const dir: SortDir = parseDir(sp.dir, 'desc')
  const sorted = [...rows].sort(cmpBy(r => {
    if (sort === 'total')      return Number(r.total)
    if (sort === 'cost_total') return Number(r.cost_total ?? 0)
    return r[sort] as string
  }, dir))

  const sales   = rows.filter(r => r.receipt_type === 'SALE').reduce((s, r) => s + Number(r.total), 0)
  const refunds = rows.filter(r => r.receipt_type === 'REFUND').reduce((s, r) => s + Number(r.total), 0)
  const net     = sales - refunds
  const cost    = rows.filter(r => r.receipt_type === 'SALE').reduce((s, r) => s + Number(r.cost_total ?? 0), 0)
  const gp      = net - cost
  const gpPct   = net > 0 ? (gp / net) * 100 : 0

  return (
    <>
      <div className="grid grid-cols-4 gap-3 mb-4 text-xs">
        <KPI label="Sales"   value={`฿${fmt(sales)}`}   note={`${rows.filter(r => r.receipt_type === 'SALE').length} шт.`} highlight />
        <KPI label="Refunds" value={`−฿${fmt(refunds)}`} note={`${rows.filter(r => r.receipt_type === 'REFUND').length} шт.`} muted />
        <KPI label="Net"     value={`฿${fmt(net)}`} />
        <KPI label="GP"      value={`฿${fmt(gp)}`} note={`${gpPct.toFixed(1)}%`} />
      </div>
      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <SortHeader col="receipt_number" label="Receipt" sort={sort} dir={dir} sp={sp} keep={['tab']} />
              <SortHeader col="receipt_date"   label="Date"    sort={sort} dir={dir} sp={sp} keep={['tab']} />
              <SortHeader col="receipt_type"   label="Type"    sort={sort} dir={dir} sp={sp} keep={['tab']} />
              <SortHeader col="total"          label="Total"   sort={sort} dir={dir} sp={sp} keep={['tab']} align="right" />
              <SortHeader col="cost_total"     label="Cost"    sort={sort} dir={dir} sp={sp} keep={['tab']} align="right" />
              <th className="text-left py-2 px-4 font-medium text-graphite text-[11px]">B2B</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.id} className={`border-b border-pale-stone/40 last:border-0 hover:bg-cream/40 ${r.receipt_type === 'REFUND' ? 'opacity-70' : ''}`}>
                <td className="py-2 px-4 font-mono">{r.receipt_number}</td>
                <td className="py-2 px-4 text-graphite text-xs">{fmtDate(r.receipt_date)}</td>
                <td className="py-2 px-4">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${
                    r.receipt_type === 'REFUND'
                      ? 'bg-wine-red/10 text-wine-red border-wine-red/40'
                      : 'bg-cream text-graphite border-pale-stone'
                  }`}>{r.receipt_type}</span>
                </td>
                <td className="py-2 px-4 text-right tabular-nums">{`฿${fmt(Number(r.total))}`}</td>
                <td className="py-2 px-4 text-right tabular-nums text-graphite">{r.cost_total ? `฿${fmt(Number(r.cost_total))}` : '—'}</td>
                <td className="py-2 px-4 text-[11px] text-graphite">
                  {r.is_b2b
                    ? (r.is_bank_transfer ? 'bank transfer' : 'name match')
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function KPI({ label, value, note, highlight, muted }: { label: string; value: string; note?: string; highlight?: boolean; muted?: boolean }) {
  return (
    <div className={`px-3 py-2 rounded-md border ${
      highlight ? 'bg-wine-red text-warm-white border-wine-red'
                : muted ? 'bg-cream text-graphite border-pale-stone'
                        : 'bg-warm-white border-pale-stone'
    }`}>
      <div className={`text-[10px] uppercase tracking-wide ${highlight ? 'opacity-80' : 'text-graphite'}`}>{label}</div>
      <div className={`text-base font-medium tabular-nums ${highlight ? '' : 'text-deep-black'}`}>{value}</div>
      {note && <div className={`text-[10px] ${highlight ? 'opacity-70' : 'text-graphite/70'}`}>{note}</div>}
    </div>
  )
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
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
    .select('id, number, issued_at, status, with_vat, delivery_note_line(qty, unit_price)')
    .eq('location_id', loc.id)
    .limit(200)
  if (error) return <SchemaError error={error.message} />

  let notes = ((data ?? []) as any[]).map(n => {
    const lines = (n.delivery_note_line ?? []) as { qty: number; unit_price: number | null }[]
    const subtotal = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unit_price || 0), 0)
    return {
      ...n,
      line_count: lines.length,
      total_qty:  lines.reduce((s, l) => s + Number(l.qty || 0), 0),
      total_money: n.with_vat !== false ? subtotal * 1.07 : subtotal,
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
                  <td className="py-2 px-4 text-right tabular-nums">{n.total_money ? `฿${n.total_money.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : '—'}</td>
                  <td className="py-2 px-4 text-right">
                    <DeliveryRowActions customerId={customerId} noteId={n.id} number={n.number} />
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
        derived from delivery notes minus invoiced lines
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
