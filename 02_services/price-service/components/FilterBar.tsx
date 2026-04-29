'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { WINE_TYPE_LABELS, SPIRIT_TYPE_LABELS } from '@/lib/types-display'

type Props = {
  suppliers: string[]
  countries: string[]
  grapes: string[]
  spiritTypes: string[]
  category: string
  wineType: string
  spiritType: string
}

const CATEGORIES = [
  { value: '', label: 'Все' },
  { value: 'wine', label: '🍷 Вино' },
  { value: 'spirits', label: '🥃 Крепкий' },
  { value: 'beer', label: '🍺 Пиво' },
]

// Stable order for wine type chips. 'orange' may be empty in DB; we still
// render the chip so the UI taxonomy is fixed and predictable.
const WINE_TYPE_CHIPS = ['', 'red', 'white', 'rose', 'orange', 'sparkling']

export default function FilterBar({ suppliers, countries, grapes, spiritTypes, category, wineType, spiritType }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const update = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value)
        else params.delete(key)
      }
      params.delete('page')
      startTransition(() => router.push(`${pathname}?${params.toString()}`))
    },
    [pathname, router, searchParams]
  )

  const q = searchParams.get('q') ?? ''
  const supplier = searchParams.get('supplier') ?? ''
  const country = searchParams.get('country') ?? ''
  const grape = searchParams.get('grape') ?? ''
  const hasFilters = q || supplier || country || grape || category || wineType || spiritType

  return (
    <div className="flex flex-col gap-3">
      {/* Category tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {CATEGORIES.map(c => (
          <button
            key={c.value}
            onClick={() => update({ category: c.value, wine_type: '', spirit_type: '' })}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
              category === c.value
                ? 'bg-wine-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Wine type chips — only when category is wine */}
      {category === 'wine' && (
        <div className="flex items-center gap-1 flex-wrap">
          {WINE_TYPE_CHIPS.map(t => {
            const meta = t ? WINE_TYPE_LABELS[t] : null
            const label = t ? `${meta?.emoji} ${meta?.label}` : 'Все'
            return (
              <button
                key={t || 'all'}
                onClick={() => update({ wine_type: t })}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                  wineType === t
                    ? 'bg-gray-800 text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* Spirit type chips — only when category is spirits. Driven by what's
          actually in the DB so we don't show empty buckets. */}
      {category === 'spirits' && spiritTypes.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => update({ spirit_type: '' })}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
              spiritType === ''
                ? 'bg-gray-800 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            Все
          </button>
          {spiritTypes.map(t => {
            const meta = SPIRIT_TYPE_LABELS[t]
            const label = meta ? `${meta.emoji} ${meta.label}` : t
            return (
              <button
                key={t}
                onClick={() => update({ spirit_type: t })}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                  spiritType === t
                    ? 'bg-gray-800 text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* Search + dropdowns */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            defaultValue={q}
            onChange={e => update({ q: e.target.value })}
            placeholder="Поиск..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent"
          />
        </div>

        <Select value={supplier} onChange={v => update({ supplier: v })} placeholder="Все поставщики" options={suppliers} />
        <Select value={country} onChange={v => update({ country: v })} placeholder="Все страны" options={countries} />
        <Select value={grape} onChange={v => update({ grape: v })} placeholder="Все сорта" options={grapes} />

        {hasFilters && (
          <button
            onClick={() => startTransition(() => router.push(pathname))}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-xl hover:bg-gray-100 whitespace-nowrap"
          >
            Сбросить
          </button>
        )}
      </div>
    </div>
  )
}

function Select({ value, onChange, placeholder, options }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: string[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="py-2 pl-3 pr-8 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent text-gray-700 appearance-none cursor-pointer"
      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '16px' }}
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}
