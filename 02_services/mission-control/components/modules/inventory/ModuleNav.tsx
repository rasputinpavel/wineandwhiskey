'use client'

import { usePathname } from 'next/navigation'
import { NavTabs, type NavTab } from '@/components/shell/NavTabs'

const TABS: NavTab[] = [
  { href: '/m/inventory',                label: 'Breakdown' },
  { href: '/m/inventory/admin/unmapped', label: 'Unmapped lines' },
]

export function InventoryNav() {
  const pathname = usePathname() || ''
  const isActive = (href: string) =>
    href === '/m/inventory'
      ? pathname === href
      : pathname === href || pathname.startsWith(href + '/')
  return <NavTabs tabs={TABS} isActive={isActive} />
}
