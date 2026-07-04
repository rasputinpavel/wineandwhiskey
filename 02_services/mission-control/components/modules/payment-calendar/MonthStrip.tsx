'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

// Клиентский переключатель месяцев. Навигацию делаем настоящими <Link> — App Router
// надёжно ре-рендерит RSC при смене ?month= (router.push для search-only перехода
// в рамках сегмента триггерил ре-рендер нестабильно → «то фильтрует, то нет»).
// Для мгновенной обратной связи держим оптимистичную цель: подсвечиваем кликнутый
// таб сразу и гасим полосу, пока сервер не догонит (target === selected). Текущий
// месяц помечаем янтарной рамкой.
type MonthOpt = { ym: string; label: string }

export function MonthStrip({ months, selected, currentYM }: {
  months: MonthOpt[]
  selected: string | null
  currentYM: string
}) {
  const [target, setTarget] = useState<string | null>(selected)

  // Сервер догнал (или был back/forward) → синхронизируем оптимистичную цель.
  useEffect(() => { setTarget(selected) }, [selected])

  const pending = target !== selected   // навигация в полёте — гасим полосу
  const active = target                 // подсвечиваем кликнутый таб мгновенно

  const base = 'px-2 py-1 rounded-sm border transition-colors cursor-pointer'
  function cls(ym: string | null) {
    if (ym === active) return `${base} bg-wine-red text-warm-white border-wine-red`
    if (ym !== null && ym === currentYM)
      return `${base} bg-warm-white text-deep-black border-amber-gold font-medium hover:border-wine-red hover:text-wine-red`
    return `${base} bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red`
  }

  return (
    <div className={`flex gap-1 mb-5 text-[11px] flex-wrap transition-opacity ${pending ? 'opacity-60' : ''}`}>
      <Link href="/m/payment-calendar" onClick={() => setTarget(null)} className={cls(null)}>Open</Link>
      {months.map(m => (
        <Link
          key={m.ym}
          href={`/m/payment-calendar?month=${m.ym}`}
          onClick={() => setTarget(m.ym)}
          className={cls(m.ym)}
        >
          {m.label}
        </Link>
      ))}
    </div>
  )
}
