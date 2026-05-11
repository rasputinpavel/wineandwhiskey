'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/m/suppliers',                 label: 'List' },
  { href: '/m/suppliers/purchase-orders', label: 'Purchase Orders' },
]

export function SuppliersNav() {
  const pathname = usePathname() || ''
  return (
    <nav className="flex gap-1 px-6 py-2 bg-warm-white border-b border-pale-stone">
      {TABS.map(t => {
        const active = t.href === '/m/suppliers'
          ? pathname === t.href || /^\/m\/suppliers\/[^/]+$/.test(pathname)
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
