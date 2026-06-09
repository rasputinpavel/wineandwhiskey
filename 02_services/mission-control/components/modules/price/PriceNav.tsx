'use client'

import { usePathname } from 'next/navigation'
import { NavTabs, type NavTab } from '@/components/shell/NavTabs'

const TABS: NavTab[] = [
  { href: '/m/price',              label: 'Каталог' },
  { href: '/m/price/upload',       label: 'Загрузить' },
  { href: '/m/price/price-lists',  label: 'Прайс-листы' },
]

export function PriceNav() {
  const pathname = usePathname() || ''
  const isActive = (href: string) =>
    href === '/m/price'
      ? pathname === href
      : pathname === href || pathname.startsWith(href + '/')
  return <NavTabs tabs={TABS} isActive={isActive} />
}
