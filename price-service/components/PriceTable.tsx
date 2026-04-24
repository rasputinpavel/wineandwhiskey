'use client'

import type { WineItem } from '@/lib/supabase'
import Image from 'next/image'

type Props = {
  items: WineItem[]
  total: number
  page: number
  limit: number
  sortCol: string
  sortAsc: boolean
  onPageChange: (page: number) => void
  onSort: (col: string) => void
}

function SortIcon({ col, sortCol, sortAsc }: { col: string; sortCol: string; sortAsc: boolean }) {
  if (col !== sortCol) return <span className="ml-1 text-gray-300">↕</span>
  return <span className="ml-1 text-wine-600">{sortAsc ? '↑' : '↓'}</span>
}

export default function PriceTable({ items, total, page, limit, sortCol, sortAsc, onPageChange, onSort }: Props) {
  const totalPages = Math.ceil(total / limit)

  if (items.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
        </svg>
        <p className="text-sm">Ничего не найдено</p>
      </div>
    )
  }

  return (
    <div>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-4 py-3 w-8"></th>
              {([
                { col: 'name', label: 'Название', align: 'left' },
                { col: 'supplier_name', label: 'Поставщик', align: 'left' },
                { col: 'country', label: 'Страна', align: 'left' },
                { col: 'winery', label: 'Производитель', align: 'left' },
                { col: null, label: 'Сорт', align: 'left' },
                { col: 'vivino_rating', label: 'Vivino', align: 'left' },
                { col: 'year', label: 'Год', align: 'left' },
                { col: null, label: 'Объём', align: 'left' },
                { col: 'price', label: 'Цена', align: 'right' },
              ] as const).map(({ col, label, align }) => (
                <th
                  key={label}
                  className={`px-4 py-3 text-${align} font-medium text-gray-500 ${col ? 'cursor-pointer hover:text-gray-800 select-none' : ''}`}
                  onClick={col ? () => onSort(col) : undefined}
                >
                  {label}
                  {col && <SortIcon col={col} sortCol={sortCol} sortAsc={sortAsc} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 bg-white">
            {items.map(item => (
              <TableRow key={item.id} item={item} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {items.map(item => (
          <MobileCard key={item.id} item={item} />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <p className="text-gray-500">
            {(page - 1) * limit + 1}–{Math.min(page * limit, total)} из {total}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >←</button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >→</button>
          </div>
        </div>
      )}
    </div>
  )
}

function TableRow({ item }: { item: WineItem }) {
  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3">
        {(item.image_url || item.vivino_image_url) ? (
          <div className="w-8 h-10 relative rounded overflow-hidden">
            <Image src={item.image_url ?? item.vivino_image_url!} alt={item.name} fill className="object-cover" />
          </div>
        ) : (
          <div className="w-8 h-10 rounded bg-gray-100 flex items-center justify-center">
            <span className="text-gray-300 text-xs">🍷</span>
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900">{item.name}</div>
        {item.description && (
          <div className="text-xs text-gray-400 mt-0.5 line-clamp-1">{item.description}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-wine-50 text-wine-600 font-medium">
          {(item.supplier_name && item.supplier_name !== 'null') ? item.supplier_name : '—'}
        </span>
      </td>
      <td className="px-4 py-3 text-gray-600">{item.country ?? '—'}</td>
      <td className="px-4 py-3 text-gray-600 text-xs max-w-[140px] truncate">{item.winery ?? '—'}</td>
      <td className="px-4 py-3 text-gray-500 text-xs max-w-[140px] truncate">{item.grape_variety ?? '—'}</td>
      <td className="px-4 py-3">
        {item.vivino_rating ? (
          <span className="text-xs font-medium text-purple-700">★ {item.vivino_rating}</span>
        ) : '—'}
      </td>
      <td className="px-4 py-3 text-gray-600">{item.year ?? '—'}</td>
      <td className="px-4 py-3 text-gray-500">{item.volume ?? '—'}</td>
      <td className="px-4 py-3 text-right font-semibold text-gray-900">
        {item.price != null ? `฿${item.price.toLocaleString('ru-RU')}` : '—'}
      </td>
    </tr>
  )
}

function MobileCard({ item }: { item: WineItem }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex gap-3">
        {(item.image_url || item.vivino_image_url) ? (
          <div className="w-10 h-14 relative rounded-lg overflow-hidden flex-shrink-0">
            <Image src={item.image_url ?? item.vivino_image_url!} alt={item.name} fill className="object-cover" />
          </div>
        ) : (
          <div className="w-10 h-14 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 text-lg">🍷</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 text-sm leading-tight">{item.name}</div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {item.supplier_name && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-wine-50 text-wine-600 font-medium">
                {item.supplier_name}
              </span>
            )}
            {item.country && (
              <span className="text-xs text-gray-500">{item.country}</span>
            )}
            {item.year && (
              <span className="text-xs text-gray-500">{item.year}</span>
            )}
          </div>
          {item.winery && (
            <div className="text-xs text-gray-500 mt-1 truncate">{item.winery}</div>
          )}
          {item.grape_variety && (
            <div className="text-xs text-gray-400 mt-0.5 truncate">{item.grape_variety}</div>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          {item.price != null && (
            <div className="font-semibold text-gray-900 text-sm">฿{item.price.toLocaleString('ru-RU')}</div>
          )}
          {item.volume && (
            <div className="text-xs text-gray-400 mt-0.5">{item.volume}</div>
          )}
        </div>
      </div>
    </div>
  )
}
