'use client'
import { useState } from 'react'
import { GRAPES } from '@/lib/pricelist/grapes'

// Multi-grape chip input for blends. Stores the value as a comma-joined string
// ("Chardonnay, Pinot Noir") so the rest of the pipeline is unchanged. Add via
// Enter, comma, or picking a suggestion; remove via × or Backspace-when-empty.
export function GrapeInput({ value, onChange, className }: {
  value?: string
  onChange: (v: string | undefined) => void
  className?: string
}) {
  const chips = (value ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const [draft, setDraft] = useState('')

  function commit(raw: string) {
    const t = raw.trim()
    if (!t) return
    if (!chips.some(c => c.toLowerCase() === t.toLowerCase())) onChange([...chips, t].join(', '))
    setDraft('')
  }
  function removeAt(i: number) {
    const next = chips.filter((_, idx) => idx !== i)
    onChange(next.length ? next.join(', ') : undefined)
  }

  return (
    <div className={`flex flex-wrap items-center gap-1 px-1.5 py-1 border border-pale-stone rounded bg-white ${className ?? ''}`}>
      {chips.map((c, i) => (
        <span key={c + i} className="inline-flex items-center gap-1 bg-cream text-graphite rounded px-1.5 py-0.5 text-xs">
          {c}
          <button type="button" onClick={() => removeAt(i)} className="text-graphite/60 hover:text-wine-red leading-none">×</button>
        </span>
      ))}
      <input
        list="pl-grapes"
        value={draft}
        placeholder={chips.length ? '+ grape' : 'Grape(s)'}
        className="flex-1 min-w-[70px] outline-none text-sm bg-transparent"
        onChange={e => {
          const v = e.target.value
          if (v.includes(',')) { commit(v.replace(/,/g, '')); return }
          // Picking a suggestion sets the full name → auto-add it as a chip.
          if (GRAPES.some(g => g.toLowerCase() === v.trim().toLowerCase())) { commit(v); return }
          setDraft(v)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(draft) }
          else if (e.key === 'Backspace' && !draft && chips.length) removeAt(chips.length - 1)
        }}
      />
    </div>
  )
}
