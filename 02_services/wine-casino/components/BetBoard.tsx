'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChipPicker } from './ChipPicker'
import { pick, t } from '@/lib/i18n'
import type { CategoryDef, Lang, OptionSet } from '@/lib/types'
import type { BetLine } from '@/lib/bets'

type Props = {
  wineId: string
  options: OptionSet
  categories: CategoryDef[]
  chips: number
  lang: Lang
  onSave: (slip: BetLine[]) => Promise<{ ok: boolean; error?: string }>
}

const AUTOSAVE_MS = 600

export function BetBoard({ wineId, options, categories, chips, lang, onSave }: Props) {
  // slip is keyed "category:option" so a hedge inside one category is natural.
  const [slip, setSlip] = useState<Record<string, number>>({})
  const [denom, setDenom] = useState(10)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A new wine is a clean table.
  useEffect(() => { setSlip({}); setStatus('idle'); setError(null) }, [wineId])

  const staked = useMemo(() => Object.values(slip).reduce((s, n) => s + n, 0), [slip])
  const available = chips - staked

  const lines: BetLine[] = useMemo(
    () => Object.entries(slip)
      .filter(([, amount]) => amount > 0)
      .map(([key, amount]) => {
        const [category, ...rest] = key.split(':')
        return { category: category as BetLine['category'], option: rest.join(':'), amount }
      }),
    [slip],
  )

  // Autosave: every tap is persisted within a second, so a phone that dies
  // mid-round still has its bets on the table.
  useEffect(() => {
    if (status === 'idle' && lines.length === 0) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setStatus('saving')
      const res = await onSave(lines)
      if (res.ok) { setStatus('saved'); setError(null) }
      else { setStatus('error'); setError(res.error ?? 'errGeneric') }
    }, AUTOSAVE_MS)
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines])

  function add(category: string, option: string) {
    const key = `${category}:${option}`
    const amount = Math.min(denom, available)
    if (amount <= 0) { setError('errBank'); return }
    setError(null)
    setSlip(prev => ({ ...prev, [key]: (prev[key] ?? 0) + amount }))
  }

  function clearOne(category: string, option: string) {
    const key = `${category}:${option}`
    setSlip(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  return (
    <div className="pb-32">
      <div className="sticky top-0 z-10 -mx-4 mb-4 bg-deep-black/95 px-4 py-3 backdrop-blur">
        <ChipPicker value={denom} available={available} onChange={setDenom} />
      </div>

      <div className="space-y-6">
        {categories.map(cat => {
          const board = options[cat.key]
          if (!board || board.length === 0) return null
          return (
            <section key={cat.key}>
              <header className="mb-2 flex items-baseline justify-between">
                <h2 className="font-heading text-sm uppercase tracking-overline text-pale-stone">
                  {pick(cat, lang)}
                </h2>
                <span className="font-display text-lg text-amber-gold">×{cat.multiplier}</span>
              </header>
              <div className="grid grid-cols-2 gap-2">
                {board.map(opt => {
                  const key = `${cat.key}:${opt.value}`
                  const on = slip[key] ?? 0
                  return (
                    <button
                      key={opt.value}
                      onClick={() => add(cat.key, opt.value)}
                      onContextMenu={e => { e.preventDefault(); clearOne(cat.key, opt.value) }}
                      className={[
                        'relative min-h-[56px] rounded-md border px-3 py-2 text-left text-sm',
                        on > 0
                          ? 'border-amber-gold bg-felt-light'
                          : 'border-pale-stone/25 bg-felt/60',
                      ].join(' ')}
                    >
                      {pick(opt, lang)}
                      {on > 0 && (
                        <span
                          onClick={e => { e.stopPropagation(); clearOne(cat.key, opt.value) }}
                          className="absolute -right-1 -top-1 flex h-7 min-w-7 items-center justify-center rounded-full bg-amber-gold px-1 font-display text-sm tabular-nums text-deep-black"
                        >
                          {on}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-pale-stone/20 bg-deep-black/95 px-4 py-3 backdrop-blur">
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-pale-stone">{t('onTable', lang)}: <b className="text-warm-white">{staked}</b></span>
          <span className="text-pale-stone">{t('available', lang)}: <b className="text-warm-white">{available}</b></span>
        </div>
        {error && <p className="mb-2 text-sm text-wine-red">{t(error as 'errGeneric', lang)}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => setSlip({})}
            className="rounded-md border border-pale-stone/40 px-4 py-3 text-sm text-pale-stone"
          >
            {t('clearAll', lang)}
          </button>
          <button
            onClick={async () => { setStatus('saving'); const r = await onSave(lines); setStatus(r.ok ? 'saved' : 'error') }}
            className="flex-1 rounded-md bg-amber-gold py-3 font-heading text-deep-black"
          >
            {status === 'saved' ? t('betsSaved', lang) : t('placeBet', lang)}
          </button>
        </div>
      </div>
    </div>
  )
}
