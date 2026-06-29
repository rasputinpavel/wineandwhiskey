'use client'

import { usePathname } from 'next/navigation'
import { NavTabs, type NavTab } from '@/components/shell/NavTabs'

const TABS: NavTab[] = [
  { href: '/m/suppliers', label: 'List' },
]

export function SuppliersNav() {
  const pathname = usePathname() || ''
  // "List" stays active on the index and on any supplier drill-down (/m/suppliers/<id>...).
  const isActive = () => pathname === '/m/suppliers' || pathname.startsWith('/m/suppliers/')
  return <NavTabs tabs={TABS} isActive={isActive} />
}
