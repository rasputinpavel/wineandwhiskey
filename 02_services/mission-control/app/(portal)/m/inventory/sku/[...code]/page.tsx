import { Suspense } from 'react'
import Link from 'next/link'
import { sbInventory, sbPublic, type PurchaseOrderItem, type PurchaseOrder } from '@/lib/supabase'
import { fetchSkuB2cSalesWindow, type SkuB2cSalesWindow } from '@/lib/loyverse'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { SortHeader, readSortParams, cmpBy } from '@/components/shell/SortHeader'
import { fmtDate, fmtDateTime } from '@/lib/fmt'

export const dynamic = 'force-dynamic'

const B2C_WINDOW_DAYS = 90

type SearchParams = Record<string, string | undefined>

export default async function SkuDetail({
  params, searchParams,
}: {
  // catch-all dynamic segment: SKU коды могут содержать слэш (e.g. 08081564/22).
  // Next.js передаёт сегменты массивом, склеиваем обратно через '/'.
  params: Promise<{ code: string[] }>
  searchParams: Promise<SearchParams>
}) {
  const { code: codeParts } = await params
  const code = codeParts.join('/')
  const sp = await searchParams

  // Single fast query so the page header renders immediately on click.
  const { data: sku, error: skuErr } = await sbInventory
    .from('sku').select('*')
    .eq('loyverse_product_code', code)
    .maybeSingle()

  if (skuErr) return <SchemaError error={skuErr.message} />
  if (!sku) {
    return (
      <div>
        <Link href="/m/inventory" className="text-xs text-graphite hover:text-wine-red">← Back</Link>
        <div className="mt-4 text-graphite">SKU <code className="font-mono">{code}</code> not found.</div>
      </div>
    )
  }

  return (
    <>
      <Link href="/m/inventory" className="text-xs text-graphite hover:text-wine-red">← Back to breakdown</Link>
      <div className="text-graphite text-xs mt-4 mb-1 font-mono">SKU · {sku.loyverse_product_code}</div>
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
        <h2 className="font-heading text-2xl text-deep-black">{sku.name}</h2>
        <DataFreshness sources={['loyverse_stock', 'flowaccount_invoices', 'purchase_orders']} />
      </div>

      {/* Each section streams independently. Suspense with a skeleton so the */}
      {/* slow Loyverse REST scan doesn't block the rest of the page. */}
      <Suspense fallback={<StatsSkeleton />}>
        <StatsSection skuId={sku.id} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton title="Приходы (Loyverse Purchase Orders)" />}>
        <ReceiptsSection code={code} sp={sp} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton title={`B2C продажи · последние ${B2C_WINDOW_DAYS} дней`} subtitle="Loyverse REST · загрузка может занять до 10 сек" />}>
        <B2cSection variantId={sku.loyverse_variant_id} sp={sp} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton title="B2B продажи (FlowAccount)" />}>
        <B2bSection skuId={sku.id} sp={sp} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton title="Consignment" />}>
        <ConsignmentSection skuId={sku.id} sp={sp} />
      </Suspense>
    </>
  )
}

// ─── Sections (each is its own async server component) ───────────────────

async function StatsSection({ skuId }: { skuId: string }) {
  const { data } = await sbInventory
    .from('v_sku_breakdown').select('*')
    .eq('sku_id', skuId).maybeSingle()
  if (!data) return null
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
      <Stat label="On hand"        value={data.on_hand} />
      <Stat label="In store"       value={data.in_store} />
      <Stat label="B2B in transit" value={data.b2b_in_transit} accent />
      <Stat label="Consignment"    value={data.on_consignment} />
    </div>
  )
}

async function ReceiptsSection({ code, sp }: { code: string; sp: SearchParams }) {
  const { data: items, error } = await sbPublic
    .from('purchase_order_items')
    .select('id, po_id, po_number, product_name, sku, qty_ordered, qty_received, cost_price, line_total, scraped_at')
    .eq('sku', code)
    .limit(200)

  if (error) {
    return <Section title="Приходы (Loyverse Purchase Orders)"><Empty>Ошибка чтения PO: {error.message}</Empty></Section>
  }

  const poItems = (items ?? []) as PurchaseOrderItem[]
  let posById: Record<number, PurchaseOrder> = {}
  if (poItems.length) {
    const ids = Array.from(new Set(poItems.map(i => i.po_id)))
    const { data: pos } = await sbPublic
      .from('purchase_orders')
      .select('id, po_number, supplier, order_date, status, url')
      .in('id', ids)
    for (const p of (pos ?? []) as PurchaseOrder[]) posById[p.id] = p
  }

  const { sort, dir } = readSortParams(
    sp,
    ['po_number','order_date','supplier','status','qty_received','cost_price','line_total'] as const,
    'order_date', 'rec',
  )
  const sortedItems = [...poItems].sort(cmpBy(it => {
    const po = posById[it.po_id]
    if (sort === 'po_number')    return it.po_number ?? ''
    if (sort === 'order_date')   return po?.order_date ?? ''
    if (sort === 'supplier')     return po?.supplier ?? ''
    if (sort === 'status')       return po?.status ?? ''
    if (sort === 'qty_received') return Number(it.qty_received ?? 0)
    if (sort === 'cost_price')   return Number(it.cost_price ?? 0)
    return Number(it.line_total ?? 0)
  }, dir))

  return (
    <Section
      title="Приходы (Loyverse Purchase Orders)"
      subtitle="Все зафиксированные приходы по этому SKU"
    >
      {poItems.length === 0 ? (
        <Empty>Приходов нет. Запусти <Code>npm run orders</Code> чтобы подтянуть PO из Loyverse.</Empty>
      ) : (
        <>
          <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="text-graphite border-b border-pale-stone bg-cream/40">
                <tr>
                  <SortHeader col="po_number"    label="PO"          sort={sort} dir={dir} sp={sp} prefix="rec" />
                  <SortHeader col="order_date"   label="Date"        sort={sort} dir={dir} sp={sp} prefix="rec" />
                  <SortHeader col="supplier"     label="Supplier"    sort={sort} dir={dir} sp={sp} prefix="rec" />
                  <SortHeader col="status"       label="Status"      sort={sort} dir={dir} sp={sp} prefix="rec" />
                  <SortHeader col="qty_received" label="Qty rcvd"    sort={sort} dir={dir} sp={sp} prefix="rec" align="right" />
                  <SortHeader col="cost_price"   label="Cost"        sort={sort} dir={dir} sp={sp} prefix="rec" align="right" />
                  <SortHeader col="line_total"   label="Line total"  sort={sort} dir={dir} sp={sp} prefix="rec" align="right" />
                </tr>
              </thead>
              <tbody>
                {sortedItems.map(it => {
                  const po = posById[it.po_id]
                  return (
                    <tr key={it.id} className="border-b border-pale-stone/40 last:border-0">
                      <td className="py-2 px-4 font-mono">
                        {po?.url
                          ? <a href={po.url} target="_blank" rel="noopener noreferrer" className="hover:text-wine-red">{it.po_number}</a>
                          : it.po_number}
                      </td>
                      <td className="py-2 px-4">{fmtDate(po?.order_date)}</td>
                      <td className="py-2 px-4">{po?.supplier ?? '—'}</td>
                      <td className="py-2 px-4">{po?.status ?? '—'}</td>
                      <td className="py-2 px-4 text-right tabular-nums">{fmt(it.qty_received)}</td>
                      <td className="py-2 px-4 text-right tabular-nums">฿{fmt(it.cost_price)}</td>
                      <td className="py-2 px-4 text-right tabular-nums">฿{fmt(it.line_total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Sum label={`Всего пришло (${poItems.length} PO)`}
               qty={poItems.reduce((s, i) => s + Number(i.qty_received || 0), 0)}
               money={poItems.reduce((s, i) => s + Number(i.line_total || 0), 0)} />
        </>
      )}
    </Section>
  )
}

async function B2cSection({ variantId, sp }: { variantId: string; sp: SearchParams }) {
  let data: SkuB2cSalesWindow | null = null
  let err: string | null = null
  try { data = await fetchSkuB2cSalesWindow(variantId, B2C_WINDOW_DAYS) }
  catch (e: any) { err = e?.message ?? 'unknown error' }

  const { sort, dir } = readSortParams(
    sp, ['date','receiptNumber','qty','total'] as const, 'date', 'b2c',
  )
  const recent = data?.recent ? [...data.recent].sort(cmpBy(r => {
    if (sort === 'qty')   return Number(r.qty)
    if (sort === 'total') return Number(r.total)
    return r[sort] as string
  }, dir)) : []

  return (
    <Section
      title={`B2C продажи · последние ${B2C_WINDOW_DAYS} дней`}
      subtitle="Loyverse REST · live, без кэша. История за всё время — отдельной задачей через Supabase-sync."
    >
      {err ? (
        <div className="bg-warm-white border border-amber-gold rounded-md p-4 text-sm">
          <div className="overline text-amber-gold mb-1">Loyverse недоступен</div>
          <div className="text-graphite">Не удалось получить продажи: <span className="font-mono text-xs">{err}</span></div>
          <div className="text-xs text-graphite mt-2">
            Проверь, что переменная <Code>LOYVERSE_API_TOKEN</Code> задана в Railway / .env.local.
          </div>
        </div>
      ) : data && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <MiniStat label={`Bottles · ${B2C_WINDOW_DAYS}d`}  value={fmt(data.totalQty)} />
            <MiniStat label={`Revenue · ${B2C_WINDOW_DAYS}d`}  value={`฿${fmt(data.totalRevenue)}`} />
            <MiniStat label={`Receipts · ${B2C_WINDOW_DAYS}d`} value={fmt(data.receiptsCount)} />
          </div>
          {recent.length === 0 ? (
            <Empty>За последние {B2C_WINDOW_DAYS} дней продаж не было.</Empty>
          ) : (
            <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="text-graphite border-b border-pale-stone bg-cream/40">
                  <tr>
                    <SortHeader col="date"          label="Date"      sort={sort} dir={dir} sp={sp} prefix="b2c" />
                    <SortHeader col="receiptNumber" label="Receipt #" sort={sort} dir={dir} sp={sp} prefix="b2c" />
                    <SortHeader col="qty"           label="Qty"       sort={sort} dir={dir} sp={sp} prefix="b2c" align="right" />
                    <SortHeader col="total"         label="Total"     sort={sort} dir={dir} sp={sp} prefix="b2c" align="right" />
                  </tr>
                </thead>
                <tbody>
                  {recent.map((s, i) => (
                    <tr key={i} className="border-b border-pale-stone/40 last:border-0">
                      <td className="py-2 px-4 text-graphite text-xs">{fmtDateTime(s.date)}</td>
                      <td className="py-2 px-4 font-mono">{s.receiptNumber}</td>
                      <td className="py-2 px-4 text-right tabular-nums">{fmt(s.qty)}</td>
                      <td className="py-2 px-4 text-right tabular-nums">฿{fmt(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Section>
  )
}

async function B2bSection({ skuId, sp }: { skuId: string; sp: SearchParams }) {
  const { data, error } = await sbInventory
    .from('flowaccount_invoice_line')
    .select('id, qty, amount, raw_text, flowaccount_invoice(number, customer_name, issued_at, due_at, status, total)')
    .eq('sku_id', skuId)

  const rows = (data ?? []) as any[]
  const { sort, dir } = readSortParams(
    sp,
    ['number','customer_name','issued_at','due_at','status','qty','amount'] as const,
    'issued_at', 'b2b',
  )
  const sortedRows = [...rows].sort(cmpBy(r => {
    const inv = r.flowaccount_invoice
    if (sort === 'qty')    return Number(r.qty ?? 0)
    if (sort === 'amount') return Number(r.amount ?? 0)
    if (sort === 'number')        return inv?.number ?? ''
    if (sort === 'customer_name') return inv?.customer_name ?? ''
    if (sort === 'issued_at')     return inv?.issued_at ?? ''
    if (sort === 'due_at')        return inv?.due_at ?? ''
    if (sort === 'status')        return inv?.status ?? ''
    return ''
  }, dir))

  return (
    <Section title="B2B продажи (FlowAccount)" subtitle="Все строки инвойсов где встречается этот SKU">
      {(error || (rows.length === 0)) ? (
        <Empty>{error?.message ?? 'B2B продаж по этому SKU нет.'}</Empty>
      ) : (
        <>
          <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="text-graphite border-b border-pale-stone bg-cream/40">
                <tr>
                  <SortHeader col="number"        label="Invoice"  sort={sort} dir={dir} sp={sp} prefix="b2b" />
                  <SortHeader col="customer_name" label="Customer" sort={sort} dir={dir} sp={sp} prefix="b2b" />
                  <SortHeader col="issued_at"     label="Issued"   sort={sort} dir={dir} sp={sp} prefix="b2b" />
                  <SortHeader col="due_at"        label="Due"      sort={sort} dir={dir} sp={sp} prefix="b2b" />
                  <SortHeader col="status"        label="Status"   sort={sort} dir={dir} sp={sp} prefix="b2b" />
                  <SortHeader col="qty"           label="Qty"      sort={sort} dir={dir} sp={sp} prefix="b2b" align="right" />
                  <SortHeader col="amount"        label="Amount"   sort={sort} dir={dir} sp={sp} prefix="b2b" align="right" />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => {
                  const inv = row.flowaccount_invoice
                  return (
                    <tr key={i} className="border-b border-pale-stone/40 last:border-0">
                      <td className="py-2 px-4 font-mono">{inv?.number ?? '—'}</td>
                      <td className="py-2 px-4">{inv?.customer_name ?? '—'}</td>
                      <td className="py-2 px-4">{fmtDate(inv?.issued_at)}</td>
                      <td className="py-2 px-4">{fmtDate(inv?.due_at)}</td>
                      <td className="py-2 px-4"><StatusPill status={inv?.status} /></td>
                      <td className="py-2 px-4 text-right tabular-nums">{fmt(row.qty)}</td>
                      <td className="py-2 px-4 text-right tabular-nums">{row.amount ? `฿${fmt(row.amount)}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Sum label={`Всего B2B (${rows.length} строк)`}
               qty={rows.reduce((s, r) => s + Number(r.qty || 0), 0)}
               money={rows.reduce((s, r) => s + Number(r.amount || 0), 0)} />
        </>
      )}
    </Section>
  )
}

async function ConsignmentSection({ skuId, sp }: { skuId: string; sp: SearchParams }) {
  // PostgREST can't infer FKs from a view, so fetch balances first then
  // resolve location names with a second query.
  const { data: balData, error } = await sbInventory
    .from('v_consignment_balance')
    .select('location_id, qty')
    .eq('sku_id', skuId)
    .gt('qty', 0)

  const balances = (balData ?? []) as { location_id: string; qty: number }[]
  let names = new Map<string, string>()
  if (balances.length) {
    const ids = Array.from(new Set(balances.map(b => b.location_id)))
    const { data: locs } = await sbInventory
      .from('consignment_location')
      .select('id, name, customer_id')
      .in('id', ids)
    for (const l of (locs ?? []) as { id: string; name: string }[]) names.set(l.id, l.name)
  }
  const rows = balances.map(b => ({ ...b, name: names.get(b.location_id) ?? '—' }))

  const { sort, dir } = readSortParams(
    sp, ['location','qty'] as const, 'qty', 'cons',
  )
  const sortedRows = [...rows].sort(cmpBy(r => {
    if (sort === 'location') return r.name
    return Number(r.qty)
  }, dir))

  return (
    <Section title="Consignment" subtitle="Где сейчас лежит на реализации">
      {(error || (rows.length === 0)) ? (
        <Empty>На реализации не лежит.</Empty>
      ) : (
        <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="text-graphite border-b border-pale-stone bg-cream/40">
              <tr>
                <SortHeader col="location" label="Location" sort={sort} dir={dir} sp={sp} prefix="cons" />
                <SortHeader col="qty"      label="Qty"      sort={sort} dir={dir} sp={sp} prefix="cons" align="right" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, i) => (
                <tr key={i} className="border-b border-pale-stone/40 last:border-0">
                  <td className="py-2 px-4">{row.name}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{fmt(row.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

// ─── Skeletons ───────────────────────────────────────────────────────────

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10 animate-pulse">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="bg-warm-white border border-pale-stone rounded-md p-4">
          <div className="h-3 w-20 bg-pale-stone/60 rounded-sm mb-3" />
          <div className="h-8 w-16 bg-pale-stone/40 rounded-sm" />
        </div>
      ))}
    </div>
  )
}

function SectionSkeleton({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Section title={title} subtitle={subtitle}>
      <div className="bg-warm-white border border-pale-stone rounded-md h-24 animate-pulse" />
    </Section>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h3 className="font-heading text-base text-deep-black">{title}</h3>
      {subtitle && <p className="text-xs text-graphite mt-0.5 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </section>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-4">
      <div className="overline text-graphite mb-2">{label}</div>
      <div className={`font-display text-3xl tracking-display leading-none ${accent ? 'text-wine-red' : 'text-deep-black'}`}>
        {fmt(value)}
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-3">
      <div className="overline text-graphite mb-1">{label}</div>
      <div className="font-heading text-xl text-deep-black tabular-nums">{value}</div>
    </div>
  )
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
      <table className="w-full text-[13px]">
        <thead className="text-graphite border-b border-pale-stone bg-cream/40">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={`py-2 px-4 ${/Qty|Cost|total|Amount/i.test(h) ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Sum({ label, qty, money }: { label: string; qty: number; money: number }) {
  return (
    <div className="flex justify-end gap-6 text-xs text-graphite mt-2 px-2">
      <span>{label}</span>
      <span>Qty: <span className="text-deep-black tabular-nums font-medium">{fmt(qty)}</span></span>
      <span>Сумма: <span className="text-deep-black tabular-nums font-medium">฿{fmt(money)}</span></span>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-graphite py-3">{children}</div>
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-xs px-1.5 py-0.5 bg-cream rounded-sm">{children}</code>
}

function StatusPill({ status }: { status?: string }) {
  if (!status) return <span className="text-graphite">—</span>
  const cls =
    status === 'Paid'      ? 'bg-cream text-graphite border-pale-stone' :
    status === 'Cancelled' ? 'bg-cream text-graphite border-pale-stone' :
    status === 'Overdue'   ? 'bg-wine-red/10 text-wine-red border-wine-red/40' :
                              'bg-amber-gold/10 text-deep-black border-amber-gold/40'
  return <span className={`inline-block px-2 py-0.5 text-[11px] rounded-sm border ${cls}`}>{status}</span>
}

function fmt(n: number | null | undefined): string {
  const num = Number(n ?? 0)
  if (num === 0) return '0'
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
