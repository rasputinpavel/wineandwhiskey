'use client'

import { usePathname } from 'next/navigation'
import { NavTabs, type NavTab } from '@/components/shell/NavTabs'

const TABS: NavTab[] = [
  { href: '/m/customers',              label: 'List' },
  { href: '/m/customers/outstanding',  label: 'Outstanding Invoices' },
  { href: '/m/customers/tax-invoices', label: 'Tax Invoices' },
]

// Подмаршруты, которые не должны активировать таб «List» (drill-down [id] —
// должен; названные секции — нет).
const SUB_ROUTES = new Set(['outstanding', 'tax-invoices'])

export function CustomersNav() {
  const pathname = usePathname() || ''
  const isActive = (href: string) => {
    const detailMatch = pathname.match(/^\/m\/customers\/([^/]+)$/)
    const isDetail = !!detailMatch && !SUB_ROUTES.has(detailMatch[1])
    return href === '/m/customers'
      ? pathname === href || isDetail
      : pathname === href || pathname.startsWith(href + '/')
  }
  return <NavTabs tabs={TABS} isActive={isActive} />
}
