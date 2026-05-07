'use client'

import { useEffect, useRef, useState } from 'react'

// Cross-origin iframe load detection is unreliable: a frame blocked by
// X-Frame-Options still fires `load`. We use a 6-second timeout — if the
// iframe hasn't reported visible content via load handler in that window,
// surface the "blocked" hint so the user can click "Open externally".
const BLOCK_TIMEOUT_MS = 6_000

export function IframeEmbed({ src, title }: { src: string; title: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [maybeBlocked, setMaybeBlocked] = useState(false)

  useEffect(() => {
    setLoaded(false); setMaybeBlocked(false)
    const t = setTimeout(() => { if (!loaded) setMaybeBlocked(true) }, BLOCK_TIMEOUT_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  return (
    <div className="relative w-full h-full">
      <iframe
        ref={iframeRef}
        src={src}
        title={title}
        className="w-full h-full bg-warm-white"
        onLoad={() => { setLoaded(true); setMaybeBlocked(false) }}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
        referrerPolicy="no-referrer-when-downgrade"
      />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-graphite text-sm">Loading…</div>
        </div>
      )}
      {maybeBlocked && (
        <div className="absolute top-3 right-3 bg-warm-white border border-amber-gold rounded-sm px-3 py-2 text-xs text-graphite shadow-card max-w-sm">
          Если ничего не загрузилось — сервис не разрешает встраивание.
          Жми <span className="text-wine-red font-medium">Open externally ↗</span> вверху.
        </div>
      )}
    </div>
  )
}
