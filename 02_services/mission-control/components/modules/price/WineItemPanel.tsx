'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import type { WineItem } from '@/lib/price/supabase'

type Mode = 'view' | 'edit' | 'create'

type FormData = {
  name: string
  winery: string
  country: string
  region: string
  grape_variety: string
  year: string
  volume: string
  price: string
  category: string
  wine_type: string
  description: string
  supplier_name: string
}

const EMPTY_FORM: FormData = {
  name: '', winery: '', country: '', region: '', grape_variety: '',
  year: '', volume: '', price: '', category: '', wine_type: '',
  description: '', supplier_name: '',
}

function itemToForm(item: WineItem): FormData {
  return {
    name: item.name ?? '',
    winery: item.winery ?? '',
    country: item.country ?? '',
    region: item.region ?? '',
    grape_variety: item.grape_variety ?? '',
    year: item.year != null ? String(item.year) : '',
    volume: item.volume ?? '',
    price: item.price != null ? String(item.price) : '',
    category: item.category ?? '',
    wine_type: item.wine_type ?? '',
    description: item.description ?? '',
    supplier_name: item.supplier_name ?? '',
  }
}

type Props = {
  item: WineItem | null
  mode: Mode
  onClose: () => void
  onSaved: (item: WineItem) => void
  onDeleted: (id: string) => void
}

export default function WineItemPanel({ item, mode: initialMode, onClose, onSaved, onDeleted }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [form, setForm] = useState<FormData>(item ? itemToForm(item) : EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMode(initialMode)
    setForm(item ? itemToForm(item) : EMPTY_FORM)
    setError(null)
  }, [item, initialMode])

  function set(key: keyof FormData, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Название обязательно'); return }
    setSaving(true); setError(null)
    try {
      const body = {
        name: form.name.trim(),
        winery: form.winery || null,
        country: form.country || null,
        region: form.region || null,
        grape_variety: form.grape_variety || null,
        year: form.year ? parseInt(form.year) : null,
        volume: form.volume || null,
        price: form.price ? parseFloat(form.price) : null,
        category: form.category || null,
        wine_type: form.wine_type || null,
        description: form.description || null,
        supplier_name: form.supplier_name || null,
      }
      let res: Response
      if (mode === 'create') {
        res = await fetch('/api/m/price/wine-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      } else {
        res = await fetch(`/api/m/price/wine-items/${item!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      }
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Ошибка'); }
      onSaved(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Удалить «${item?.name}»?`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/m/price/wine-items/${item!.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Ошибка удаления')
      onDeleted(item!.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
      setDeleting(false)
    }
  }

  const isEditing = mode === 'edit' || mode === 'create'
  // Build a unique image gallery: local image_url first, then all Vivino images.
  const galleryImages = (() => {
    const out: string[] = []
    if (item?.image_url) out.push(item.image_url)
    if (item?.vivino_images?.length) {
      for (const u of item.vivino_images) if (!out.includes(u)) out.push(u)
    } else if (item?.vivino_image_url && !out.includes(item.vivino_image_url)) {
      out.push(item.vivino_image_url)
    }
    return out
  })()
  const img = galleryImages[0] ?? null
  const regionPath = item?.vivino_region_hierarchy
    ? [
        item.vivino_region_hierarchy.country,
        item.vivino_region_hierarchy.region,
        item.vivino_region_hierarchy.subregion,
        item.vivino_region_hierarchy.appellation,
      ].filter(Boolean).join(' › ')
    : null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-white z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <span className="font-semibold text-gray-900">
            {mode === 'create' ? 'Новая позиция' : mode === 'edit' ? 'Редактирование' : 'Позиция'}
          </span>
          <div className="flex items-center gap-2">
            {mode === 'view' && item && (
              <>
                <button onClick={() => setMode('edit')} className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                  Изменить
                </button>
                <button onClick={handleDelete} disabled={deleting} className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50">
                  {deleting ? '...' : 'Удалить'}
                </button>
              </>
            )}
            {isEditing && (
              <>
                <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-xs font-medium text-white bg-wine-600 hover:bg-wine-700 rounded-lg transition-colors disabled:opacity-50">
                  {saving ? 'Сохраняем...' : 'Сохранить'}
                </button>
                {mode === 'edit' && (
                  <button onClick={() => { setMode('view'); setForm(itemToForm(item!)); setError(null) }} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                    Отмена
                  </button>
                )}
              </>
            )}
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}

          {/* Image + Vivino (view mode) */}
          {mode === 'view' && img && (
            <div className="flex gap-4 items-start">
              <div className="relative w-16 h-24 rounded-xl overflow-hidden flex-shrink-0 bg-gray-50">
                <Image src={img} alt={item?.name ?? ''} fill className="object-contain" />
              </div>
              <div className="space-y-1">
                {item?.vivino_rating && (
                  <div className="text-purple-700 font-semibold text-lg">★ {item.vivino_rating}</div>
                )}
                {item?.vivino_reviews_count && (
                  <div className="text-xs text-gray-400">{item.vivino_reviews_count.toLocaleString('ru-RU')} отзывов</div>
                )}
                {item?.vivino_url && (
                  <a href={item.vivino_url} target="_blank" rel="noreferrer" className="text-xs text-purple-600 hover:underline">
                    Открыть на Vivino →
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Image gallery — extra Vivino images beyond the cover */}
          {mode === 'view' && galleryImages.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {galleryImages.slice(1).map(src => (
                <a key={src} href={src} target="_blank" rel="noreferrer" className="relative w-14 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-gray-50 border border-gray-100 hover:border-purple-300 transition-colors">
                  <Image src={src} alt="" fill className="object-contain" />
                </a>
              ))}
            </div>
          )}

          {/* Vivino enrichment block */}
          {mode === 'view' && item && (item.vivino_alcohol != null || item.vivino_body || item.vivino_year || item.vivino_style || regionPath || item.vivino_flavors?.length || item.vivino_food_pairings?.length) && (
            <div className="space-y-3 pb-1 border-b border-gray-100">
              {(item.vivino_alcohol != null || item.vivino_body || item.vivino_year) && (
                <div className="flex flex-wrap gap-2">
                  {item.vivino_year && (
                    <Pill label="Винтаж" value={String(item.vivino_year)} />
                  )}
                  {item.vivino_alcohol != null && (
                    <Pill label="ABV" value={`${item.vivino_alcohol}%`} />
                  )}
                  {item.vivino_body && (
                    <Pill label="Body" value={ruBody(item.vivino_body)} />
                  )}
                </div>
              )}
              {item.vivino_style && (
                <div className="text-xs">
                  <span className="text-gray-400 uppercase tracking-wide font-medium">Стиль</span>
                  <span className="ml-2 text-gray-700">{item.vivino_style}</span>
                </div>
              )}
              {regionPath && (
                <div className="text-xs">
                  <span className="text-gray-400 uppercase tracking-wide font-medium">Регион</span>
                  <span className="ml-2 text-gray-700">{regionPath}</span>
                </div>
              )}
              {item.vivino_flavors && item.vivino_flavors.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Вкусовой профиль</div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.vivino_flavors.map(f => (
                      <span key={f} className="px-2 py-0.5 text-xs rounded-full bg-purple-50 text-purple-700">{f}</span>
                    ))}
                  </div>
                </div>
              )}
              {item.vivino_food_pairings && item.vivino_food_pairings.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">К столу</div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.vivino_food_pairings.map(f => (
                      <span key={f} className="px-2 py-0.5 text-xs rounded-full bg-amber-50 text-amber-700">{f}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fields */}
          <div className="space-y-3">
            <Field label="Название *" editing={isEditing} value={isEditing ? form.name : item?.name ?? '—'}
              input={<input className={INPUT} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Название вина" />}
            />
            <Field label="Производитель" editing={isEditing} value={isEditing ? form.winery : (item?.winery ?? '—')}
              input={<input className={INPUT} value={form.winery} onChange={e => set('winery', e.target.value)} placeholder="Winery" />}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Страна" editing={isEditing} value={isEditing ? form.country : (item?.country ?? '—')}
                input={<input className={INPUT} value={form.country} onChange={e => set('country', e.target.value)} placeholder="Франция" />}
              />
              <Field label="Регион" editing={isEditing} value={isEditing ? form.region : (item?.region ?? '—')}
                input={<input className={INPUT} value={form.region} onChange={e => set('region', e.target.value)} placeholder="Бордо" />}
              />
            </div>
            <Field label="Сорт винограда" editing={isEditing} value={isEditing ? form.grape_variety : (item?.grape_variety ?? '—')}
              input={<input className={INPUT} value={form.grape_variety} onChange={e => set('grape_variety', e.target.value)} placeholder="Cabernet Sauvignon" />}
            />
            <div className="grid grid-cols-3 gap-3">
              <Field label="Год" editing={isEditing} value={isEditing ? form.year : (item?.year != null ? String(item.year) : '—')}
                input={<input className={INPUT} type="number" value={form.year} onChange={e => set('year', e.target.value)} placeholder="2020" />}
              />
              <Field label="Объём" editing={isEditing} value={isEditing ? form.volume : (item?.volume ?? '—')}
                input={<input className={INPUT} value={form.volume} onChange={e => set('volume', e.target.value)} placeholder="750ml" />}
              />
              <Field label="Цена (฿)" editing={isEditing} value={isEditing ? form.price : (item?.price != null ? `฿${item.price}` : '—')}
                input={<input className={INPUT} type="number" value={form.price} onChange={e => set('price', e.target.value)} placeholder="0" />}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Категория" editing={isEditing} value={isEditing ? form.category : (item?.category ?? '—')}
                input={
                  <select className={INPUT} value={form.category} onChange={e => set('category', e.target.value)}>
                    <option value="">—</option>
                    <option value="wine">Вино</option>
                    <option value="spirits">Крепкий</option>
                    <option value="beer">Пиво</option>
                    <option value="other">Другое</option>
                  </select>
                }
              />
              <Field label="Тип вина" editing={isEditing} value={isEditing ? form.wine_type : (item?.wine_type ?? '—')}
                input={
                  <select className={INPUT} value={form.wine_type} onChange={e => set('wine_type', e.target.value)}>
                    <option value="">—</option>
                    <option value="red">Красное</option>
                    <option value="white">Белое</option>
                    <option value="rose">Розовое</option>
                    <option value="sparkling">Игристое</option>
                  </select>
                }
              />
            </div>
            <Field label="Поставщик" editing={isEditing} value={isEditing ? form.supplier_name : (item?.supplier_name ?? '—')}
              input={<input className={INPUT} value={form.supplier_name} onChange={e => set('supplier_name', e.target.value)} placeholder="Поставщик" />}
            />
            <Field label="Описание" editing={isEditing} value={isEditing ? form.description : (item?.description ?? '—')}
              input={<textarea className={`${INPUT} resize-none`} rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Описание" />}
            />
          </div>
        </div>
      </div>
    </>
  )
}

const INPUT = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent bg-white'

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-100">
      <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">{label}</span>
      <span className="text-xs font-medium text-gray-800">{value}</span>
    </div>
  )
}

function ruBody(body: string): string {
  switch (body.toLowerCase()) {
    case 'light': return 'Лёгкое'
    case 'medium': return 'Среднее'
    case 'full': return 'Плотное'
    default: return body
  }
}

function Field({ label, editing, value, input }: {
  label: string
  editing: boolean
  value: string
  input: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</div>
      {editing ? input : <div className="text-sm text-gray-900">{value || '—'}</div>}
    </div>
  )
}
