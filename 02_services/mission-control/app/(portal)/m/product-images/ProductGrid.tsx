'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import type { ProductImage } from './page'
import type { UploadResult } from './upload-action'

type Props = {
  images: ProductImage[]
  uploadAction: (formData: FormData) => Promise<UploadResult>
  replaceAction: (slug: string, formData: FormData) => Promise<UploadResult>
}

function humanizeSlug(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ProductGrid({ images, uploadAction, replaceAction }: Props) {
  const [query, setQuery] = useState('')
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [replacingSlug, setReplacingSlug] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return images
    const tokens = q.split(/\s+/).filter(Boolean)
    return images.filter(img => {
      const hay = img.slug.toLowerCase()
      return tokens.every(t => hay.includes(t))
    })
  }, [images, query])

  function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const formData = new FormData()
    for (const f of Array.from(files)) formData.append('files', f)

    setMessage(null)
    startTransition(async () => {
      const res = await uploadAction(formData)
      if (res.ok) {
        setMessage({ kind: 'ok', text: `Uploaded ${res.written.length} file${res.written.length === 1 ? '' : 's'}.` })
      } else {
        setMessage({ kind: 'err', text: res.error })
      }
      if (fileInputRef.current) fileInputRef.current.value = ''
    })
  }

  function onReplace(slug: string, file: File | undefined) {
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)

    setMessage(null)
    setReplacingSlug(slug)
    startTransition(async () => {
      const res = await replaceAction(slug, formData)
      if (res.ok) {
        setMessage({ kind: 'ok', text: `Replaced ${res.written[0]}.` })
      } else {
        setMessage({ kind: 'err', text: res.error })
      }
      setReplacingSlug(null)
    })
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by slug — e.g. ‘barolo’, ‘malbec mendoza’"
            className="w-full px-3 py-2 border border-pale-stone rounded-sm bg-warm-white text-sm text-deep-black placeholder:text-graphite focus:outline-none focus:border-wine-red"
          />
        </div>
        <div className="flex items-center gap-2">
          <label
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-sm text-sm font-medium cursor-pointer transition-colors ${
              isPending
                ? 'bg-pale-stone text-graphite cursor-wait'
                : 'bg-wine-red text-warm-white hover:bg-burgundy-deep'
            }`}
          >
            {isPending ? 'Uploading…' : '+ Upload'}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              disabled={isPending}
              className="sr-only"
              onChange={e => onPickFiles(e.target.files)}
            />
          </label>
          <span className="text-[11px] text-graphite hidden md:inline">
            PNG · JPG · WEBP · max 8 MB
          </span>
        </div>
      </div>

      {message && (
        <div
          className={`px-3 py-2 rounded-sm text-sm ${
            message.kind === 'ok'
              ? 'bg-cream/60 text-deep-black border border-pale-stone'
              : 'bg-wine-red/10 text-wine-red border border-wine-red/30'
          }`}
        >
          {message.text}
          {message.kind === 'ok' && (
            <span className="block text-[11px] text-graphite mt-0.5">
              Written to <code>04_brand/products/</code> and served immediately. Commit + push to keep in repo.
            </span>
          )}
        </div>
      )}

      <div className="text-[12px] text-graphite">
        {filtered.length === images.length
          ? `Showing all ${images.length}`
          : `Showing ${filtered.length} of ${images.length}`}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-graphite text-sm border border-dashed border-pale-stone rounded-md">
          Nothing matches <code>{query}</code>.
        </div>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {filtered.map(img => {
            const isReplacing = replacingSlug === img.slug
            return (
              <li key={img.name}>
                <div
                  className={`group border rounded-md overflow-hidden bg-warm-white transition-all ${
                    isReplacing
                      ? 'border-amber-gold shadow-card-hover'
                      : 'border-pale-stone hover:shadow-card-hover hover:border-wine-red/40'
                  }`}
                >
                  <div className="relative aspect-square bg-cream/40">
                    <a
                      href={img.href}
                      target="_blank"
                      rel="noopener"
                      className="absolute inset-0 flex items-center justify-center p-3"
                      title={img.name}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`${img.href}?v=${img.mtime}`}
                        alt={img.slug}
                        className="max-h-full max-w-full object-contain"
                      />
                    </a>
                    {isReplacing && (
                      <div className="absolute inset-0 bg-warm-white/80 flex items-center justify-center text-[11px] uppercase tracking-[0.15em] text-graphite pointer-events-none">
                        Updating…
                      </div>
                    )}
                  </div>
                  <div className="px-2 py-1.5 border-t border-pale-stone flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-deep-black truncate font-medium" title={humanizeSlug(img.slug)}>
                        {humanizeSlug(img.slug)}
                      </div>
                      <div className="text-[10px] text-graphite truncate flex items-center justify-between">
                        <span className="truncate" title={img.slug}>{img.slug}</span>
                        <span className="shrink-0 ml-2">{fmtSize(img.size)}</span>
                      </div>
                    </div>
                    <label
                      className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-sm border text-[13px] leading-none transition-colors ${
                        isPending
                          ? 'border-pale-stone text-pale-stone cursor-wait'
                          : 'border-pale-stone text-graphite cursor-pointer hover:border-wine-red hover:text-wine-red'
                      }`}
                      title="Replace this image"
                      aria-label={`Replace ${img.slug}`}
                    >
                      ↻
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={isPending}
                        className="sr-only"
                        onChange={e => onReplace(img.slug, e.target.files?.[0])}
                      />
                    </label>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
