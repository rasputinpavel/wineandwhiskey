'use client'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/** The TV's join panel: a QR that opens the join screen with the PIN prefilled,
 *  plus the PIN in huge digits for anyone whose camera will not cooperate. */
export function QrPanel({ pin }: { pin: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [joinUrl, setJoinUrl] = useState('')

  useEffect(() => {
    // The env var is baked in at build time and can be missing; the TV always
    // knows its own origin. Without a scheme the QR encodes bare text and a
    // phone camera offers nothing to tap, which strands guests at the one
    // moment the thing has to work.
    // A QR without a scheme is just text: the camera reads it and offers
    // nothing to tap. NEXT_PUBLIC_CASINO_URL is typed by a human into Railway,
    // so normalise rather than trust it — a bare domain there stranded a whole
    // table at the door once already.
    const raw = (process.env.NEXT_PUBLIC_CASINO_URL || '').trim().replace(/\/+$/, '')
    const base = raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : window.location.origin
    setJoinUrl(`${base}/?pin=${pin}`)
  }, [pin])

  useEffect(() => {
    if (!joinUrl) return
    QRCode.toDataURL(joinUrl, { width: 480, margin: 1, color: { dark: '#14342B', light: '#F5F0EB' } })
      .then(setDataUrl)
      .catch(() => setDataUrl(null))
  }, [joinUrl])

  return (
    <div className="flex flex-col items-center gap-6">
      {dataUrl && <img src={dataUrl} alt="" className="h-72 w-72 rounded-lg" />}
      <div className="text-center">
        <div className="text-sm uppercase tracking-overline text-pale-stone">PIN</div>
        <div className="font-display text-7xl tracking-display text-amber-gold">{pin}</div>
      </div>
    </div>
  )
}
