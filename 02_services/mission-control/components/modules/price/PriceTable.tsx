'use client'

import { useState } from 'react'
import type { WineItem } from '@/lib/price/supabase'
import Image from 'next/image'
import WineItemPanel from './WineItemPanel'
import { wineTypeLabel, spiritTypeLabel, categoryEmoji } from '@/lib/price/types-display'

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

function CatalogBadge({ status }: { status?: 'current' | 'expired' | null }) {
  if (!status) return null
  return status === 'current'
    ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium whitespace-nowrap">current</span>
    : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 font-medium whitespace-nowrap">expired</span>
}

export default function PriceTable({ items: initialItems, total: initialTotal, page, limit, sortCol, sortAsc, onPageChange, onSort }: Props) {
  const [items, setItems] = useState<WineItem[]>(initialItems)
  const [total, setTotal] = useState(initialTotal)
  const [selected, setSelected] = useState<WineItem | null>(null)
  const [panelMode, setPanelMode] = useState<'view' | 'edit' | 'create'>('view')

  // Sync with server-rendered props on navigation
  if (initialItems !== items && !selected) {
    setItems(initialItems)
    setTotal(initialTotal)
  }

  function openItem(item: WineItem) {
    setSelected(item)
    setPanelMode('view')
  }

  function openCreate() {
    setSelected(null)
    setPanelMode('create')
  }

  function handleSaved(saved: WineItem) {
    if (panelMode === 'create') {
      setItems(prev => [saved, ...prev])
      setTotal(prev => prev + 1)
    } else {
      setItems(prev => prev.map(i => i.id === saved.id ? saved : i))
    }
    setSelected(saved)
    setPanelMode('view')
  }

  function handleDeleted(id: string) {
    setItems(prev => prev.filter(i => i.id !== id))
    setTotal(prev => prev - 1)
    setSelected(null)
  }

  const totalPages = Math.ceil(total / limit)
  const showPanel = selected !== null || panelMode === 'create'

  return (
    <div>
      {/* Add button */}
      <div className="flex justify-end mb-3">
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-wine-600 hover:bg-wine-700 rounded-xl transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Добавить позицию
        </button>
      </div>

      {items.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
          </svg>
          <p className="text-sm">Ничего не найдено</p>
        </div>
      )}

      {items.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-stone bg-white">
            <table className="min-w-[1080px] w-full text-sm">
              <thead className="bg-white border-b border-stone">
                <tr>
                  <th className="pl-3 pr-2 py-3 w-8"></th>
                  {([
                    { col: 'name', label: 'Название', align: 'left' },
                    { col: 'supplier_name', label: 'Поставщик', align: 'left' },
                    { col: 'country', label: 'Страна', align: 'left' },
                    { col: 'winery', label: 'Производитель', align: 'left' },
                    { col: null, label: 'Сорт', align: 'left' },
                    { col: null, label: 'Тип', align: 'left' },
                    { col: 'vivino_rating', label: 'Vivino', align: 'left' },
                    { col: 'year', label: 'Год', align: 'left' },
                    { col: 'vivino_alcohol', label: 'ABV', align: 'left' },
                    { col: null, label: 'Объём', align: 'left' },
                    { col: 'price', label: 'Цена', align: 'right' },
                  ] as const).map(({ col, label, align }, i, arr) => (
                    <th
                      key={label}
                      className={`py-3 ${i === arr.length - 1 ? 'pl-3 pr-4' : 'px-2.5'} text-${align} font-heading font-semibold text-graphite text-[11px] uppercase tracking-wider whitespace-nowrap ${col ? 'cursor-pointer hover:text-deep-black select-none' : ''}`}
                      onClick={col ? () => onSort(col) : undefined}
                    >
                      {label}
                      {col && <SortIcon col={col} sortCol={sortCol} sortAsc={sortAsc} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone/60 bg-white">
                {items.map(item => (
                  <TableRow key={item.id} item={item} onClick={() => openItem(item)} selected={selected?.id === item.id} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {items.map(item => (
              <MobileCard key={item.id} item={item} onClick={() => openItem(item)} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm">
              <p className="text-gray-500">
                {(page - 1) * limit + 1}–{Math.min(page * limit, total)} из {total}
              </p>
              <div className="flex gap-1">
                <button onClick={() => onPageChange(page - 1)} disabled={page === 1} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">←</button>
                <button onClick={() => onPageChange(page + 1)} disabled={page === totalPages} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">→</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Panel */}
      {showPanel && (
        <WineItemPanel
          item={selected}
          mode={panelMode}
          onClose={() => { setSelected(null); setPanelMode('view') }}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}

function hasTextSelection() {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null
  return !!sel && sel.toString().trim().length > 0
}

function TableRow({ item, onClick, selected }: { item: WineItem; onClick: () => void; selected: boolean }) {
  return (
    <tr
      onClick={() => { if (!hasTextSelection()) onClick() }}
      className={`cursor-pointer transition-colors ${selected ? 'bg-wine-50' : 'hover:bg-gray-50'}`}
    >
      <td className="pl-3 pr-2 py-3">
        {(item.image_url || item.vivino_image_url) ? (
          <div className="w-8 h-10 relative rounded overflow-hidden">
            <Image src={item.image_url ?? item.vivino_image_url!} alt={item.name} fill className="object-cover" />
          </div>
        ) : (
          <div className="w-8 h-10 rounded bg-gray-100 flex items-center justify-center">
            <span className="text-gray-300 text-xs">{categoryEmoji(item.category)}</span>
          </div>
        )}
      </td>
      <td className="px-2.5 py-3">
        <div className="font-medium text-gray-900 flex items-center gap-1.5">
          {item.category && item.category !== 'wine' && (
            <span className="text-sm" title={item.category}>{categoryEmoji(item.category)}</span>
          )}
          <span>{item.name}</span>
          <CatalogBadge status={item.catalog_status} />
        </div>
        {item.description && (
          <div className="text-xs text-gray-400 mt-0.5 line-clamp-1">{item.description}</div>
        )}
      </td>
      <td className="px-2.5 py-3 max-w-[140px]">
        <span
          className="inline-flex items-center max-w-full px-2 py-0.5 rounded-full text-xs bg-wine-50 text-wine-600 font-medium whitespace-nowrap truncate"
          title={(item.supplier_name && item.supplier_name !== 'null') ? item.supplier_name : undefined}
        >
          {(item.supplier_name && item.supplier_name !== 'null') ? item.supplier_name : '—'}
        </span>
      </td>
      <td className="px-2.5 py-3 text-gray-600 whitespace-nowrap">{item.country ?? '—'}</td>
      <td className="px-2.5 py-3 text-gray-600 text-xs max-w-[140px] truncate">{item.winery ?? '—'}</td>
      <td className="px-2.5 py-3 text-gray-500 text-xs max-w-[140px] truncate">{item.grape_variety ?? '—'}</td>
      <td className="px-2.5 py-3 text-gray-600 text-xs whitespace-nowrap">
        {item.wine_type
          ? wineTypeLabel(item.wine_type)
          : item.spirit_type
          ? spiritTypeLabel(item.spirit_type)
          : '—'}
      </td>
      <td className="px-2.5 py-3 whitespace-nowrap">
        {item.vivino_rating ? (
          <span className="text-xs font-medium text-purple-700">★ {item.vivino_rating}</span>
        ) : '—'}
      </td>
      <td className="px-2.5 py-3 text-gray-600 whitespace-nowrap">{item.year ?? item.vivino_year ?? '—'}</td>
      <td className="px-2.5 py-3 text-gray-600 text-xs whitespace-nowrap">
        {item.vivino_alcohol != null ? `${item.vivino_alcohol}%` : '—'}
      </td>
      <td className="px-2.5 py-3 text-gray-500 whitespace-nowrap">{item.volume ?? '—'}</td>
      <td className="pl-3 pr-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
        {item.price != null ? `฿${item.price.toLocaleString('ru-RU')}` : '—'}
      </td>
    </tr>
  )
}

function MobileCard({ item, onClick }: { item: WineItem; onClick: () => void }) {
  return (
    <div onClick={() => { if (!hasTextSelection()) onClick() }} className="bg-white rounded-xl border border-gray-100 p-4 cursor-pointer hover:border-wine-200 transition-colors">
      <div className="flex gap-3">
        {(item.image_url || item.vivino_image_url) ? (
          <div className="w-10 h-14 relative rounded-lg overflow-hidden flex-shrink-0">
            <Image src={item.image_url ?? item.vivino_image_url!} alt={item.name} fill className="object-cover" />
          </div>
        ) : (
          <div className="w-10 h-14 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 text-lg">{categoryEmoji(item.category)}</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 text-sm leading-tight flex items-center gap-1">
            {item.category && item.category !== 'wine' && <span>{categoryEmoji(item.category)}</span>}
            <span>{item.name}</span>
            <CatalogBadge status={item.catalog_status} />
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {item.supplier_name && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-wine-50 text-wine-600 font-medium">
                {item.supplier_name}
              </span>
            )}
            {item.country && <span className="text-xs text-gray-500">{item.country}</span>}
            {item.year && <span className="text-xs text-gray-500">{item.year}</span>}
            {item.wine_type && <span className="text-xs text-gray-500">{wineTypeLabel(item.wine_type)}</span>}
            {!item.wine_type && item.spirit_type && <span className="text-xs text-gray-500">{spiritTypeLabel(item.spirit_type)}</span>}
          </div>
          {item.winery && <div className="text-xs text-gray-500 mt-1 truncate">{item.winery}</div>}
          {item.grape_variety && <div className="text-xs text-gray-400 mt-0.5 truncate">{item.grape_variety}</div>}
        </div>
        <div className="text-right flex-shrink-0">
          {item.price != null && <div className="font-semibold text-gray-900 text-sm">฿{item.price.toLocaleString('ru-RU')}</div>}
          {item.volume && <div className="text-xs text-gray-400 mt-0.5">{item.volume}</div>}
        </div>
      </div>
    </div>
  )
}
