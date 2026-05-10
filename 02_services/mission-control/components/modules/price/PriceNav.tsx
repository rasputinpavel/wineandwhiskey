'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/m/price',              label: 'Каталог' },
  { href: '/m/price/upload',       label: 'Загрузить' },
  { href: '/m/price/price-lists',  label: 'Прайс-листы' },
]

export function PriceNav() {
  const pathname = usePathname() || ''
  return (
    <nav className="flex gap-1 px-6 py-2 bg-warm-white border-b border-pale-stone">
      {TABS.map(t => {
        const active = t.href === '/m/price'
          ? pathname === t.href
          : pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-1.5 text-xs rounded-sm transition-colors ${
              active
                ? 'bg-wine-red text-warm-white'
                : 'text-graphite hover:text-wine-red hover:bg-cream'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
