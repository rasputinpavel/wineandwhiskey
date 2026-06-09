'use client'

import { usePathname } from 'next/navigation'
import { NavTabs, type NavTab } from '@/components/shell/NavTabs'

const TABS: NavTab[] = [
  { href: '/m/suppliers',                 label: 'List' },
  { href: '/m/suppliers/purchase-orders', label: 'Purchase Orders' },
]

// Подмаршруты, которые не должны активировать таб «List» (drill-down [id] —
// должен; названные секции — нет).
const SUB_ROUTES = new Set(['purchase-orders'])

export function SuppliersNav() {
  const pathname = usePathname() || ''
  const isActive = (href: string) => {
    const detailMatch = pathname.match(/^\/m\/suppliers\/([^/]+)$/)
    const isDetail = !!detailMatch && !SUB_ROUTES.has(detailMatch[1])
    return href === '/m/suppliers'
      ? pathname === href || isDetail
      : pathname === href || pathname.startsWith(href + '/')
  }
  return <NavTabs tabs={TABS} isActive={isActive} />
}
