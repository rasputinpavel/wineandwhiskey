import { sbInventory, type FixedCost, type PulseSettings } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import {
  CategoryCell, AmountCell, ActiveCell, DeleteCell, NewCostRow, BufferCell,
} from '@/components/modules/pulse/FixedCostCells'
import { fmtThb } from '@/lib/kpi'

export const dynamic = 'force-dynamic'

export default async function PulseSettingsPage() {
  const [costsRes, settingsRes] = await Promise.all([
    sbInventory.from('fixed_cost').select('*').order('sort_order', { ascending: true }).order('category', { ascending: true }),
    sbInventory.from('pulse_settings').select('*').eq('id', 1).maybeSingle(),
  ])
  if (costsRes.error) return <SchemaError error={costsRes.error.message} />
  if (settingsRes.error) return <SchemaError error={settingsRes.error.message} />

  const rows = (costsRes.data ?? []) as FixedCost[]
  const settings = (settingsRes.data as PulseSettings | null) ?? { id: 1, fixed_buffer_pct: 15, updated_at: '' }
  const activeRows   = rows.filter(r => r.active)
  const fixedRows    = activeRows.filter(r => r.percent_revenue == null)
  const pctRows      = activeRows.filter(r => r.percent_revenue != null)
  const fixedSum     = fixedRows.reduce((s, r) => s + Number(r.amount_thb ?? 0), 0)
  const pctSum       = pctRows.reduce((s, r) => s + Number(r.percent_revenue ?? 0), 0)
  const inactiveCount = rows.filter(r => !r.active).length

  return (
    <>
      <h2 className="font-heading text-xl text-deep-black mb-1">Monthly fixed costs</h2>
      <p className="text-graphite text-sm mb-4 max-w-3xl">
        Recurring costs you&apos;d pay even if the shop was closed. Each row is either a flat THB/month
        amount or a percent of revenue (taxes, royalties, etc.). The buffer % on top covers small
        unexpected one-offs (repairs, surprise fees) that don&apos;t deserve their own line.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-warm-white border border-pale-stone rounded-md p-3 shadow-card">
          <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">Fixed THB (active)</div>
          <div className="font-display text-2xl tracking-display text-deep-black leading-none">{fmtThb(fixedSum)}</div>
          <div className="text-[10px] text-graphite mt-1">{fixedRows.length} categories</div>
        </div>
        <div className="bg-warm-white border border-pale-stone rounded-md p-3 shadow-card">
          <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">% of revenue (active)</div>
          <div className="font-display text-2xl tracking-display text-deep-black leading-none">
            {pctSum.toLocaleString('en-US', { maximumFractionDigits: 1 })}<span className="text-graphite text-lg ml-0.5">%</span>
          </div>
          <div className="text-[10px] text-graphite mt-1">{pctRows.length} categories</div>
        </div>
        <div className="bg-warm-white border border-pale-stone rounded-md p-3 shadow-card">
          <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">Buffer (one-offs)</div>
          <BufferCell initial={Number(settings.fixed_buffer_pct ?? 15)} />
          <div className="text-[10px] text-graphite mt-1">on top of Fixed THB</div>
        </div>
        <div className="bg-warm-white border border-pale-stone rounded-md p-3 shadow-card">
          <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">Inactive rows</div>
          <div className="font-display text-2xl tracking-display text-graphite leading-none">{inactiveCount}</div>
          <div className="text-[10px] text-graphite mt-1">kept for history</div>
        </div>
      </div>

      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="py-2 px-4 text-left font-normal">Category</th>
              <th className="py-2 px-4 text-right font-normal">Amount</th>
              <th className="py-2 px-4 text-center font-normal">Status</th>
              <th className="py-2 px-4 text-right font-normal w-12"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                <td className="py-2 px-4"><CategoryCell id={r.id} initial={r.category} /></td>
                <td className="py-2 px-4 text-right"><AmountCell id={r.id} amountThb={r.amount_thb} percentRevenue={r.percent_revenue} /></td>
                <td className="py-2 px-4 text-center"><ActiveCell id={r.id} initial={r.active} /></td>
                <td className="py-2 px-4 text-right"><DeleteCell id={r.id} category={r.category} /></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-graphite text-sm">
                  No fixed costs yet. Add the first one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <NewCostRow />
    </>
  )
}
