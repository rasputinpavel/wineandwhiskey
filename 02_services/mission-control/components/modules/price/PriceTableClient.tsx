'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import PriceTable from './PriceTable'
import type { WineItem } from '@/lib/price/supabase'

type Props = {
  items: WineItem[]
  total: number
  page: number
  limit: number
  sortCol: string
  sortAsc: boolean
}

export default function PriceTableClient({ items, total, page, limit, sortCol, sortAsc }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const navigate = useCallback((updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString())
    Object.entries(updates).forEach(([k, v]) => params.set(k, v))
    router.push(`${pathname}?${params.toString()}`)
  }, [pathname, router, searchParams])

  const handlePageChange = useCallback((newPage: number) => {
    navigate({ page: String(newPage) })
  }, [navigate])

  const handleSort = useCallback((col: string) => {
    const newDir = col === sortCol && sortAsc ? 'desc' : 'asc'
    navigate({ sort: col, dir: newDir, page: '1' })
  }, [navigate, sortCol, sortAsc])

  return (
    <PriceTable
      items={items}
      total={total}
      page={page}
      limit={limit}
      sortCol={sortCol}
      sortAsc={sortAsc}
      onPageChange={handlePageChange}
      onSort={handleSort}
    />
  )
}
