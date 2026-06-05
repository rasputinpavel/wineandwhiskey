import Link from 'next/link'
import { sbInventory, type Supplier } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { NumCell, OverrideNumCell, ClosingCell, ExportCsvButton, ReceiptExclusions } from '@/components/modules/suppliers/ConsignmentReportCells'

const VAT_RATE = 0.07

export const dynamic = 'force-dynamic'

type SearchParams = { period?: string }

function lastClosedMonth(today = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// A supplier's billing cycle may start on a day other than the 1st (e.g.
// Harvest settles 5th-to-5th). Period "YYYY-MM" then covers
// [startDay of that month, startDay of the next month).
function periodRange(period: string, startDay: number): { startIso: string; endExclIso: string; label: string } {
  const [y, m] = period.split('-').map(Number)
  const d = Math.min(28, Math.max(1, Math.round(startDay) || 1))
  const start = new Date(Date.UTC(y, m - 1, d))
  const endExcl = new Date(Date.UTC(y, m, d))   // day d of the next month
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const endY = m === 12 ? y + 1 : y
  const label = d === 1
    ? `${MON[m - 1]} ${y}`
    : `${d} ${MON[m - 1]} – ${d} ${MON[m % 12]} ${endY}`
  return { startIso: start.toISOString(), endExclIso: endExcl.toISOString(), label }
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
  const prevPeriod = shiftMonth(period, -1)

  const [supRes, pricesRes] = await Promise.all([
    sbInventory.from('supplier').select('id, name, type, monthly_cycle_start_day').eq('id', id).maybeSingle(),
    sbInventory.from('consignment_price').select('sku_id, price_hc, sku:sku(id, name, loyverse_product_code, category)').eq('supplier_id', id).limit(2000),
  ])
  if (supRes.error) return <SchemaError error={supRes.error.message} />
  if (!supRes.data) return <div className="text-graphite">Supplier not found.</div>
  if (pricesRes.error) return <SchemaError error={pricesRes.error.message} />
  const s = supRes.data as Supplier
  // Billing-cycle start day (1 = calendar month; Harvest = 5 → 5th-to-5th).
  const cycleStartDay = Number((supRes.data as { monthly_cycle_start_day?: number }).monthly_cycle_start_day ?? 1)
  const { startIso, endExclIso, label } = periodRange(period, cycleStartDay)

  type SkuInfo = { id: string; name: string; loyverse_product_code: string | null; category: string | null }
  type PriceRow = { sku_id: string; price_hc: number | null; sku: SkuInfo | null }
  const priceRows = (pricesRes.data ?? []) as unknown as PriceRow[]
  const pricedIds = new Set(priceRows.map(p => p.sku_id))

  // Report cells (current + previous period; prev for opening-stock pre-fill).
  const { data: cellsRaw, error: cellsErr } = await sbInventory
    .from('consignment_report_cell')
    .select('sku_id, period, opening_stock, closing_stock, tastings, b2c_override, b2b_override, notes')
    .eq('supplier_id', id)
    .in('period', [period, prevPeriod])
  if (cellsErr) return <SchemaError error={cellsErr.message} />
  type Cell = { sku_id: string; period: string; opening_stock: number | null; closing_stock: number | null; tastings: number; b2c_override: number | null; b2b_override: number | null; notes: string | null }
  const cells = (cellsRaw ?? []) as Cell[]
  const cellByKey = new Map(cells.map(c => [`${c.sku_id}|${c.period}`, c]))

  // SKUs that have report cells but aren't priced yet — still show them with
  // HC = n/a so opening/closing reconcile; prices get added to the list later.
  const extraIds = [...new Set(cells.map(c => c.sku_id).filter(sid => !pricedIds.has(sid)))]
  const extraInfo = new Map<string, SkuInfo>()
  if (extraIds.length) {
    const { data } = await sbInventory.from('sku').select('id, name, loyverse_product_code, category').in('id', extraIds)
    for (const sk of (data ?? []) as SkuInfo[]) extraInfo.set(sk.id, sk)
  }

  // Unified SKU list: priced (with HC) first, then unpriced cell SKUs (HC null).
  type ReportSku = { sku_id: string; info: SkuInfo; hc: number | null }
  const reportSkus: ReportSku[] = []
  for (const p of priceRows) if (p.sku) reportSkus.push({ sku_id: p.sku_id, info: p.sku, hc: p.price_hc == null ? null : Number(p.price_hc) })
  for (const sid of extraIds) { const info = extraInfo.get(sid); if (info) reportSkus.push({ sku_id: sid, info, hc: null }) }

  const codeBySkuId = new Map(reportSkus.map(r => [r.sku_id, r.info.loyverse_product_code ?? null]))
  const skuIdByCode = new Map<string, string>()
  for (const [sid, code] of codeBySkuId) if (code) skuIdByCode.set(code, sid)

  // Receipts excluded from this period's settlement (e.g. off-consignment B2B
  // batches). Defensive: if migration 021 isn't applied yet, treat as empty.
  let excluded: string[] = []
  let exclTableMissing = false
  {
    const { data, error } = await sbInventory
      .from('consignment_report_exclusion').select('receipt_number')
      .eq('supplier_id', id).eq('period', period)
    if (error) exclTableMissing = true
    else excluded = (data ?? []).map((r: { receipt_number: string }) => r.receipt_number)
  }
  const excludedSet = new Set(excluded)

  // Pull receipts + lines for period and previous period (prev for opening-stock auto-fill).
  async function fetchReceipts(fromIso: string, toExclIso: string) {
    const all: any[] = []
    const PAGE = 1000
    for (let from = 0; from < 100000; from += PAGE) {
      const { data, error } = await sbInventory
        .from('loyverse_receipt')
        .select('id, receipt_number, receipt_type, is_b2b, receipt_date, loyverse_receipt_line(sku, qty)')
        .gte('receipt_date', fromIso)
        .lt('receipt_date', toExclIso)
        .range(from, from + PAGE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      all.push(...data)
      if (data.length < PAGE) break
    }
    return all
  }

  let monthReceipts: any[]
  try {
    monthReceipts = await fetchReceipts(startIso, endExclIso)
  } catch (e: any) { return <SchemaError error={String(e?.message ?? e)} /> }

  // Aggregate qty per SKU code, split by B2C/B2B (REFUND subtracts).
  const b2cBySku = new Map<string, number>()
  const b2bBySku = new Map<string, number>()
  for (const r of monthReceipts) {
    if (excludedSet.has(r.receipt_number)) continue
    const sign = r.receipt_type === 'REFUND' ? -1 : 1
    const target = r.is_b2b ? b2bBySku : b2cBySku
    for (const ln of (r.loyverse_receipt_line ?? []) as Array<{ sku: string | null; qty: number | null }>) {
      if (!ln.sku) continue
      if (!skuIdByCode.has(ln.sku)) continue
      target.set(ln.sku, (target.get(ln.sku) ?? 0) + Number(ln.qty ?? 0) * sign)
    }
  }

  // Deliveries (stock arrivals booked outside POs) within the period, summed
  // per SKU by delivery date. Defensive if migration 022 isn't applied yet.
  const deliveredBySku = new Map<string, number>()
  let delTableMissing = false
  {
    const startDate = startIso.slice(0, 10)
    const endExclDate = endExclIso.slice(0, 10)
    const { data, error } = await sbInventory
      .from('consignment_delivery').select('sku_id, qty')
      .eq('supplier_id', id).gte('delivered_at', startDate).lt('delivered_at', endExclDate)
    if (error) delTableMissing = true
    else for (const d of (data ?? []) as Array<{ sku_id: string; qty: number }>) {
      deliveredBySku.set(d.sku_id, (deliveredBySku.get(d.sku_id) ?? 0) + Number(d.qty))
    }
  }

  // Build rows.
  const rows = reportSkus
    .map(rs => {
      const sku = rs.info
      const code = sku.loyverse_product_code ?? ''
      const b2cAuto = Math.round(b2cBySku.get(code) ?? 0)
      const b2bAuto = Math.round(b2bBySku.get(code) ?? 0)
      const thisCell = cellByKey.get(`${rs.sku_id}|${period}`)
      const prevCell = cellByKey.get(`${rs.sku_id}|${prevPeriod}`)
      const opening = thisCell?.opening_stock ?? prevCell?.closing_stock ?? null
      const closingManual = thisCell?.closing_stock ?? null
      const tastings = thisCell?.tastings ?? 0
      const b2cOverride = thisCell?.b2c_override ?? null
      const b2bOverride = thisCell?.b2b_override ?? null
      const b2c = b2cOverride ?? b2cAuto
      const b2b = b2bOverride ?? b2bAuto
      const delivered = deliveredBySku.get(rs.sku_id) ?? 0
      const sold = b2c + b2b                               // billable units
      const closingAuto = opening != null ? opening + delivered - sold - tastings : null
      const closing = closingManual ?? closingAuto
      const hc = rs.hc                                     // null = not priced yet (n/a)
      const amount = hc == null ? null : sold * hc         // tastings are free → excluded
      return { sku_id: rs.sku_id, sku_name: sku.name, sku_code: code, opening, delivered, closing, closingAuto, closingManual, b2c, b2cAuto, b2cOverride, b2b, b2bAuto, b2bOverride, tastings, sold, hc, amount }
    })
    .sort((a, b) => (b.sold + b.tastings + b.delivered) - (a.sold + a.tastings + a.delivered) || a.sku_name.localeCompare(b.sku_name))

  const totals = rows.reduce((acc, r) => {
    acc.b2c += r.b2c; acc.b2b += r.b2b; acc.tastings += r.tastings; acc.sold += r.sold; acc.delivered += r.delivered
    acc.opening += r.opening ?? 0; acc.closing += r.closing ?? 0; acc.amount += r.amount ?? 0
    return acc
  }, { opening: 0, delivered: 0, b2c: 0, b2b: 0, tastings: 0, sold: 0, closing: 0, amount: 0 })

  const unpricedSold = rows.filter(r => r.hc == null && r.sold > 0).length

  const subtotal = totals.amount
  const vat = subtotal * VAT_RATE
  const grandTotal = subtotal + vat

  return (
    <>
      <div className="mb-4 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <Link href={`/m/suppliers/${id}`} className="text-xs text-graphite hover:text-wine-red">← Back to {s.name}</Link>
          <h2 className="font-heading text-2xl text-deep-black mt-3">{s.name} · Monthly sales report</h2>
          <p className="text-graphite text-sm mt-1 max-w-3xl">
            Auto-aggregates Loyverse sales (B2C + B2B) per SKU and prices the billable units at consignment HC + 7% VAT.
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
          <ExportCsvButton
            rows={rows.map(r => ({ sku: r.sku_name, opening: r.opening, delivered: r.delivered, b2c: r.b2c, b2b: r.b2b, total: r.sold, tastings: r.tastings, closing: r.closing, hc: r.hc == null ? 'n/a' : r.hc, amount: r.amount == null ? 'n/a' : Math.round(r.amount) }))}
            period={period}
            supplierName={s.name}
          />
        </div>
      </div>

      {delTableMissing && (
        <p className="mb-3 text-[12px] text-wine-red">Deliveries table missing — apply migration 022_consignment_delivery.sql in Supabase (the Delivered column reads 0 until then).</p>
      )}

      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="py-2 px-3 text-left font-normal">SKU</th>
              <th className="py-2 px-3 text-right font-normal">Opening</th>
              <th className="py-2 px-3 text-right font-normal">Delivered</th>
              <th className="py-2 px-3 text-right font-normal">Sold B2C</th>
              <th className="py-2 px-3 text-right font-normal">Sold B2B</th>
              <th className="py-2 px-3 text-right font-normal">TOTAL</th>
              <th className="py-2 px-3 text-right font-normal">Tastings</th>
              <th className="py-2 px-3 text-right font-normal">Closing</th>
              <th className="py-2 px-3 text-right font-normal">HC ฿</th>
              <th className="py-2 px-3 text-right font-normal">Amount ฿</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} className="py-6 text-center text-graphite text-sm">No SKUs priced for this supplier. Add consignment prices first.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.sku_id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                <td className="py-2 px-3 truncate max-w-[22rem]" title={r.sku_name}>
                  {r.sku_name}
                  {r.sku_code && <span className="ml-2 text-[10px] text-graphite/70 font-mono">{r.sku_code}</span>}
                </td>
                <td className="py-2 px-3 text-right">
                  <NumCell supplierId={id} skuId={r.sku_id} period={period} field="opening_stock" initial={r.opening} />
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-graphite">{r.delivered || <span className="text-graphite/40">—</span>}</td>
                <td className="py-2 px-3 text-right">
                  <OverrideNumCell supplierId={id} skuId={r.sku_id} period={period} field="b2c_override"
                    auto={r.b2cAuto} override={r.b2cOverride}
                    salesHref={`/m/suppliers/${id}/report/sales?period=${period}&sku_id=${r.sku_id}&channel=b2c`} />
                </td>
                <td className="py-2 px-3 text-right">
                  <OverrideNumCell supplierId={id} skuId={r.sku_id} period={period} field="b2b_override"
                    auto={r.b2bAuto} override={r.b2bOverride}
                    salesHref={`/m/suppliers/${id}/report/sales?period=${period}&sku_id=${r.sku_id}&channel=b2b`} />
                </td>
                <td className="py-2 px-3 text-right tabular-nums font-medium">{r.sold || <span className="text-graphite/40">—</span>}</td>
                <td className="py-2 px-3 text-right">
                  <NumCell supplierId={id} skuId={r.sku_id} period={period} field="tastings" initial={r.tastings || null} />
                </td>
                <td className="py-2 px-3 text-right">
                  <ClosingCell supplierId={id} skuId={r.sku_id} period={period} auto={r.closingAuto} override={r.closingManual} />
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-graphite">{r.hc == null ? <span className="text-amber-gold">n/a</span> : r.hc.toLocaleString('en-US')}</td>
                <td className="py-2 px-3 text-right tabular-nums font-medium">{r.amount == null ? <span className="text-amber-gold">n/a</span> : r.amount ? `฿${Math.round(r.amount).toLocaleString('en-US')}` : <span className="text-graphite/40">—</span>}</td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="bg-cream/60 font-medium">
                <td className="py-2 px-3 text-graphite text-xs uppercase tracking-overline">Total</td>
                <td className="py-2 px-3 text-right tabular-nums">{totals.opening}</td>
                <td className="py-2 px-3 text-right tabular-nums">{totals.delivered}</td>
                <td className="py-2 px-3 text-right tabular-nums">{totals.b2c}</td>
                <td className="py-2 px-3 text-right tabular-nums">{totals.b2b}</td>
                <td className="py-2 px-3 text-right tabular-nums">{totals.sold}</td>
                <td className="py-2 px-3 text-right tabular-nums">{totals.tastings}</td>
                <td className="py-2 px-3 text-right tabular-nums">{totals.closing}</td>
                <td className="py-2 px-3"></td>
                <td className="py-2 px-3 text-right tabular-nums">฿{Math.round(totals.amount).toLocaleString('en-US')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ReceiptExclusions supplierId={id} period={period} excluded={excluded} tableMissing={exclTableMissing} />

      {rows.length > 0 && (
        <div className="mt-4 flex justify-end">
          <div className="w-full max-w-xs bg-warm-white border border-pale-stone rounded-md overflow-hidden text-[13px]">
            <div className="flex justify-between px-4 py-2 border-b border-pale-stone/40">
              <span className="text-graphite">Settlement subtotal (HC)</span>
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
                {unpricedSold} sold SKU{unpricedSold > 1 ? 's' : ''} with no HC price (n/a) — not in this total. Add prices on the Consignment prices tab.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
