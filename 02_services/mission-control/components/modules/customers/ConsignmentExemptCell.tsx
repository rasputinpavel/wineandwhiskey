'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Per-invoice ruling for a consignment customer: did this invoice bill stock
// that stood on THEIR shelf, or stock we sold them alongside the arrangement?
// v_consignment_balance subtracts the first kind and must ignore the second
// (migration 048). Nothing in the data tells them apart — a person does.
export function ConsignmentExemptCell({ invoiceId, initial, overShelf }: {
  invoiceId: string
  initial: boolean
  overShelf: boolean   // bills more of some SKU than any delivery note ever carried
}) {
  const router = useRouter()
  const [exempt, setExempt] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function toggle() {
    const next = !exempt
    setSaving(true)
    try {
      const res = await fetch('/api/m/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: invoiceId, consignment_exempt: next }),
      })
      if (res.ok) {
        setExempt(next)
        router.refresh()
      }
    } finally { setSaving(false) }
  }

  // Unmarked but billing beyond the shelf — the shape of a sale on top that
  // nobody has ruled on yet. This is the case that silently eats the balance.
  const suspicious = !exempt && overShelf

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={toggle}
        disabled={saving}
        className={`text-[10px] px-1.5 py-0.5 rounded-sm border transition-colors disabled:opacity-50 hover:opacity-80 ${
          exempt
            ? 'bg-wine-red/10 text-wine-red border-wine-red/40'
            : 'bg-cream text-graphite border-pale-stone'
        }`}
        title={exempt
          ? 'Продажа поверх полки: баланс на локации не трогает. Click чтобы вернуть в отчёт о продажах с полки.'
          : 'Отчёт о продажах с полки: списывает бутылки с баланса локации. Click если это была продажа поверх полки.'}
      >
        {exempt ? 'off shelf' : 'from shelf'}
      </button>
      {suspicious && (
        <span
          className="text-[10px] text-wine-red cursor-help"
          title="В счёте больше бутылок, чем когда-либо привозили по накладным на эту локацию. Похоже на продажу поверх полки — если так, переключи на «off shelf», иначе баланс обнулится."
        >
          ⚠
        </span>
      )}
    </div>
  )
}
