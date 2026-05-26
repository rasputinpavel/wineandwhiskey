'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Sub-nav for the Finance Pulse module. Two tabs, picked by URL match.
//   /m/pulse           → Dashboard (owner P&L)
//   /m/pulse/settings  → Settings (fixed costs CRUD)

const TABS = [
  { href: '/m/pulse',          label: 'Dashboard' },
  { href: '/m/pulse/settings', label: 'Settings'  },
] as const

export function PulseTabs() {
  const pathname = usePathname()
  return (
    <div className="flex gap-1 text-xs mb-4">
      {TABS.map(t => {
        const active = pathname === t.href
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-1.5 rounded-sm border transition-colors ${
              active
                ? 'bg-wine-red text-warm-white border-wine-red'
                : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
