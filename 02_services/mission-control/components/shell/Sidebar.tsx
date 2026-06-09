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
}

export function Sidebar({ allowedSlugs, userLogin, open = false, onClose }: Props) {
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
        className={`w-[260px] shrink-0 bg-warm-white border-r border-pale-stone overflow-y-auto h-screen
          fixed inset-y-0 left-0 z-50 transition-transform duration-200
          md:sticky md:top-0 md:translate-x-0 md:transition-none
          ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
      <div className="px-5 py-5 border-b border-pale-stone">
        <Link href="/" className="flex items-baseline gap-1">
          <span className="font-display text-xl tracking-display text-wine-red leading-none">WINE</span>
          <span className="font-display text-xl tracking-display text-deep-black leading-none ml-1">&amp; WHISKEY</span>
        </Link>
        <div className="overline text-graphite mt-2">Internal Portal</div>
      </div>

      <nav className="py-2">
        {visibleSections.map(section => (
          <SectionBlock key={section.key} section={section} pathname={pathname} />
        ))}
      </nav>

      <div className="px-5 py-4 border-t border-pale-stone mt-2 flex items-center justify-between">
        {userLogin && <span className="text-xs text-graphite">{userLogin}</span>}
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="text-xs text-graphite hover:text-wine-red transition-colors">
            Log out
          </button>
        </form>
      </div>
      </aside>
    </>
  )
}

function SectionBlock({ section, pathname }: { section: Section; pathname: string }) {
  return (
    <div className="px-3 py-2">
      <div className="overline text-graphite px-2 mb-1">{section.label}</div>
      <ul className="space-y-0.5">
        {section.items.map(item => (
          <li key={item.slug}>
            <ItemLink item={item} active={isActive(pathname, item.route)} />
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

function ItemLink({ item, active }: { item: Item; active: boolean }) {
  return (
    <Link
      href={item.route}
      className={`w-full text-left px-2 py-1.5 rounded-sm flex items-center gap-2 transition-colors ${
        active
          ? 'bg-wine-red text-warm-white'
          : 'text-deep-black hover:bg-cream'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
        active ? 'bg-warm-white/70' : statusDotClasses(item.status)
      }`} />
      <span className="text-base leading-none">{item.icon}</span>
      <span className="text-sm flex-1 truncate">{item.name}</span>
    </Link>
  )
}
