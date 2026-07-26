'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sidebar } from './Sidebar'

type Props = {
  allowedSlugs: string[]
  userLogin: string
  children: React.ReactNode
}

const COLLAPSE_KEY = 'ww.sidebar.collapsed'

export function AppShell({ allowedSlugs, userLogin, children }: Props) {
  const [open, setOpen] = useState(false)
  // Desktop-only: collapse the docked sidebar to a narrow icon rail.
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  // Auto-close the mobile drawer whenever the route changes (tapping a link).
  useEffect(() => { setOpen(false) }, [pathname])

  // Restore the persisted collapse preference after mount (avoids hydration mismatch).
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1')
    } catch { /* localStorage unavailable — keep default */ }
  }, [])

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  return (
    <div className="flex min-h-screen bg-warm-white">
      <Sidebar
        allowedSlugs={allowedSlugs}
        userLogin={userLogin}
        open={open}
        onClose={() => setOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />
      {/* min-w-0 lets wide tables scroll inside this column instead of stretching it */}
      <div className="flex flex-col flex-1 min-w-0 h-screen overflow-hidden">
        {/* Mobile-only top bar with the menu trigger. Hidden from md up. */}
        <div className="md:hidden flex items-center gap-3 px-4 h-12 shrink-0 border-b border-pale-stone bg-warm-white">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="-ml-1.5 p-1.5 text-deep-black hover:text-wine-red transition-colors"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <Link href="/" className="flex items-baseline gap-1">
            <span className="font-display text-base tracking-display text-wine-red leading-none">WINE</span>
            <span className="font-display text-base tracking-display text-deep-black leading-none ml-1">&amp; WHISKEY</span>
          </Link>
        </div>
        {children}
      </div>
    </div>
  )
}
