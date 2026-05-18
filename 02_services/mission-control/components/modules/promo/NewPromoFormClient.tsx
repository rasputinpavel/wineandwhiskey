'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  PROMO_MOODS, PROMO_MOOD_LABEL,
  type PromoMood,
} from '@/lib/promo/types'
import type { ProductImage } from '@/lib/promo/products'

// "Next Monday" relative to today — sensible default for "weekly" cadence.
function nextMonday(): string {
  const d = new Date()
  const day = d.getDay() // 0=Sun, 1=Mon, ...
  const add = ((1 - day + 7) % 7) || 7
  d.setDate(d.getDate() + add)
  return d.toISOString().slice(0, 10)
}

function plusDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function NewPromoFormClient({ products }: { products: ProductImage[] }) {
  const router = useRouter()
  const defaultStart = useMemo(nextMonday, [])

  const [theme,    setTheme]    = useState('')
  const [mechanic, setMechanic] = useState('')
  const [startsOn, setStartsOn] = useState(defaultStart)
  const [endsOn,   setEndsOn]   = useState(plusDays(defaultStart, 6))
  const [mood,     setMood]     = useState<PromoMood>('direct')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search,   setSearch]   = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return products
    const q = search.toLowerCase()
    return products.filter(p => p.slug.toLowerCase().includes(q))
  }, [products, search])

  function toggle(slug: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!theme.trim())    { setError('Theme is required'); return }
    if (!mechanic.trim()) { setError('Mechanic is required'); return }
    if (selected.size === 0) { setError('Pick at least one SKU'); return }
    if (endsOn < startsOn) { setError('End date must be ≥ start date'); return }

    setSubmitting(true)
    try {
      const res = await fetch('/api/m/promo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme, mechanic,
          starts_on: startsOn,
          ends_on:   endsOn,
          mood,
          sku_slugs: [...selected],
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to create promo'); return }
      router.push(`/m/promo/${json.campaign.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="bg-warm-white border border-pale-stone rounded-md p-5 space-y-5">
      <Field label="Theme *">
        <input
          autoFocus value={theme} onChange={e => setTheme(e.target.value)}
          placeholder="e.g. Brunello Week, Rosé Friday, New Arrivals from Piedmont"
          className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5 focus:outline-none focus:border-wine-red"
        />
      </Field>

      <Field label="Mechanic *">
        <input
          value={mechanic} onChange={e => setMechanic(e.target.value)}
          placeholder="e.g. -20%, 2 for 1, Free tasting, New arrival"
          className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5 focus:outline-none focus:border-wine-red"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Starts">
          <input type="date" value={startsOn}
            onChange={e => {
              setStartsOn(e.target.value)
              // Keep a sensible 7-day window if user changes start.
              if (endsOn < e.target.value) setEndsOn(plusDays(e.target.value, 6))
            }}
            className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
          />
        </Field>
        <Field label="Ends">
          <input type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)}
            className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
          />
        </Field>
      </div>

      <Field label="Mood (tone of voice)">
        <select value={mood} onChange={e => setMood(e.target.value as PromoMood)}
          className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5">
          {PROMO_MOODS.map(m => (
            <option key={m} value={m}>{PROMO_MOOD_LABEL[m]}</option>
          ))}
        </select>
      </Field>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="overline text-graphite">SKUs * <span className="text-graphite/60 normal-case">(click to pick)</span></div>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            className="text-xs border border-pale-stone bg-warm-white rounded-sm px-2 py-1 w-48"
          />
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {[...selected].map(slug => (
              <button key={slug} type="button" onClick={() => toggle(slug)}
                className="px-2 py-0.5 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep">
                {slug} ×
              </button>
            ))}
          </div>
        )}
        <div className="border border-pale-stone rounded-md bg-cream/20 p-2 max-h-[360px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-xs text-graphite p-3">No products match.</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
              {filtered.map(p => {
                const on = selected.has(p.slug)
                return (
                  <button
                    key={p.src} type="button" onClick={() => toggle(p.slug)}
                    title={p.slug}
                    className={
                      'group flex flex-col items-center text-[10px] gap-1 p-1.5 rounded-sm transition-colors '
                      + (on
                        ? 'bg-wine-red/10 ring-1 ring-wine-red'
                        : 'bg-warm-white hover:ring-1 hover:ring-pale-stone')
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.src} alt={p.slug} className="w-full h-16 object-contain" />
                    <span className={'truncate w-full text-center ' + (on ? 'text-wine-red font-medium' : 'text-graphite')}>
                      {p.slug.length > 14 ? p.slug.slice(0, 13) + '…' : p.slug}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {error && <div className="text-xs text-wine-red bg-wine-red/8 border border-wine-red/30 rounded-sm px-3 py-2">{error}</div>}

      <div className="flex items-center justify-end gap-2 pt-3 border-t border-pale-stone">
        <button type="button" onClick={() => router.back()}
          className="text-sm px-3 py-1.5 border border-pale-stone text-graphite rounded-sm hover:border-wine-red hover:text-wine-red">
          Cancel
        </button>
        <button type="submit" disabled={submitting}
          className="text-sm px-4 py-1.5 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep disabled:opacity-50">
          {submitting ? 'Creating…' : 'Create draft'}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="overline text-graphite">{label}</div>
      {children}
    </label>
  )
}
