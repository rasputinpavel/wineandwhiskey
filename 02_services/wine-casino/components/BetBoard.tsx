'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Chip, ChipStack } from './Chip'
import { ChipPicker } from './ChipPicker'
import { usePrefersReducedMotion } from '@/lib/motion'
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
const FLIGHT_MS = 420

type Flight = { id: number; value: number; from: { x: number; y: number }; to: { x: number; y: number } }

export function BetBoard({ wineId, options, categories, chips, lang, onSave }: Props) {
  // slip is keyed "category:option" so a hedge inside one category is natural.
  // This is the exact same shape and the exact same semantics as before the
  // chip visuals: it still holds one number per key, it is still what
  // `lines`/`onSave` are built from, and nothing below gates on an animation.
  const [slip, setSlip] = useState<Record<string, number>>({})
  const [denom, setDenom] = useState(10)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reducedMotion = usePrefersReducedMotion()
  const [flights, setFlights] = useState<Flight[]>([])
  const flightSeq = useRef(0)
  const flightTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const pickerRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  // A new wine is a clean table.
  useEffect(() => { setSlip({}); setStatus('idle'); setError(null); setFlights([]) }, [wineId])

  // Flight timeouts outlive nothing: if the board unmounts (round closes,
  // countdown hits zero) while a chip is mid-air, don't call setState on a
  // dead component.
  useEffect(() => () => {
    flightTimers.current.forEach(id => clearTimeout(id))
    flightTimers.current.clear()
  }, [])

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
    // The slip updates synchronously, right here, before any animation or
    // vibration below even starts. A chip in flight is decoration on top of
    // a stake that is already on the table -- a second tap mid-animation
    // just adds another chip and starts a second, independent flight.
    setSlip(prev => ({ ...prev, [key]: (prev[key] ?? 0) + amount }))

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(10) } catch { /* not every browser supports it */ }
    }

    if (!reducedMotion) {
      const fromEl = pickerRefs.current[denom]
      const toEl = optionRefs.current[key]
      if (fromEl && toEl) {
        const fromRect = fromEl.getBoundingClientRect()
        const toRect = toEl.getBoundingClientRect()
        const id = ++flightSeq.current
        setFlights(prev => [...prev, {
          id,
          value: amount,
          from: { x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2 },
          to:   { x: toRect.right - 10, y: toRect.top + 2 },
        }])
        const tid = setTimeout(() => {
          setFlights(prev => prev.filter(fl => fl.id !== id))
          flightTimers.current.delete(tid)
        }, FLIGHT_MS + 60)
        flightTimers.current.add(tid)
      }
    }
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
        <ChipPicker
          value={denom}
          available={available}
          onChange={setDenom}
          lang={lang}
          registerRef={(d, el) => { pickerRefs.current[d] = el }}
        />
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
                      ref={el => { optionRefs.current[key] = el }}
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
                          className="absolute -right-1 -top-1 z-10"
                        >
                          <ChipStack amount={on} size={20} maxChips={4} />
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

      {/* Flying chips: purely cosmetic overlay, fixed to the viewport so it
          floats above the board regardless of scroll. Never read by onSave. */}
      {flights.map(f => <FlyingChip key={f.id} value={f.value} from={f.from} to={f.to} />)}

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

/** A chip that travels from the picker to the option the guest tapped, then
 *  disappears -- the real stack (above) is already showing the new total by
 *  the time this lands, so there is nothing for this to get wrong. */
function FlyingChip({ value, from, to }: { value: number; from: { x: number; y: number }; to: { x: number; y: number } }) {
  const [arrived, setArrived] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setArrived(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const dx = to.x - from.x
  const dy = to.y - from.y

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: from.x - 16,
        top: from.y - 16,
        zIndex: 50,
        pointerEvents: 'none',
        transform: arrived ? `translate(${dx}px, ${dy}px) scale(0.5)` : 'translate(0, 0) scale(1)',
        opacity: arrived ? 0 : 1,
        transition: `transform ${FLIGHT_MS}ms cubic-bezier(.2,.8,.2,1), opacity ${FLIGHT_MS}ms ease-in`,
      }}
    >
      <Chip value={value} size={32} />
    </div>
  )
}
