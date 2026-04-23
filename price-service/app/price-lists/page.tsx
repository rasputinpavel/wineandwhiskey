'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type PriceList = {
  id: string
  supplier_name: string | null
  date: string | null
  status: string
  item_count: number
  uploaded_at: string
  error_message: string | null
}

export default function PriceListsPage() {
  const [lists, setLists] = useState<PriceList[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/price-lists')
    if (res.ok) setLists(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Удалить прайс «${name}»? Все позиции будут удалены.`)) return
    setDeleting(id)
    await fetch(`/api/price-lists/${id}`, { method: 'DELETE' })
    setLists(prev => prev.filter(l => l.id !== id))
    setDeleting(null)
  }

  return (
    <div className="min-h-screen bg-[#f8f7f5]">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-2">
          <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <span className="text-wine-600 font-bold text-lg tracking-tight">Загруженные прайсы</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-2">
        {loading && (
          <div className="text-center py-12 text-gray-400 text-sm">Загрузка...</div>
        )}
        {!loading && lists.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">Нет загруженных прайсов</div>
        )}
        {lists.map(pl => {
          const name = (pl.supplier_name && pl.supplier_name !== 'null') ? pl.supplier_name : 'Без поставщика'
          const date = pl.date ? new Date(pl.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : null
          const uploadedAt = new Date(pl.uploaded_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

          return (
            <div key={pl.id} className="bg-white rounded-2xl border border-gray-100 px-5 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 truncate">{name}</span>
                  {pl.status === 'processing' && (
                    <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full animate-pulse">Обработка</span>
                  )}
                  {pl.status === 'error' && (
                    <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full" title={pl.error_message ?? ''}>Ошибка</span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-0.5 flex gap-2">
                  {date && <span>{date}</span>}
                  {date && <span>·</span>}
                  <span>{pl.item_count} позиций</span>
                  <span>·</span>
                  <span>загружен {uploadedAt}</span>
                </div>
              </div>

              <button
                onClick={() => handleDelete(pl.id, name)}
                disabled={deleting === pl.id}
                className="flex-shrink-0 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-40"
                title="Удалить прайс"
              >
                {deleting === pl.id ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
              </button>
            </div>
          )
        })}
      </main>
    </div>
  )
}
