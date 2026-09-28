'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LangToggle } from '@/components/LangToggle'
import { saveSession } from '@/lib/session'
import { t } from '@/lib/i18n'
import type { Lang } from '@/lib/types'

function JoinForm() {
  const params = useSearchParams()
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [nickname, setNickname] = useState('')
  const [lang, setLang] = useState<Lang>('ru')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The TV's QR carries ?pin=, so a guest only types their name.
  useEffect(() => {
    const p = params.get('pin')
    if (p) setPin(p)
  }, [params])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin, nickname, lang }),
    })
    setBusy(false)
    if (!res.ok) {
      const { error: code } = await res.json().catch(() => ({ error: 'errGeneric' }))
      setError(code === 'game_finished' ? t('joinClosed', lang) : t('joinNotFound', lang))
      return
    }
    const data = await res.json()
    saveSession({
      gameId: data.gameId, playerId: data.playerId, playerToken: data.playerToken,
      nickname: data.nickname, lang,
    })
    router.push('/play')
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex items-start justify-between">
        <h1 className="font-display text-5xl leading-none tracking-display text-amber-gold">
          {t('joinTitle', lang)}
        </h1>
        <LangToggle lang={lang} onChange={setLang} />
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder={t('joinPin', lang)}
          className="w-full rounded-md bg-graphite/40 px-4 py-4 text-center font-display text-3xl tracking-display outline-none focus:ring-2 focus:ring-amber-gold"
        />
        <input
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          placeholder={t('joinName', lang)}
          maxLength={24}
          className="w-full rounded-md bg-graphite/40 px-4 py-3 outline-none focus:ring-2 focus:ring-amber-gold"
        />
        {error && <p className="text-sm text-wine-red">{error}</p>}
        <button
          disabled={busy || pin.length !== 6}
          className="w-full rounded-md bg-amber-gold py-4 font-heading text-lg text-deep-black disabled:opacity-40"
        >
          {t('joinButton', lang)}
        </button>
      </form>
    </main>
  )
}

export default function Home() {
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  )
}
