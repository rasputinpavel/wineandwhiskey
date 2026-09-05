import Link from 'next/link'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { ExportCsvButton, ReceiptExclusions, ClosePeriodButton } from '@/components/modules/suppliers/ConsignmentReportCells'
import { ConsignmentReportTable } from '@/components/modules/suppliers/ConsignmentReportTable'
import { computeConsignmentSettlement, shiftMonth } from '@/lib/consignment-settlement'

export const dynamic = 'force-dynamic'

type SearchParams = { period?: string }

const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

function lastClosedMonth(today = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function SupplierMonthlyReportPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const period = (sp.period && /^\d{4}-\d{2}$/.test(sp.period)) ? sp.period : lastClosedMonth()

  // Settlement math is shared with Pulse's break-even forecast (one source of
  // truth — see lib/consignment-settlement.ts).
  let settlement
  try {
    settlement = await computeConsignmentSettlement(id, period)
  } catch (e: any) { return <SchemaError error={String(e?.message ?? e)} /> }
  if (!settlement) return <div className="text-graphite">Supplier not found.</div>
  const {
    supplier: s, mode, label, rows, subtotal, vat, grandTotal, unpricedSold,
    excluded, exclTableMissing, delTableMissing, closedAt, closings, reconMismatches,
    buyoutInvoices, hasBuyouts, totals,
  } = settlement
  const unitWord = mode === 'retail_minus' ? 'list' : 'HC'   // 'HC' is Harvest jargon

  return (
    <>
      <div className="mb-4 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <Link href={`/m/suppliers/${id}`} className="text-xs text-graphite hover:text-wine-red">← Back to {s.name}</Link>
          <h2 className="font-heading text-2xl text-deep-black mt-3">{s.name} · Monthly sales report</h2>
          <p className="text-graphite text-sm mt-1 max-w-3xl">
            Auto-aggregates Loyverse sales (B2C + B2B) per SKU and prices the billable units at the consignment unit cost + 7% VAT.
            <strong> TOTAL</strong> = billable (B2C + B2B); tastings are free and excluded from the bill.
            Closing = Opening + Delivered − TOTAL − Tastings (click to override). Set opening / tastings inline; log arrivals on the Deliveries tab.
            {hasBuyouts && <>
              {' '}Units bought out of consignment (Buyouts tab) are ours: they leave Closing, and sales
              of those SKUs draw from our own stock first, so TOTAL bills only what is still {s.name}&apos;s.
            </>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/m/suppliers/${id}/report?period=${shiftMonth(period, -1)}`}
            className="text-xs px-2 py-1 border border-pale-stone rounded-sm hover:border-wine-red hover:text-wine-red"
          >← prev</Link>
          <span className="text-sm font-mono">{label}</span>
          <Link
            href={`/m/suppliers/${id}/report?period=${shiftMonth(period, 1)}`}
            className="text-xs px-2 py-1 border border-pale-stone rounded-sm hover:border-wine-red hover:text-wine-red"
          >next →</Link>
          <ClosePeriodButton supplierId={id} period={period} closedAt={closedAt} closings={closings} />
          <ExportCsvButton
            rows={rows.map(r => ({
              sku: r.sku_name, opening: r.opening, delivered: r.delivered, b2c: r.b2c, b2b: r.b2b,
              ...(hasBuyouts ? { from_own: r.ownSold } : {}),
              total: r.billable, tastings: r.tastings,
              ...(hasBuyouts ? { bought_out: r.boughtOut } : {}),
              closing: r.closing,
              ...(hasBuyouts ? { own_left: r.ownRemaining } : {}),
              on_hand: r.onHand, hc: r.hc == null ? 'n/a' : r.hc, amount: r.amount == null ? 'n/a' : Math.round(r.amount),
            }))}
            period={period}
            supplierName={s.name}
          />
        </div>
      </div>

      {delTableMissing && (
        <p className="mb-3 text-[12px] text-wine-red">Deliveries table missing — apply migration 022_consignment_delivery.sql in Supabase (the Delivered column reads 0 until then).</p>
      )}

      {rows.length > 0 && (
        reconMismatches === 0 ? (
          <p className="mb-3 text-[12px] text-emerald-700">
            ✓ Closing{hasBuyouts && ' + our own bought-out stock'} reconciles with Loyverse on-hand on every SKU — safe to close the period.
          </p>
        ) : (
          <p className="mb-3 text-[12px] text-wine-red">
            ⚠ {reconMismatches} SKU{reconMismatches > 1 ? 's' : ''} differ from Loyverse on-hand (see the <strong>Loyverse</strong> column, red Δ).
            Reconcile before closing — Closing{hasBuyouts && ' plus our own unsold bought-out units'} should equal Loyverse ON HAND. Formula &gt; Loyverse = stock left without a sale (tasting/breakage/loss or opening drift);
            formula &lt; Loyverse = an arrival not logged on Deliveries.
          </p>
        )
      )}

      <ConsignmentReportTable supplierId={id} period={period} rows={rows} mode={mode} hasBuyouts={hasBuyouts} />

      <ReceiptExclusions supplierId={id} period={period} excluded={excluded} tableMissing={exclTableMissing} />

      {buyoutInvoices.length > 0 && (
        <section className="mt-6">
          <h3 className="font-heading text-lg text-deep-black">Own stock — bought out of consignment</h3>
          <p className="text-graphite text-sm mt-1 mb-3 max-w-3xl">
            Bottles we bought outright on a separate {s.name} invoice, so they are no longer part of the
            settlement above. Their money is spent the moment the invoice is issued; it comes back only as
            they sell. <strong>Sold</strong> = already through the till. <strong>Invoiced</strong> = billed
            to a B2B client who has not paid yet — gone from the shelf but still in Loyverse ON HAND.
            <strong> At partner</strong> = standing at a partner on our own consignment. <strong>In store</strong> =
            still here.
          </p>

          <div className="space-y-4">
            {buyoutInvoices.map(inv => (
              <div key={`${inv.invoiceNo ?? ''}|${inv.boughtAt}`} className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
                <div className="flex items-baseline justify-between gap-3 flex-wrap px-4 py-2 bg-cream/50 border-b border-pale-stone/60 text-[13px]">
                  <span>
                    <span className="font-medium text-deep-black">{inv.invoiceNo ?? 'no invoice no.'}</span>
                    <span className="text-graphite"> · {inv.boughtAt} · {inv.qty} bottle{inv.qty === 1 ? '' : 's'}</span>
                  </span>
                  <span className="tabular-nums text-graphite">
                    ฿{money(inv.subtotal)} + VAT ฿{money(inv.vat)} =
                    <span className="text-deep-black font-medium"> ฿{money(inv.total)}</span>
                  </span>
                </div>
                <table className="w-full text-[13px]">
                  <thead className="text-graphite border-b border-pale-stone bg-cream/20">
                    <tr>
                      <th className="py-2 px-4 text-left font-normal">SKU</th>
                      <th className="py-2 px-3 text-right font-normal">Bought</th>
                      <th className="py-2 px-3 text-right font-normal">฿ / unit</th>
                      <th className="py-2 px-3 text-right font-normal">Sold</th>
                      <th className="py-2 px-3 text-right font-normal">Invoiced</th>
                      <th className="py-2 px-3 text-right font-normal">At partner</th>
                      <th className="py-2 px-3 text-right font-normal">In store</th>
                      <th className="py-2 px-3 text-right font-normal">Unsold ฿</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lines.map(l => (
                      <tr key={l.sku_id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/30">
                        <td className="py-2 px-4 truncate max-w-[22rem]" title={l.sku_name}>
                          {l.sku_name}
                          {l.sku_code && <span className="ml-2 text-[10px] text-graphite/70 font-mono">{l.sku_code}</span>}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{l.qty}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-graphite">{l.unitPrice == null ? <span className="text-amber-gold">n/a</span> : money(l.unitPrice)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{l.soldOut || <span className="text-graphite/40">—</span>}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{l.inTransit || <span className="text-graphite/40">—</span>}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{l.atPartners || <span className="text-graphite/40">—</span>}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{l.inStore || <span className="text-graphite/40">—</span>}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{l.remainingValue ? `฿${money(l.remainingValue)}` : <span className="text-graphite/40">—</span>}</td>
                      </tr>
                    ))}
                    <tr className="bg-cream/60 font-medium">
                      <td className="py-2 px-4 text-graphite text-xs uppercase tracking-overline">Total</td>
                      <td className="py-2 px-3 text-right tabular-nums">{inv.qty}</td>
                      <td className="py-2 px-3"></td>
                      <td className="py-2 px-3 text-right tabular-nums">{inv.soldOut}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{inv.inTransit}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{inv.atPartners}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{inv.inStore}</td>
                      <td className="py-2 px-3 text-right tabular-nums">฿{money(inv.remainingValue)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="px-4 py-2 text-[11px] text-graphite border-t border-pale-stone/40">
                  Sold through the till: ฿{money(inv.soldValue)} pre-VAT ·{' '}
                  <strong className="text-deep-black">still unsold: ฿{money(inv.remainingValue)} pre-VAT</strong>
                  {inv.inTransit > 0 && <> · of which {inv.inTransit} bottle{inv.inTransit === 1 ? '' : 's'} worth ฿{money(inv.inTransitValue)} already invoiced to a client, awaiting payment</>}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {rows.length > 0 && (
        <div className="mt-4 flex justify-end">
          <div className="w-full max-w-xs bg-warm-white border border-pale-stone rounded-md overflow-hidden text-[13px]">
            <div className="flex justify-between px-4 py-2 border-b border-pale-stone/40">
              <span className="text-graphite">Settlement subtotal ({mode === 'retail_minus' ? 'pre-VAT' : 'HC'})</span>
              <span className="tabular-nums">฿{Math.round(subtotal).toLocaleString('en-US')}</span>
            </div>
            <div className="flex justify-between px-4 py-2 border-b border-pale-stone/40">
              <span className="text-graphite">VAT 7%</span>
              <span className="tabular-nums">฿{Math.round(vat).toLocaleString('en-US')}</span>
            </div>
            <div className="flex justify-between px-4 py-2.5 bg-cream/60 font-medium">
              <span className="text-deep-black">Total due to {s.name}</span>
              <span className="tabular-nums text-wine-red">฿{Math.round(grandTotal).toLocaleString('en-US')}</span>
            </div>
            {totals.ownSold > 0 && (
              <div className="px-4 py-2 text-[11px] text-graphite border-t border-pale-stone/40">
                {totals.ownSold} unit{totals.ownSold > 1 ? 's' : ''} sold this period came from our own
                bought-out stock and {totals.ownSold > 1 ? 'are' : 'is'} not in this total — already paid
                for on the buyout invoice below.
              </div>
            )}
            {unpricedSold > 0 && (
              <div className="px-4 py-2 text-[11px] text-amber-gold border-t border-pale-stone/40">
                {unpricedSold} sold SKU{unpricedSold > 1 ? 's' : ''} with no {unitWord} price (n/a) — not in this total. Add prices on the Consignment prices tab.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
