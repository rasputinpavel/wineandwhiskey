'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Top3 = { id: string; name: string; score: number; reason: string }[]
type Report = {
  totalUnlinked: number
  toApplyCount: number
  appliedCount: number
  ambiguous: { b2bId: string; b2bName: string; top3: Top3 }[]
  noMatch: { b2bId: string; b2bName: string }[]
}

export function AutoMatchButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [open, setOpen] = useState(false)

  async function run() {
    setBusy(true)
    try {
      const res = await fetch('/api/m/customers/automatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await res.json()
      if (res.ok) {
        setReport(j)
        setOpen(true)
        router.refresh()
      } else {
        alert(j?.error ?? `HTTP ${res.status}`)
      }
    } finally { setBusy(false) }
  }

  async function applyOne(b2bId: string, lvId: string) {
    const res = await fetch('/api/m/customers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: b2bId, loyverse_customer_id: lvId }),
    })
    if (res.ok) {
      // Удаляем из доклада
      setReport(prev => prev ? { ...prev, ambiguous: prev.ambiguous.filter(a => a.b2bId !== b2bId) } : null)
      router.refresh()
    }
  }

  return (
    <>
      <button
        onClick={run}
        disabled={busy}
        className="px-3 py-1.5 text-xs rounded-sm border bg-warm-white text-deep-black border-pale-stone hover:border-wine-red hover:text-wine-red disabled:opacity-50"
        title="Авто-привязать b2b-клиентов к Loyverse customers по нормализованным именам + B2B-паттернам"
      >
        {busy ? 'Matching…' : '🔗 Auto-match Loyverse'}
      </button>

      {open && report && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-deep-black/40" onClick={() => setOpen(false)}>
          <div className="bg-warm-white border border-pale-stone rounded-md shadow-card-hover max-w-2xl w-[90vw] max-h-[80vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="font-heading text-lg text-deep-black">Auto-match Loyverse</h3>
              <button onClick={() => setOpen(false)} className="text-graphite hover:text-wine-red">✕</button>
            </div>

            <div className="text-sm mb-4 space-y-1">
              <div><span className="text-graphite">Unlinked customers:</span> <span className="font-medium tabular-nums">{report.totalUnlinked}</span></div>
              <div><span className="text-graphite">Auto-linked:</span> <span className="font-medium text-wine-red tabular-nums">{report.appliedCount}</span> / {report.toApplyCount}</div>
              <div><span className="text-graphite">Ambiguous (нужен ручной выбор):</span> <span className="font-medium tabular-nums">{report.ambiguous.length}</span></div>
              <div><span className="text-graphite">Без совпадений:</span> <span className="font-medium tabular-nums">{report.noMatch.length}</span></div>
            </div>

            {report.ambiguous.length > 0 && (
              <>
                <div className="text-xs text-graphite mb-2">Ambiguous — выбери вручную, если совпадение очевидно:</div>
                <div className="space-y-3 mb-4">
                  {report.ambiguous.map(a => (
                    <div key={a.b2bId} className="border border-pale-stone rounded-sm p-2">
                      <div className="text-sm text-deep-black mb-1">{a.b2bName}</div>
                      <div className="flex flex-col gap-1">
                        {a.top3.map(c => (
                          <button
                            key={c.id}
                            onClick={() => applyOne(a.b2bId, c.id)}
                            className="text-left text-xs px-2 py-1 rounded-sm hover:bg-cream flex justify-between items-center gap-2"
                          >
                            <span className="text-deep-black">{c.name}</span>
                            <span className="text-[10px] text-graphite whitespace-nowrap">
                              {Math.round(c.score * 100)}% · {c.reason}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {report.noMatch.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-graphite hover:text-wine-red">
                  {report.noMatch.length} customers без подходящих Loyverse-кандидатов
                </summary>
                <ul className="mt-2 space-y-0.5 text-graphite">
                  {report.noMatch.map(n => <li key={n.b2bId}>· {n.b2bName}</li>)}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
    </>
  )
}
