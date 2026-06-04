'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

const COLORS = [
  { key: 'red',       label: 'Red' },
  { key: 'white',     label: 'White' },
  { key: 'rose',      label: 'Rosé' },
  { key: 'sparkling', label: 'Sparkling' },
]

const BUDGETS = [
  { key: '1000', label: '< ฿1k' },
  { key: '2000', label: '< ฿2k' },
  { key: '4000', label: '< ฿4k' },
]

export function CatalogFilters({ countries }: { countries: string[] }) {
  const router = useRouter()
  const sp = useSearchParams()
  const color = sp.get('color') ?? ''
  const country = sp.get('country') ?? ''
  const max = sp.get('max') ?? ''

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(sp.toString())
    if (value && next.get(name) !== value) next.set(name, value)
    else next.delete(name)
    router.replace(`/catalog?${next.toString()}`)
  }

  return (
    <div className="bg-warm-white px-6 pt-6 pb-4 border-b border-pale-stone">
      <div className="flex items-center justify-between mb-4">
        <Link href="/" className="overline text-graphite active:text-deep-black">← Home</Link>
        <div className="font-display text-3xl tracking-display text-deep-black">CATALOG</div>
        <div className="w-16" />
      </div>

      <FilterRow label="Color" current={color} onPick={v => setParam('color', v)} items={COLORS} />
      <FilterRow label="Budget" current={max} onPick={v => setParam('max', v)} items={BUDGETS} />
      <FilterRow
        label="Country"
        current={country.toLowerCase()}
        onPick={v => setParam('country', v)}
        items={countries.map(c => ({ key: c.toLowerCase(), label: c }))}
        scrollable
      />
    </div>
  )
}

function FilterRow({
  label, current, onPick, items, scrollable,
}: {
  label: string
  current: string
  onPick: (v: string) => void
  items: { key: string; label: string }[]
  scrollable?: boolean
}) {
  return (
    <div className="mb-3">
      <div className="overline text-graphite mb-2">{label}</div>
      <div className={`flex gap-2 ${scrollable ? 'overflow-x-auto pb-1' : 'flex-wrap'}`}>
        {items.map(it => {
          const active = current === it.key
          return (
            <button
              key={it.key}
              onClick={() => onPick(active ? '' : it.key)}
              className={`px-4 h-12 rounded-md font-heading font-semibold whitespace-nowrap ${
                active
                  ? 'bg-deep-black text-warm-white'
                  : 'bg-cream text-deep-black active:bg-pale-stone'
              }`}
            >
              {it.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
