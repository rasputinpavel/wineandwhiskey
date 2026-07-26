'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Item, Section, SECTIONS, statusDotClasses } from '@/lib/registry'

type Props = {
  allowedSlugs: string[]
  userLogin: string
  /** Mobile drawer state — ignored on md+ where the sidebar is always docked. */
  open?: boolean
  onClose?: () => void
  /** Desktop-only: collapse the docked sidebar to a narrow icon rail. */
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export function Sidebar({ allowedSlugs, userLogin, open = false, onClose, collapsed = false, onToggleCollapse }: Props) {
  const pathname = usePathname() || ''
  const allowed = new Set(allowedSlugs)

  const visibleSections = SECTIONS
    .map(s => ({ ...s, items: s.items.filter(i => allowed.has(i.slug)) }))
    .filter(s => s.items.length > 0)

  return (
    <>
      {/* Backdrop — mobile only, dismisses the drawer on tap */}
      {open && (
        <div
          onClick={onClose}
          aria-hidden
          className="md:hidden fixed inset-0 z-40 bg-deep-black/40"
        />
      )}
      <aside
        className={`w-[260px] shrink-0 bg-warm-white border-r border-pale-stone overflow-y-auto overflow-x-hidden h-screen
          fixed inset-y-0 left-0 z-50 transition-transform duration-200
          md:sticky md:top-0 md:translate-x-0 md:transition-[width,transform] md:duration-200
          ${collapsed ? 'md:w-[60px]' : 'md:w-[260px]'}
          ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
      <div className={`py-5 border-b border-pale-stone ${collapsed ? 'md:px-0 px-5' : 'px-5'}`}>
        <div className={`flex items-start justify-between gap-2 ${collapsed ? 'md:justify-center' : ''}`}>
          <Link href="/" className="flex items-baseline gap-1 min-w-0">
            <span className="font-display text-xl tracking-display text-wine-red leading-none">WINE</span>
            <span className={`font-display text-xl tracking-display text-deep-black leading-none ml-1 ${collapsed ? 'md:hidden' : ''}`}>&amp; WHISKEY</span>
          </Link>
          {/* Desktop-only collapse toggle (hidden when collapsed — expand lives below) */}
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Collapse menu"
              title="Collapse menu"
              className={`hidden md:flex shrink-0 p-1 -mr-1 text-graphite hover:text-wine-red transition-colors ${collapsed ? 'md:hidden' : ''}`}
            >
              <ChevronsLeft />
            </button>
          )}
        </div>
        <div className={`overline text-graphite mt-2 ${collapsed ? 'md:hidden' : ''}`}>Internal Portal</div>
      </div>

      {/* Collapsed: a lone expand button under the logo */}
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Expand menu"
          title="Expand menu"
          className={`md:flex w-full justify-center py-2 text-graphite hover:text-wine-red transition-colors hidden ${collapsed ? 'md:flex' : 'md:hidden'}`}
        >
          <ChevronsRight />
        </button>
      )}

      <nav className="py-2">
        {visibleSections.map(section => (
          <SectionBlock key={section.key} section={section} pathname={pathname} collapsed={collapsed} />
        ))}
      </nav>

      <div className={`py-4 border-t border-pale-stone mt-2 flex items-center justify-between ${collapsed ? 'md:px-0 md:justify-center px-5' : 'px-5'}`}>
        {userLogin && <span className={`text-xs text-graphite truncate ${collapsed ? 'md:hidden' : ''}`}>{userLogin}</span>}
        <form action="/api/auth/logout" method="post">
          <button type="submit" title="Log out" className="text-xs text-graphite hover:text-wine-red transition-colors">
            <span className={collapsed ? 'md:hidden' : ''}>Log out</span>
            <span className={`hidden ${collapsed ? 'md:inline' : ''}`} aria-hidden>⏻</span>
          </button>
        </form>
      </div>
      </aside>
    </>
  )
}

function SectionBlock({ section, pathname, collapsed }: { section: Section; pathname: string; collapsed: boolean }) {
  return (
    <div className={collapsed ? 'md:px-2 px-3 py-2' : 'px-3 py-2'}>
      <div className={`overline text-graphite px-2 mb-1 ${collapsed ? 'md:hidden' : ''}`}>{section.label}</div>
      <ul className="space-y-0.5">
        {section.items.map(item => (
          <li key={item.slug}>
            <ItemLink item={item} active={isActive(pathname, item.route)} collapsed={collapsed} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function isActive(pathname: string, route: string) {
  if (pathname === route) return true
  // Native modules have nested routes (/m/inventory/b2b etc.) — keep parent
  // highlighted while user is anywhere within the module.
  return pathname.startsWith(route + '/')
}

function ItemLink({ item, active, collapsed }: { item: Item; active: boolean; collapsed: boolean }) {
  return (
    <Link
      href={item.route}
      title={collapsed ? item.name : undefined}
      className={`w-full text-left px-2 py-1.5 rounded-sm flex items-center gap-2 transition-colors ${
        collapsed ? 'md:justify-center md:px-0' : ''
      } ${
        active
          ? 'bg-wine-red text-warm-white'
          : 'text-deep-black hover:bg-cream'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${collapsed ? 'md:hidden' : ''} ${
        active ? 'bg-warm-white/70' : statusDotClasses(item.status)
      }`} />
      <span className="text-base leading-none">{item.icon}</span>
      <span className={`text-sm flex-1 truncate ${collapsed ? 'md:hidden' : ''}`}>{item.name}</span>
    </Link>
  )
}

function ChevronsLeft() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="11 17 6 12 11 7" />
      <polyline points="18 17 13 12 18 7" />
    </svg>
  )
}

function ChevronsRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 17 18 12 13 7" />
      <polyline points="6 17 11 12 6 7" />
    </svg>
  )
}
