'use client'

import { usePathname } from 'next/navigation'
import { NavTabs, type NavTab } from '@/components/shell/NavTabs'

const TABS: NavTab[] = [
  { href: '/m/wine-matrix/white',     label: 'White (by grape)' },
  { href: '/m/wine-matrix/red',       label: 'Red (by country)' },
  { href: '/m/wine-matrix/sparkling', label: 'Sparkling' },
]

export function WineMatrixNav() {
  const pathname = usePathname() || ''
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')
  return <NavTabs tabs={TABS} isActive={isActive} />
}
