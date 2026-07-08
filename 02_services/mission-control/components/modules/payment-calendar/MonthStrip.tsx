import Link from 'next/link'

// Переключатель месяцев — простые серверные <Link>, как в Pulse (который работает).
// Подсветка активного таба берётся напрямую из `selected` (реального URL), а не из
// клиентской оптимистичной цели — раньше таб и данные таблицы брались из разных
// источников и рассинхронивались («таб красный, а таблица прежняя»). Обратную связь
// при переходе даёт loading.tsx-скелетон. Текущий месяц помечен янтарной рамкой.
type MonthOpt = { ym: string; label: string }

export function MonthStrip({ months, selected, currentYM }: {
  months: MonthOpt[]
  selected: string | null
  currentYM: string
}) {
  const base = 'px-2 py-1 rounded-sm border transition-colors'
  function cls(ym: string | null) {
    if (ym === selected) return `${base} bg-wine-red text-warm-white border-wine-red`
    if (ym !== null && ym === currentYM)
      return `${base} bg-warm-white text-deep-black border-amber-gold font-medium hover:border-wine-red hover:text-wine-red`
    return `${base} bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red`
  }

  return (
    <div className="flex gap-1 mb-5 text-[11px] flex-wrap">
      <Link href="/m/payment-calendar" className={cls(null)}>Open</Link>
      {months.map(m => (
        <Link key={m.ym} href={`/m/payment-calendar?month=${m.ym}`} className={cls(m.ym)}>
          {m.label}
        </Link>
      ))}
    </div>
  )
}
