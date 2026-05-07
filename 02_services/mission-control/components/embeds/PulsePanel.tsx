'use client'

const STUBS = [
  { label: 'Revenue MTD',       value: '—', unit: '฿' },
  { label: 'Gross profit MTD',  value: '—', unit: '฿' },
  { label: 'Inventory turnover',value: '—', unit: 'days' },
  { label: 'Cash position',     value: '—', unit: '฿' },
  { label: 'Stock health',      value: '—', unit: 'OOS·OVER·DEAD' },
]

export function PulsePanel() {
  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        <h2 className="font-display text-3xl tracking-display text-deep-black uppercase mb-2">
          Pulse
        </h2>
        <p className="text-graphite text-sm mb-8">
          KPI-мост: live-метрики со всех источников. Пока — каркас.
          Подключим по одной: revenue → GP → cash → turnover → stock.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {STUBS.map(k => (
            <div key={k.label} className="bg-warm-white border border-pale-stone rounded-md p-5 shadow-card">
              <div className="overline text-graphite mb-3">{k.label}</div>
              <div className="flex items-baseline gap-2">
                <div className="font-display text-4xl tracking-display text-deep-black leading-none">
                  {k.value}
                </div>
                <div className="text-xs text-graphite">{k.unit}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
