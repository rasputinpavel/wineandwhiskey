'use client'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Timer } from '@/components/Timer'
import { Leaderboard } from '@/components/Leaderboard'
import { LangToggle } from '@/components/LangToggle'
import type { CategoryDef, Hint, RoundStatus, WineAnswers } from '@/lib/types'

type HostWine = {
  id: string; order_no: number; label: string; name: string
  country: string | null; region: string | null; grape: string | null
  vintage: number | null; style: string | null; abv: number | null
  answers: WineAnswers; hints: Hint[]; status: RoundStatus; ends_at: string | null
}

type HostState = {
  game: {
    id: string; pin: string; title: string; status: string
    difficulty: string; round_seconds: number; categories: CategoryDef[]
    current_wine_id: string | null
  }
  wines: HostWine[]
  players: Array<{ id: string; nickname: string; chips: number }>
  state: { round_status: RoundStatus; ends_at: string | null; revealed_hints: Hint[] } | null
}

const TICK_MS = 2000

// The host holds a bottle in one hand and this in the other. Russian first,
// because that is who runs our evenings; the toggle is there because it might
// not be. Kept local rather than in lib/i18n.ts, which is the guest vocabulary.
const T = {
  pin:        { ru: 'PIN',                 en: 'PIN' },
  players:    { ru: 'гостей',              en: 'players' },
  loading:    { ru: 'Загружаю…',           en: 'Loading…' },
  badLink:    { ru: 'Ссылка ведущего недействительна', en: 'Bad host link' },
  noToken:    { ru: 'В ссылке нет токена ведущего',    en: 'Missing host token' },
  more:       { ru: 'Другие действия',     en: 'Other actions' },
  open:       { ru: 'Открыть лобби',       en: 'Open lobby' },
  start:      { ru: 'Начать раунд',        en: 'Start round' },
  lock:       { ru: 'Закрыть ставки',      en: 'Close bets' },
  reveal:     { ru: 'Вскрыть',             en: 'Reveal' },
  next:       { ru: 'Следующее вино',      en: 'Next wine' },
  finish:     { ru: 'Завершить игру',      en: 'Finish the game' },
  board:      { ru: 'Таблица',             en: 'Leaderboard' },
  order:      { ru: 'Порядок вин',         en: 'Running order' },
  answers:    { ru: 'Ответы — читать вслух после вскрытия', en: 'Answers — read aloud after the reveal' },
  hintsOut:   { ru: 'Показанные подсказки',en: 'Hints shown so far' },
  overLabel:  { ru: 'Игра окончена',       en: 'Game over' },
  overHint:   { ru: 'Пьедестал на экране. Можно объявлять победителя.', en: 'The podium is on the screen.' },
  stepOpen:   { ru: 'Откройте лобби — пока гости не могут войти.', en: 'Open the lobby so guests can join.' },
  stepStart:  { ru: 'Налейте вино вслепую и начинайте раунд.',     en: 'Pour the wine blind, then start the round.' },
  stepBet:    { ru: 'Идут ставки. Можно закрыть раньше таймера.',  en: 'Betting is open. You may close early.' },
  stepReveal: { ru: 'Ставки закрыты. Показывайте бутылку и вскрывайте.', en: 'Bets are closed. Show the bottle and reveal.' },
  stepTalk:   { ru: 'Расскажите про вино, потом переходите дальше.',     en: 'Talk about the wine, then move on.' },
  waiting:    { ru: 'Ждём гостей. Они видят QR и PIN на экране.',  en: 'Waiting for guests — the screen shows the QR and PIN.' },
} as const
type TKey = keyof typeof T
type HostLang = 'ru' | 'en'

function HostPanel() {
  const token = useSearchParams().get('t') ?? ''
  const [data, setData] = useState<HostState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`/api/host/state?t=${token}`, { cache: 'no-store' })
      if (!res.ok) { setError('Bad host link'); return }
      setData(await res.json())
    } catch {
      // Shop wifi blips. Keep whatever we last had on screen; the buttons
      // stay live because `busy` is cleared regardless (see `act`).
      setError('Connection lost — retrying…')
    }
  }, [token])

  useEffect(() => { void refresh() }, [refresh])

  // The host's browser is the game clock. Nothing else reveals hints.
  useEffect(() => {
    if (!token) return
    const timer = setInterval(async () => {
      if (data?.state?.round_status !== 'betting') return
      await fetch('/api/host/tick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ t: token }),
      }).catch(() => { /* one missed tick just delays a hint by two seconds */ })
      void refresh()
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [token, data?.state?.round_status, refresh])

  async function act(action: 'open' | 'start' | 'lock' | 'reveal' | 'next') {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/host/round', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ t: token, action }),
      })
      if (!res.ok) { setError(`Action "${action}" failed`); return }
      await refresh()
    } catch {
      // A rejected fetch must never leave every button dead with no
      // explanation — that is exactly what shop wifi does to this panel.
      setError(`Action "${action}" failed — check connection`)
    } finally {
      setBusy(false)
    }
  }

  const [lang, setLang] = useState<HostLang>('ru')
  const t = (k: TKey) => T[k][lang]

  if (!token) return <main className="p-8 text-pale-stone">{t('noToken')}</main>
  if (!data) return <main className="p-8 text-pale-stone">{error ?? t('loading')}</main>

  const current = data.wines.find(w => w.id === data.game.current_wine_id) ?? null
  const status = data.state?.round_status ?? 'pending'
  const finished = data.game.status === 'finished'
  const isLast = current ? current.order_no >= data.wines.length : false
  const nextWine = data.wines.find(w => w.status === 'pending') ?? null

  // One thing to do at a time. Five buttons of equal weight is a menu, and a
  // menu is the wrong thing to hand someone who is pouring wine in a dim room.
  const step: { action: 'open' | 'start' | 'lock' | 'reveal' | 'next' | null; label: string; hint: string } =
    finished                      ? { action: null,     label: '',                 hint: t('overHint') }
    : status === 'betting'        ? { action: 'lock',   label: t('lock'),          hint: t('stepBet') }
    : status === 'locked'         ? { action: 'reveal', label: t('reveal'),        hint: t('stepReveal') }
    : status === 'revealed'       ? { action: 'next',   label: isLast ? t('finish') : t('next'), hint: t('stepTalk') }
    : data.game.status === 'draft'? { action: 'open',   label: t('open'),          hint: t('stepOpen') }
    :                               { action: 'start',  label: t('start'),         hint: t('stepStart') }

  const secondary: Array<{ action: 'open' | 'start' | 'lock' | 'reveal' | 'next'; label: string }> = [
    { action: 'open', label: t('open') },
    { action: 'start', label: t('start') },
    { action: 'lock', label: t('lock') },
    { action: 'reveal', label: t('reveal') },
    { action: 'next', label: t('next') },
  ].filter(b => b.action !== step.action) as typeof secondary

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-display text-amber-gold">{data.game.title}</h1>
          <p className="text-sm text-pale-stone">
            {t('pin')} {data.game.pin} · {data.players.length} {t('players')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {status === 'betting' && <Timer endsAt={data.state?.ends_at ?? null} />}
          <LangToggle lang={lang} onChange={l => setLang(l as HostLang)} />
        </div>
      </header>

      {error && <p className="rounded-md bg-wine-red/20 px-3 py-2 text-sm text-wine-red">{error}</p>}

      {/* What to do now, then the one button that does it. */}
      <section className="space-y-3">
        <p className="text-lg text-warm-white">{step.hint}</p>
        {step.action ? (
          <button
            disabled={busy}
            onClick={() => act(step.action!)}
            className="w-full rounded-lg bg-amber-gold py-6 font-heading text-2xl text-deep-black disabled:opacity-40"
          >
            {step.label}
            {step.action === 'start' && nextWine && (
              <span className="mt-1 block text-sm font-normal opacity-70">
                {nextWine.order_no}/{data.wines.length} · {nextWine.name}
              </span>
            )}
          </button>
        ) : (
          <p className="font-display text-4xl text-amber-gold">{t('overLabel')}</p>
        )}
        {data.players.length === 0 && data.game.status !== 'draft' && status === 'pending' && (
          <p className="text-sm text-pale-stone">{t('waiting')}</p>
        )}
      </section>

      {/* The current bottle, for reading aloud. This is the one screen that
          shows answers before the reveal — keep it off the TV. */}
      {current && (
        <section className="rounded-lg border border-pale-stone/20 p-4">
          <div className="mb-1 text-xs uppercase tracking-overline text-pale-stone">
            {current.label} · {current.order_no}/{data.wines.length} · {t('answers')}
          </div>
          <h2 className="font-heading text-xl">{current.name}</h2>
          <p className="text-sm text-pale-stone">
            {[current.country, current.region, current.grape, current.vintage, current.abv && `${current.abv}%`]
              .filter(Boolean).join(' · ')}
          </p>
          {data.state && data.state.revealed_hints.length > 0 && (
            <>
              <div className="mt-3 text-xs uppercase tracking-overline text-pale-stone">{t('hintsOut')}</div>
              <ul className="space-y-1 text-sm text-amber-gold">
                {data.state.revealed_hints.map((h, i) => <li key={i}>· {lang === 'ru' ? h.ru : h.en}</li>)}
              </ul>
            </>
          )}
        </section>
      )}

      {/* Everything else, demoted. Needed only when an evening goes off script. */}
      {!finished && (
        <details className="rounded-md border border-pale-stone/15 px-3 py-2">
          <summary className="cursor-pointer text-sm text-pale-stone">{t('more')}</summary>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {secondary.map(b => (
              <button
                key={b.action}
                disabled={busy}
                onClick={() => act(b.action)}
                className="rounded-md border border-pale-stone/30 py-2 text-sm text-pale-stone disabled:opacity-40"
              >
                {b.label}
              </button>
            ))}
          </div>
        </details>
      )}

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-overline text-pale-stone">{t('board')}</h3>
        <Leaderboard players={data.players} max={30} />
      </section>

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-overline text-pale-stone">{t('order')}</h3>
        <ol className="space-y-1 text-sm">
          {data.wines.map(w => (
            <li key={w.id} className={w.id === data.game.current_wine_id ? 'text-amber-gold' : 'text-pale-stone'}>
              {w.order_no}. {w.name} — {w.status}
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}

export default function Host() {
  return <Suspense><HostPanel /></Suspense>
}
