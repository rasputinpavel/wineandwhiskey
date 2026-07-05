import Link from 'next/link'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { ExportCsvButton, ReceiptExclusions, ClosePeriodButton } from '@/components/modules/suppliers/ConsignmentReportCells'
import { ConsignmentReportTable } from '@/components/modules/suppliers/ConsignmentReportTable'
import { computeConsignmentSettlement, shiftMonth } from '@/lib/consignment-settlement'

export const dynamic = 'force-dynamic'

type SearchParams = { period?: string }

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
            rows={rows.map(r => ({ sku: r.sku_name, opening: r.opening, delivered: r.delivered, b2c: r.b2c, b2b: r.b2b, total: r.sold, tastings: r.tastings, closing: r.closing, on_hand: r.onHand, hc: r.hc == null ? 'n/a' : r.hc, amount: r.amount == null ? 'n/a' : Math.round(r.amount) }))}
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
            ✓ Closing reconciles with Loyverse on-hand on every SKU — safe to close the period.
          </p>
        ) : (
          <p className="mb-3 text-[12px] text-wine-red">
            ⚠ {reconMismatches} SKU{reconMismatches > 1 ? 's' : ''} differ from Loyverse on-hand (see the <strong>Loyverse</strong> column, red Δ).
            Reconcile before closing — every Closing should equal Loyverse ON HAND. Formula &gt; Loyverse = stock left without a sale (tasting/breakage/loss or opening drift);
            formula &lt; Loyverse = an arrival not logged on Deliveries.
          </p>
        )
      )}

      <ConsignmentReportTable supplierId={id} period={period} rows={rows} mode={mode} />

      <ReceiptExclusions supplierId={id} period={period} excluded={excluded} tableMissing={exclTableMissing} />

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
