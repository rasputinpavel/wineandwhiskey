import { sbInventory, type FixedCost } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import {
  CategoryCell, AmountCell, ActiveCell, DeleteCell, NewCostRow,
} from '@/components/modules/pulse/FixedCostCells'
import { fmtThb } from '@/lib/kpi'

export const dynamic = 'force-dynamic'

export default async function PulseSettingsPage() {
  const { data, error } = await sbInventory
    .from('fixed_cost')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('category', { ascending: true })

  if (error) return <SchemaError error={error.message} />

  const rows = (data ?? []) as FixedCost[]
  const activeSum = rows.filter(r => r.active).reduce((s, r) => s + Number(r.amount_thb), 0)
  const inactiveCount = rows.filter(r => !r.active).length

  return (
    <>
      <h2 className="font-heading text-xl text-deep-black mb-1">Monthly fixed costs</h2>
      <p className="text-graphite text-sm mb-4 max-w-3xl">
        Costs you&apos;d pay even if the shop was closed for the month: rent, payroll, utilities, fees.
        Sum of active rows ÷ 30 ÷ trailing-30d GM% is the daily break-even revenue shown on the dashboard.
        Inactive rows are kept for history but excluded from the total.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-warm-white border border-pale-stone rounded-md p-3 shadow-card">
          <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">Monthly fixed (active)</div>
          <div className="font-display text-2xl tracking-display text-deep-black leading-none">{fmtThb(activeSum)}</div>
          <div className="text-[10px] text-graphite mt-1">{rows.filter(r => r.active).length} categories</div>
        </div>
        <div className="bg-warm-white border border-pale-stone rounded-md p-3 shadow-card">
          <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">Daily fixed</div>
          <div className="font-display text-2xl tracking-display text-deep-black leading-none">{fmtThb(activeSum / 30)}</div>
          <div className="text-[10px] text-graphite mt-1">monthly ÷ 30</div>
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
              <th className="py-2 px-4 text-right font-normal">THB / month</th>
              <th className="py-2 px-4 text-center font-normal">Status</th>
              <th className="py-2 px-4 text-right font-normal w-12"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                <td className="py-2 px-4"><CategoryCell id={r.id} initial={r.category} /></td>
                <td className="py-2 px-4 text-right"><AmountCell id={r.id} initial={Number(r.amount_thb)} /></td>
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
