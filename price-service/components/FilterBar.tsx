'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useTransition } from 'react'

type Props = {
  suppliers: string[]
  countries: string[]
  grapes: string[]
}

export default function FilterBar({ suppliers, countries, grapes }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      params.delete('page')
      startTransition(() => router.push(`${pathname}?${params.toString()}`))
    },
    [pathname, router, searchParams]
  )

  const q = searchParams.get('q') ?? ''
  const supplier = searchParams.get('supplier') ?? ''
  const country = searchParams.get('country') ?? ''
  const grape = searchParams.get('grape') ?? ''
  const hasFilters = q || supplier || country || grape

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px]">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          type="text"
          defaultValue={q}
          onChange={e => update('q', e.target.value)}
          placeholder="Поиск вина..."
          className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent"
        />
      </div>

      {/* Supplier */}
      <Select
        value={supplier}
        onChange={v => update('supplier', v)}
        placeholder="Все поставщики"
        options={suppliers}
      />

      {/* Country */}
      <Select
        value={country}
        onChange={v => update('country', v)}
        placeholder="Все страны"
        options={countries}
      />

      {/* Grape */}
      <Select
        value={grape}
        onChange={v => update('grape', v)}
        placeholder="Все сорта"
        options={grapes}
      />

      {hasFilters && (
        <button
          onClick={() => {
            startTransition(() => router.push(pathname))
          }}
          className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-xl hover:bg-gray-100 whitespace-nowrap"
        >
          Сбросить
        </button>
      )}
    </div>
  )
}

function Select({
  value, onChange, placeholder, options,
}: {
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
