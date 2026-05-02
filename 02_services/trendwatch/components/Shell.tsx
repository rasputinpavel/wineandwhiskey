'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/',                  label: 'Dashboard',   icon: '◉' },
  { href: '/sync',              label: 'Sync',        icon: '⟳' },
  { href: '/discover',          label: 'Discover',    icon: '⟡' },
  { href: '/track',             label: 'Track',       icon: '↗' },
  { href: '/accounts',          label: 'Accounts',    icon: '⊕' },
]

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname()

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 bg-gray-950 border-r border-gray-800 flex flex-col">
        <div className="px-5 py-6 border-b border-gray-800">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest">W&W</div>
          <div className="font-heading text-white font-bold mt-0.5 tracking-tight">Trendwatch</div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(item => {
            const active = item.href === '/'
              ? path === '/'
              : path.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  active
                    ? 'bg-wine-700 text-white font-medium'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="px-3 py-4 border-t border-gray-800">
          <button
            onClick={logout}
            className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:text-gray-300 rounded-md hover:bg-gray-800 transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-gray-950">
        {children}
      </main>
    </div>
  )
}
