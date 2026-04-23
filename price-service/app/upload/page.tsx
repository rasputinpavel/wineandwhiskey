'use client'

import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type UploadState = 'idle' | 'uploading' | 'processing' | 'done' | 'error'

export default function UploadPage() {
  const [state, setState] = useState<UploadState>('idle')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [filename, setFilename] = useState('')
  const [progress, setProgress] = useState(0)
  const [itemCount, setItemCount] = useState<number | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const router = useRouter()

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const pollStatus = useCallback((id: string) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/price-lists/${id}`)
      if (!res.ok) return
      const pl = await res.json()
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
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Загружайте только PDF файлы')
      setState('error')
      return
    }

    setFilename(file.name)
    setError('')
    setState('uploading')
    setProgress(0)

    // Step 1: Get presigned upload URL
    const signRes = await fetch('/api/price-lists/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name }),
    })

    if (!signRes.ok) {
      setError('Не удалось получить URL для загрузки')
      setState('error')
      return
    }

    const { signedUrl, path } = await signRes.json()

    // Step 2: Upload directly to Supabase Storage (bypasses Next.js body limit)
    // Use XHR for progress tracking
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

    // Step 3: Trigger extraction
    const res = await fetch('/api/price-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
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
  }, [pollStatus, state])

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
    setItemCount(null)
    setSupplierName('')
    setError('')
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
          <span className="text-wine-600 font-bold text-lg tracking-tight">Загрузка прайса</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        {state === 'idle' && (
          <div
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all
              ${dragging ? 'border-wine-500 bg-wine-50' : 'border-gray-200 bg-white hover:border-wine-300 hover:bg-gray-50'}`}
          >
            <input ref={fileRef} type="file" accept=".pdf,application/pdf" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} className="hidden" />
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 0 1-.88-7.903A5 5 0 1 1 15.9 6L16 6a5 5 0 0 1 1 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="text-gray-700 font-medium">Перетащите PDF или нажмите для выбора</p>
            <p className="text-sm text-gray-400 mt-1">Любой размер файла</p>
          </div>
        )}

        {state === 'uploading' && (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-wine-50 mb-2">
              <svg className="w-8 h-8 text-wine-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 0 1-.88-7.903A5 5 0 1 1 15.9 6L16 6a5 5 0 0 1 1 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-gray-900">Загрузка файла...</p>
              <p className="text-sm text-gray-500 mt-1">{filename}</p>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div className="bg-wine-600 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-sm text-gray-400">{progress}%</p>
          </div>
        )}

        {state === 'processing' && (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-wine-50 mb-2">
              <svg className="w-8 h-8 text-wine-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-gray-900">Claude читает прайс...</p>
              <p className="text-sm text-gray-500 mt-1">{filename}</p>
              <p className="text-xs text-gray-400 mt-3">Извлечение позиций занимает 30–120 секунд</p>
            </div>
          </div>
        )}

        {state === 'done' && (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-50 mb-2">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-lg">Готово!</p>
              {supplierName && <p className="text-gray-500 mt-1">{supplierName}</p>}
              {itemCount != null && <p className="text-2xl font-bold text-wine-600 mt-2">{itemCount} позиций</p>}
            </div>
            <div className="flex gap-3 justify-center pt-2">
              <button onClick={reset} className="px-4 py-2 border border-gray-200 rounded-xl text-sm hover:bg-gray-50 transition-colors">
                Загрузить ещё
              </button>
              <button onClick={() => router.push('/')} className="px-4 py-2 bg-wine-600 hover:bg-wine-700 text-white rounded-xl text-sm transition-colors">
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
              <p className="font-semibold text-gray-900">Ошибка</p>
              <p className="text-sm text-gray-500 mt-1">{error}</p>
            </div>
            <button onClick={reset} className="px-4 py-2 bg-wine-600 hover:bg-wine-700 text-white rounded-xl text-sm transition-colors">
              Попробовать снова
            </button>
          </div>
        )}

        {state === 'idle' && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Как это работает</h3>
            <ol className="space-y-2 text-sm text-gray-500">
              {[
                'Загрузите PDF прайс-листа от любого поставщика',
                'Claude AI автоматически распознаёт поставщика, дату и все позиции',
                'Позиции появляются в общей таблице — с фильтрами по стране, сорту, цене',
              ].map((text, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-wine-100 text-wine-600 flex-shrink-0 flex items-center justify-center text-xs font-bold">{i + 1}</span>
                  {text}
                </li>
              ))}
            </ol>
          </div>
        )}
      </main>
    </div>
  )
}
