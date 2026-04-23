'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import PriceTable from './PriceTable'
import type { WineItem } from '@/lib/supabase'

type Props = {
  items: WineItem[]
  total: number
  page: number
  limit: number
}

export default function PriceTableClient({ items, total, page, limit }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handlePageChange = useCallback((newPage: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(newPage))
    router.push(`${pathname}?${params.toString()}`)
  }, [pathname, router, searchParams])

  return (
    <PriceTable
      items={items}
      total={total}
      page={page}
      limit={limit}
      onPageChange={handlePageChange}
    />
  )
}
