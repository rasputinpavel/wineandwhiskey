'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/m/inventory',                label: 'Breakdown' },
  { href: '/m/inventory/b2b',            label: 'B2B outstanding' },
  { href: '/m/inventory/customers',      label: 'B2B customers' },
  { href: '/m/inventory/consignment',    label: 'Consignment' },
  { href: '/m/inventory/admin/unmapped', label: 'Unmapped lines' },
]

export function InventoryNav() {
  const pathname = usePathname() || ''
  return (
    <nav className="flex gap-1 px-6 py-2 bg-warm-white border-b border-pale-stone">
      {TABS.map(t => {
        const active = t.href === '/m/inventory'
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
