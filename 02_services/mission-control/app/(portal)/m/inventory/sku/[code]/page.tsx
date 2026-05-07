import Link from 'next/link'
import { sbInventory, sbPublic, type PurchaseOrderItem, type PurchaseOrder } from '@/lib/supabase'
import { fetchSkuB2cSalesWindow, type SkuB2cSalesWindow } from '@/lib/loyverse'
import { SchemaError } from '@/components/modules/inventory/SchemaError'

export const dynamic = 'force-dynamic'

const B2C_WINDOW_DAYS = 90

export default async function SkuDetail({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params

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

  // Run all data fetches in parallel — UI waits for the slowest (the Loyverse REST call).
  const [
    breakdownRes,
    receiptsRes,
    invoiceLinesRes,
    consignmentRes,
    b2cSalesRes,
  ] = await Promise.all([
    sbInventory.from('v_sku_breakdown').select('*').eq('sku_id', sku.id).maybeSingle(),
    sbPublic
      .from('purchase_order_items')
      .select('id, po_id, po_number, product_name, sku, qty_ordered, qty_received, cost_price, line_total, scraped_at')
      .eq('sku', code)
      .order('scraped_at', { ascending: false })
      .limit(200),
    sbInventory
      .from('flowaccount_invoice_line')
      .select('id, qty, amount, raw_text, flowaccount_invoice(number, customer_name, issued_at, due_at, status, total)')
      .eq('sku_id', sku.id)
      .order('id', { ascending: false }),
    sbInventory
      .from('consignment_balance')
      .select('qty, updated_at, consignment_location(name)')
      .eq('sku_id', sku.id),
    safeLoyverseSales(sku.loyverse_variant_id, B2C_WINDOW_DAYS),
  ])

  const poItems = (receiptsRes.data ?? []) as PurchaseOrderItem[]
  // Pull the parent POs in one go to enrich item rows with date + supplier.
  const poIds = Array.from(new Set(poItems.map(i => i.po_id)))
  let posById: Record<number, PurchaseOrder> = {}
  if (poIds.length) {
    const { data: pos } = await sbPublic
      .from('purchase_orders')
      .select('id, po_number, supplier, order_date, status, url')
      .in('id', poIds)
    for (const p of (pos ?? []) as PurchaseOrder[]) posById[p.id] = p
  }

  return (
    <>
      <Link href="/m/inventory" className="text-xs text-graphite hover:text-wine-red">← Back to breakdown</Link>
      <div className="text-graphite text-xs mt-4 mb-1 font-mono">SKU · {sku.loyverse_product_code}</div>
      <h2 className="font-heading text-2xl text-deep-black mb-6">{sku.name}</h2>

      {/* Stats */}
      {breakdownRes.data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          <Stat label="On hand"        value={breakdownRes.data.on_hand} />
          <Stat label="In store"       value={breakdownRes.data.in_store} />
          <Stat label="B2B in transit" value={breakdownRes.data.b2b_in_transit} accent />
          <Stat label="Consignment"    value={breakdownRes.data.on_consignment} />
        </div>
      )}

      {/* Receipts / Приходы */}
      <Section title="Приходы (Loyverse Purchase Orders)" subtitle="Все зафиксированные приходы по этому SKU">
        {poItems.length === 0 ? (
          <Empty>Приходов нет. Запусти <Code>npm run orders</Code> чтобы подтянуть PO из Loyverse.</Empty>
        ) : (
          <Table head={['PO', 'Date', 'Supplier', 'Status', 'Qty rcvd', 'Cost', 'Line total']}>
            {poItems.map(it => {
              const po = posById[it.po_id]
              return (
                <tr key={it.id} className="border-b border-pale-stone/40 last:border-0">
                  <td className="py-2 px-4 font-mono">
                    {po?.url
                      ? <a href={po.url} target="_blank" rel="noopener noreferrer" className="hover:text-wine-red">{it.po_number}</a>
                      : it.po_number}
                  </td>
                  <td className="py-2 px-4">{po?.order_date ?? '—'}</td>
                  <td className="py-2 px-4">{po?.supplier ?? '—'}</td>
                  <td className="py-2 px-4">{po?.status ?? '—'}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{fmt(it.qty_received)}</td>
                  <td className="py-2 px-4 text-right tabular-nums">฿{fmt(it.cost_price)}</td>
                  <td className="py-2 px-4 text-right tabular-nums">฿{fmt(it.line_total)}</td>
                </tr>
              )
            })}
          </Table>
        )}
        {poItems.length > 0 && (
          <Sum label={`Всего пришло (${poItems.length} PO)`}
               qty={poItems.reduce((s, i) => s + Number(i.qty_received || 0), 0)}
               money={poItems.reduce((s, i) => s + Number(i.line_total || 0), 0)} />
        )}
      </Section>

      {/* B2C Sales — last 90 days, live from Loyverse */}
      <Section
        title={`B2C продажи · последние ${B2C_WINDOW_DAYS} дней`}
        subtitle="Loyverse REST · live, без кэша. История за всё время — отдельной задачей через Supabase-sync."
      >
        <B2cSalesPanel data={b2cSalesRes} />
      </Section>

      {/* B2B Sales */}
      <Section title="B2B продажи (FlowAccount)" subtitle="Все строки инвойсов где встречается этот SKU">
        {(invoiceLinesRes.error || (invoiceLinesRes.data?.length ?? 0) === 0) ? (
          <Empty>{invoiceLinesRes.error?.message ?? 'B2B продаж по этому SKU нет.'}</Empty>
        ) : (
          <>
            <Table head={['Invoice', 'Customer', 'Issued', 'Due', 'Status', 'Qty', 'Amount']}>
              {(invoiceLinesRes.data as any[]).map((row, i) => {
                const inv = row.flowaccount_invoice
                return (
                  <tr key={i} className="border-b border-pale-stone/40 last:border-0">
                    <td className="py-2 px-4 font-mono">{inv?.number ?? '—'}</td>
                    <td className="py-2 px-4">{inv?.customer_name ?? '—'}</td>
                    <td className="py-2 px-4">{inv?.issued_at ?? '—'}</td>
                    <td className="py-2 px-4">{inv?.due_at ?? '—'}</td>
                    <td className="py-2 px-4">
                      <StatusPill status={inv?.status} />
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">{fmt(row.qty)}</td>
                    <td className="py-2 px-4 text-right tabular-nums">{row.amount ? `฿${fmt(row.amount)}` : '—'}</td>
                  </tr>
                )
              })}
            </Table>
            <Sum label={`Всего B2B (${invoiceLinesRes.data!.length} строк)`}
                 qty={(invoiceLinesRes.data as any[]).reduce((s, r) => s + Number(r.qty || 0), 0)}
                 money={(invoiceLinesRes.data as any[]).reduce((s, r) => s + Number(r.amount || 0), 0)} />
          </>
        )}
      </Section>

      {/* Consignment per location */}
      <Section title="Consignment" subtitle="Где сейчас лежит на реализации">
        {(consignmentRes.error || (consignmentRes.data?.length ?? 0) === 0) ? (
          <Empty>На реализации не лежит.</Empty>
        ) : (
          <Table head={['Location', 'Qty', 'Updated']}>
            {(consignmentRes.data as any[]).map((row, i) => (
              <tr key={i} className="border-b border-pale-stone/40 last:border-0">
                <td className="py-2 px-4">{row.consignment_location?.name ?? '—'}</td>
                <td className="py-2 px-4 text-right tabular-nums">{fmt(row.qty)}</td>
                <td className="py-2 px-4 text-graphite text-xs">{row.updated_at?.slice(0, 16) ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </>
  )
}

// ─── Loyverse REST safety wrapper ────────────────────────────────────────
async function safeLoyverseSales(variantId: string, days: number): Promise<
  { ok: true; data: SkuB2cSalesWindow } | { ok: false; error: string }
> {
  try { return { ok: true, data: await fetchSkuB2cSalesWindow(variantId, days) } }
  catch (e: any) { return { ok: false, error: e?.message ?? 'unknown error' } }
}

// ─── Sub-components ──────────────────────────────────────────────────────
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
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

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
      <table className="w-full text-[13px]">
        <thead className="text-graphite border-b border-pale-stone bg-cream/40">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={`py-2 px-4 ${i >= head.length - 3 && /Qty|Cost|total|Amount/.test(h) ? 'text-right' : 'text-left'}`}>
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

function B2cSalesPanel({ data }: {
  data: { ok: true; data: SkuB2cSalesWindow } | { ok: false; error: string }
}) {
  if (!data.ok) {
    return (
      <div className="bg-warm-white border border-amber-gold rounded-md p-4 text-sm">
        <div className="overline text-amber-gold mb-1">Loyverse недоступен</div>
        <div className="text-graphite">Не удалось получить продажи: <span className="font-mono text-xs">{data.error}</span></div>
        <div className="text-xs text-graphite mt-2">
          Проверь, что переменная <Code>LOYVERSE_API_TOKEN</Code> задана в Railway / .env.local.
        </div>
      </div>
    )
  }
  const { totalQty, totalRevenue, receiptsCount, recent, windowDays } = data.data
  return (
    <>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <MiniStat label={`Bottles · ${windowDays}d`}  value={fmt(totalQty)} />
        <MiniStat label={`Revenue · ${windowDays}d`}  value={`฿${fmt(totalRevenue)}`} />
        <MiniStat label={`Receipts · ${windowDays}d`} value={fmt(receiptsCount)} />
      </div>
      {recent.length === 0 ? (
        <Empty>За последние {windowDays} дней продаж не было.</Empty>
      ) : (
        <Table head={['Date', 'Receipt #', 'Qty', 'Total']}>
          {recent.map((s, i) => (
            <tr key={i} className="border-b border-pale-stone/40 last:border-0">
              <td className="py-2 px-4 text-graphite text-xs">{s.date.slice(0, 16).replace('T', ' ')}</td>
              <td className="py-2 px-4 font-mono">{s.receiptNumber}</td>
              <td className="py-2 px-4 text-right tabular-nums">{fmt(s.qty)}</td>
              <td className="py-2 px-4 text-right tabular-nums">฿{fmt(s.total)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
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

function fmt(n: number | null | undefined): string {
  const num = Number(n ?? 0)
  if (num === 0) return '0'
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
