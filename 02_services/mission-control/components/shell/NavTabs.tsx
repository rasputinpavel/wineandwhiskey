'use client'

import Link from 'next/link'

export type NavTab = { href: string; label: string }

/**
 * Shared module tab bar. Owns the visual shell + mobile behaviour
 * (horizontal scroll with hidden scrollbar on <md). Each module passes its
 * own `isActive` so domain-specific drill-down logic stays where it belongs.
 */
export function NavTabs({
  tabs,
  isActive,
}: {
  tabs: NavTab[]
  isActive: (href: string) => boolean
}) {
  return (
    <nav className="flex gap-1 px-4 md:px-6 py-2 overflow-x-auto whitespace-nowrap no-scrollbar bg-warm-white border-b border-pale-stone">
      {tabs.map(t => {
        const active = isActive(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`shrink-0 px-3 py-1.5 text-xs rounded-sm transition-colors ${
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
