'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ACCEPTED_EXTENSIONS, ACCEPTED_TYPES } from '@/lib/price/file-types'

type UploadState = 'idle' | 'uploading' | 'processing' | 'done' | 'error'

export default function UploadPage() {
  const [state, setState] = useState<UploadState>('idle')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [filename, setFilename] = useState('')
  const [progress, setProgress] = useState(0)
  const [extractProgress, setExtractProgress] = useState(0)
  const [extractPhase, setExtractPhase] = useState<string>('')
  const [extractItemCount, setExtractItemCount] = useState<number>(0)
  const [itemCount, setItemCount] = useState<number | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; item_count: number }[]>([])
  const [targetSupplierId, setTargetSupplierId] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/m/price/suppliers')
      .then(r => r.ok ? r.json() : [])
      .then(setSuppliers)
      .catch(() => {})
  }, [])

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const pollStatus = useCallback((id: string) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/m/price/price-lists/${id}`)
      if (!res.ok) return
      const pl = await res.json()
      if (typeof pl.progress === 'number') setExtractProgress(pl.progress)
      if (pl.progress_phase) setExtractPhase(pl.progress_phase)
      if (typeof pl.item_count === 'number') setExtractItemCount(pl.item_count)
      if (pl.status === 'done') {
        stopPolling()
        setItemCount(pl.item_count)
        setSupplierName(pl.supplier_name ?? '')
        setState('done')
      } else if (pl.status === 'error') {
        stopPolling()
        setError(pl.error_message ?? 'Ошибка при обработке')
        setState('error')
      }
    }, 2000)
  }, [])

  const upload = useCallback(async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXTENSIONS.split(',').some(ext => file.name.toLowerCase().endsWith(ext))) {
      setError('Поддерживаются: PDF, XLS, XLSX, JPG, PNG')
      setState('error')
      return
    }

    setFilename(file.name)
    setError('')
    setState('uploading')
    setProgress(0)

    const signRes = await fetch('/api/m/price/price-lists/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, mimeType: file.type }),
    })

    if (!signRes.ok) {
      setError('Не удалось получить URL для загрузки')
      setState('error')
      return
    }

    const { signedUrl, path } = await signRes.json()

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', signedUrl)
      xhr.setRequestHeader('Content-Type', 'application/pdf')
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`))
      xhr.onerror = () => reject(new Error('Network error'))
      xhr.send(file)
    }).catch(err => {
      setError(err.message ?? 'Ошибка загрузки файла')
      setState('error')
      return Promise.reject(err)
    })

    if (state === 'error') return

    const res = await fetch('/api/m/price/price-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, filename: file.name, mimeType: file.type, supplierId: targetSupplierId || undefined }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Ошибка запуска обработки')
      setState('error')
      return
    }

    const { id } = await res.json()
    setState('processing')
    pollStatus(id)
  }, [pollStatus, state, targetSupplierId])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) upload(file)
  }, [upload])

  const reset = () => {
    setState('idle')
    setFilename('')
    setProgress(0)
    setExtractProgress(0)
    setExtractPhase('')
    setExtractItemCount(0)
    setItemCount(null)
    setSupplierName('')
    setError('')
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {state === 'idle' && suppliers.length > 0 && (
        <div className="bg-white rounded-2xl border border-pale-stone p-4">
          <label className="block text-sm font-medium text-deep-black mb-1.5">Update an existing supplier</label>
          <select
            value={targetSupplierId}
            onChange={e => setTargetSupplierId(e.target.value)}
            className="w-full border border-pale-stone rounded-xl px-3 py-2 text-sm bg-white"
          >
            <option value="">New price list (auto-detect supplier)</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name} — {s.item_count} items</option>
            ))}
          </select>
          <p className="text-xs text-graphite mt-1.5">
            Pick a supplier to reconcile this PDF against its catalog (price changes, new & discontinued items) instead of adding a duplicate list.
          </p>
        </div>
      )}

      {state === 'idle' && (
        <div
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all
            ${dragging ? 'border-wine-red bg-wine-red/5' : 'border-pale-stone bg-white hover:border-wine-red/50 hover:bg-cream'}`}
        >
          <input ref={fileRef} type="file" accept={ACCEPTED_EXTENSIONS} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} className="hidden" />
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-cream mb-4">
            <svg className="w-8 h-8 text-graphite" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 0 1-.88-7.903A5 5 0 1 1 15.9 6L16 6a5 5 0 0 1 1 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <p className="text-deep-black font-medium">Перетащите PDF или нажмите для выбора</p>
          <p className="text-sm text-graphite mt-1">PDF, XLS, XLSX, JPG, PNG — любой размер</p>
        </div>
      )}

      {state === 'uploading' && (
        <div className="bg-white rounded-2xl border border-pale-stone p-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-wine-red/10 mb-2">
            <svg className="w-8 h-8 text-wine-red" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 0 1-.88-7.903A5 5 0 1 1 15.9 6L16 6a5 5 0 0 1 1 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <div>
            <p className="font-medium text-deep-black">Загрузка файла...</p>
            <p className="text-sm text-graphite mt-1">{filename}</p>
          </div>
          <div className="w-full bg-cream rounded-full h-2">
            <div className="bg-wine-red h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-sm text-graphite">{progress}%</p>
        </div>
      )}

      {state === 'processing' && (
        <div className="bg-white rounded-2xl border border-pale-stone p-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-wine-red/10 mb-2">
            <svg className="w-8 h-8 text-wine-red animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <div>
            <p className="font-medium text-deep-black">Читаем прайс...</p>
            <p className="text-sm text-graphite mt-1">{filename}</p>
          </div>
          <div className="w-full bg-cream rounded-full h-2 mt-2">
            <div className="bg-wine-red h-2 rounded-full transition-all duration-500" style={{ width: `${extractProgress}%` }} />
          </div>
          <div className="flex items-center justify-center gap-3 text-xs text-graphite">
            <span>{extractProgress}%</span>
            {extractPhase && <span className="text-graphite">·</span>}
            {extractPhase && <span className="text-graphite capitalize">{extractPhase}</span>}
            {extractItemCount > 0 && <span className="text-graphite">·</span>}
            {extractItemCount > 0 && <span className="text-deep-black font-medium">{extractItemCount} позиций</span>}
          </div>
          <p className="text-xs text-graphite">Обычно несколько секунд для известных поставщиков, до 2 минут для каталогов</p>
        </div>
      )}

      {state === 'done' && (
        <div className="bg-white rounded-2xl border border-pale-stone p-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-50 mb-2">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-deep-black text-lg">Готово!</p>
            {supplierName && <p className="text-graphite mt-1">{supplierName}</p>}
            {itemCount != null && <p className="text-2xl font-bold text-wine-red mt-2">{itemCount} позиций</p>}
          </div>
          <div className="flex gap-3 justify-center pt-2">
            <button onClick={reset} className="px-4 py-2 border border-pale-stone rounded-xl text-sm hover:bg-cream transition-colors">
              Загрузить ещё
            </button>
            <button onClick={() => router.push('/m/price')} className="px-4 py-2 bg-wine-red hover:bg-wine-red/90 text-warm-white rounded-xl text-sm transition-colors">
              К таблице
            </button>
          </div>
        </div>
      )}

      {state === 'error' && (
        <div className="bg-white rounded-2xl border border-red-100 p-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-50 mb-2">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-deep-black">Ошибка</p>
            <p className="text-sm text-graphite mt-1">{error}</p>
          </div>
          <button onClick={reset} className="px-4 py-2 bg-wine-red hover:bg-wine-red/90 text-warm-white rounded-xl text-sm transition-colors">
            Попробовать снова
          </button>
        </div>
      )}

      {state === 'idle' && (
        <div className="bg-white rounded-2xl border border-pale-stone p-5">
          <h3 className="text-sm font-medium text-deep-black mb-3">Как это работает</h3>
          <ol className="space-y-2 text-sm text-graphite">
            {[
              'Загрузите прайс в любом формате: PDF, Excel (XLS/XLSX) или картинка (JPG, PNG)',
              'Claude AI автоматически распознаёт поставщика, дату и все позиции',
              'Позиции появляются в общей таблице — с фильтрами по стране, сорту, цене',
            ].map((text, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-5 h-5 rounded-full bg-wine-red/10 text-wine-red flex-shrink-0 flex items-center justify-center text-xs font-bold">{i + 1}</span>
                {text}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
