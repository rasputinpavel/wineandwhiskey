'use client'

import { useState, useTransition } from 'react'
import { updateSkuWineAttrs, type WineColor } from '@/app/(portal)/m/inventory/sku/[...code]/actions'

const COLORS: { value: WineColor | ''; label: string }[] = [
  { value: '',          label: '— None —' },
  { value: 'red',       label: 'Red' },
  { value: 'white',     label: 'White' },
  { value: 'rose',      label: 'Rosé' },
  { value: 'sparkling', label: 'Sparkling' },
  { value: 'orange',    label: 'Orange' },
]

export function WineAttrsEditor(props: {
  skuId:          string
  wine_color:     WineColor | null
  grape_variety:  string | null
  wine_country:   string | null
  source:         'auto' | 'manual' | null
}) {
  const [color,   setColor]   = useState<WineColor | ''>(props.wine_color ?? '')
  const [grape,   setGrape]   = useState(props.grape_variety ?? '')
  const [country, setCountry] = useState(props.wine_country ?? '')
  const [status,  setStatus]  = useState<'idle' | 'saved' | 'error'>('idle')
  const [errMsg,  setErrMsg]  = useState<string | null>(null)
  const [isPending, start]    = useTransition()

  const dirty =
    (color   || null) !== (props.wine_color   ?? null) ||
    grape.trim()      !== (props.grape_variety ?? '') ||
    country.trim()    !== (props.wine_country  ?? '')

  function save() {
    setStatus('idle'); setErrMsg(null)
    start(async () => {
      const res = await updateSkuWineAttrs({
        skuId:         props.skuId,
        wine_color:    color || null,
        grape_variety: grape,
        wine_country:  country,
      })
      if (res.ok) setStatus('saved')
      else { setStatus('error'); setErrMsg(res.error) }
    })
  }

  return (
    <div className="mb-8 rounded-md border border-pale-stone bg-warm-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-graphite font-semibold">Wine attrs</div>
        <div className="text-[10px] text-graphite/70">
          {props.source === 'manual' ? 'manual override' : props.source === 'auto' ? 'auto-seeded' : 'unset'}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-xs text-graphite">
          Color
          <select
            value={color}
            onChange={e => setColor(e.target.value as WineColor | '')}
            className="mt-1 w-full px-2 py-1.5 text-sm bg-cream border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
          >
            {COLORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-graphite">
          Grape variety
          <input
            value={grape}
            onChange={e => setGrape(e.target.value)}
            placeholder="e.g. Chardonnay"
            className="mt-1 w-full px-2 py-1.5 text-sm bg-cream border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
          />
        </label>
        <label className="text-xs text-graphite">
          Country
          <input
            value={country}
            onChange={e => setCountry(e.target.value)}
            placeholder="e.g. France"
            className="mt-1 w-full px-2 py-1.5 text-sm bg-cream border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          disabled={!dirty || isPending}
          className="px-3 py-1.5 text-xs rounded-sm bg-wine-red text-warm-white hover:bg-burgundy-deep disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        {status === 'saved' && <span className="text-xs text-graphite">Saved.</span>}
        {status === 'error' && <span className="text-xs text-wine-red">Error: {errMsg}</span>}
      </div>
    </div>
  )
}
