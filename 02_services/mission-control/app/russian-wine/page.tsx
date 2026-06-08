'use client'

import { useState } from 'react'
import {
  BOTTLES, CATEGORY_LABEL, CATEGORY_ORDER,
  type Lang, type Bottle, type Category,
} from './data'

const WHATSAPP = 'https://wa.me/66809020550'
const MAPS = 'https://maps.app.goo.gl/KjDb42GC4AAZ6mKKA'

const T = {
  festival: {
    ru: 'Russian Food Festival × Central Phuket · 12–14 июня 2026 · Phuket Outdoor Arena',
    en: 'Russian Food Festival × Central Phuket · 12–14 June 2026 · Phuket Outdoor Arena',
  },
  heroKicker: { ru: 'Вино и спириты России', en: 'Wine & spirits of Russia' },
  heroLead: {
    ru: 'Игристое, красное, белое, розе и водка из Краснодара, Тамани, долины Дона и Абрау. Всё это — в нашем магазине Wine & Whiskey на Раваи. Заходите познакомиться.',
    en: 'Sparkling, red, white, rosé and vodka from Krasnodar, Taman, the Don and Abrau valley. All of it at our Wine & Whiskey store in Rawai. Come and discover it.',
  },
  ctaWa: { ru: 'Написать в WhatsApp', en: 'Message us on WhatsApp' },
  ctaMap: { ru: 'Как добраться', en: 'Find the store' },
  bestseller: { ru: 'Хит продаж', en: 'Best seller' },
  region: { ru: 'Регион', en: 'Region' },
  grape: { ru: 'Сорт', en: 'Grape' },
  abv: { ru: 'Крепость', en: 'ABV' },
  outroTitle: { ru: 'Ждём вас в магазине', en: 'See you at the store' },
  outroLead: {
    ru: 'Полный ассортимент русских и мировых вин и спиритов — на Раваи, Пхукет. Открыты ежедневно 11:00–22:00.',
    en: 'The full range of Russian and international wine & spirits — in Rawai, Phuket. Open daily 11:00–22:00.',
  },
  address: { ru: 'Rawai, Пхукет', en: 'Rawai, Phuket' },
  hours: { ru: 'Ежедневно 11:00–22:00', en: 'Open daily 11:00–22:00' },
}

function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-baseline gap-1 leading-none">
      <span className="font-display tracking-display text-wine-red text-2xl leading-none">WINE</span>
      <span className={`font-display tracking-display text-2xl leading-none ${light ? 'text-warm-white' : 'text-deep-black'}`}>
        &amp; WHISKEY
      </span>
    </div>
  )
}

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="flex items-center rounded-sm border border-pale-stone/60 overflow-hidden text-xs font-medium">
      {(['ru', 'en'] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-3 py-1.5 transition-colors ${
            lang === l ? 'bg-wine-red text-warm-white' : 'bg-transparent text-graphite hover:text-deep-black'
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

function BottleCard({ b, lang }: { b: Bottle; lang: Lang }) {
  return (
    <div className="group flex flex-col rounded-md bg-warm-white border border-pale-stone/50 shadow-card hover:shadow-card-hover transition-shadow overflow-hidden">
      <div className="relative bg-gradient-to-b from-cream to-pale-stone/40 h-56 flex items-center justify-center p-4">
        {b.bestseller && (
          <span className="absolute top-3 left-3 overline text-[10px] bg-amber-gold/95 text-deep-black px-2 py-1 rounded-sm">
            {T.bestseller[lang]}
          </span>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/brand/products/${b.image}`}
          alt={b.name}
          className="max-h-48 w-auto object-contain drop-shadow-[0_6px_14px_rgba(26,26,26,0.18)] group-hover:scale-[1.03] transition-transform"
        />
      </div>
      <div className="flex flex-col gap-2 p-5">
        <div className="overline text-graphite">{b.producer[lang]}</div>
        <div className="font-heading font-semibold text-lg leading-tight text-deep-black">{b.name}</div>
        <p className="text-sm text-graphite leading-relaxed">{b.note[lang]}</p>
        <dl className="mt-2 pt-3 border-t border-pale-stone/50 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-graphite/70">{T.region[lang]}</dt>
          <dd className="text-deep-black">{b.region[lang]}</dd>
          <dt className="text-graphite/70">{T.grape[lang]}</dt>
          <dd className="text-deep-black">{b.grape[lang]}</dd>
          <dt className="text-graphite/70">{T.abv[lang]}</dt>
          <dd className="text-deep-black">{b.abv}</dd>
        </dl>
      </div>
    </div>
  )
}

export default function RussianWinePage() {
  const [lang, setLang] = useState<Lang>('ru')

  const byCat = (c: Category) => BOTTLES.filter((b) => b.category === c)

  return (
    <main className="min-h-screen bg-warm-white text-deep-black">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-30 bg-warm-white/90 backdrop-blur border-b border-pale-stone/50">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-3">
            <a href={WHATSAPP} target="_blank" rel="noopener"
               className="hidden sm:inline-block text-sm font-medium text-graphite hover:text-wine-red transition-colors">
              {T.ctaWa[lang]}
            </a>
            <LangToggle lang={lang} setLang={setLang} />
          </div>
        </div>
      </header>

      {/* ── Hero (dark, product-visual register) ── */}
      <section className="relative overflow-hidden bg-deep-black text-warm-white">
        <div
          className="absolute inset-0 opacity-90"
          style={{
            background:
              'radial-gradient(ellipse at 75% 20%, rgba(201,168,76,0.12), transparent 55%),' +
              'radial-gradient(ellipse at 12% 105%, rgba(140,28,28,0.30), transparent 60%), #1A1A1A',
          }}
        />
        <div className="relative max-w-6xl mx-auto px-5 py-20 sm:py-28">
          <div className="overline text-amber-gold mb-5">{T.festival[lang]}</div>
          <div className="overline text-pale-stone/80 mb-3">{T.heroKicker[lang]}</div>
          <h1 className="font-display tracking-display leading-[0.9] text-6xl sm:text-8xl">
            <span className="block text-warm-white">{lang === 'ru' ? 'РУССКОЕ ВИНО' : 'RUSSIAN WINE'}</span>
            <span className="block text-wine-red">{lang === 'ru' ? '& СПИРИТЫ' : '& SPIRITS'}</span>
          </h1>
          <div className="w-24 h-px bg-amber-gold/70 my-7" />
          <p className="max-w-2xl text-lg text-pale-stone leading-relaxed">{T.heroLead[lang]}</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a href={WHATSAPP} target="_blank" rel="noopener"
               className="px-6 py-3 rounded-sm bg-wine-red hover:bg-burgundy-deep text-warm-white font-medium transition-colors">
              {T.ctaWa[lang]}
            </a>
            <a href={MAPS} target="_blank" rel="noopener"
               className="px-6 py-3 rounded-sm border border-warm-white/40 hover:border-amber-gold text-warm-white font-medium transition-colors">
              {T.ctaMap[lang]}
            </a>
          </div>
        </div>
      </section>

      {/* ── Catalog ── */}
      <div className="max-w-6xl mx-auto px-5 py-16 sm:py-20">
        {CATEGORY_ORDER.map((cat) => {
          const items = byCat(cat)
          if (!items.length) return null
          return (
            <section key={cat} className="mb-16">
              <div className="flex items-center gap-4 mb-8">
                <h2 className="font-display tracking-display text-4xl text-deep-black">{CATEGORY_LABEL[cat][lang]}</h2>
                <div className="flex-1 h-px bg-pale-stone/60" />
                <span className="overline text-graphite/60">{items.length}</span>
              </div>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((b) => <BottleCard key={b.id} b={b} lang={lang} />)}
              </div>
            </section>
          )
        })}
      </div>

      {/* ── Outro / store CTA ── */}
      <section className="bg-deep-black text-warm-white">
        <div className="max-w-6xl mx-auto px-5 py-16 sm:py-20 text-center">
          <Logo light />
          <h2 className="font-display tracking-display text-4xl sm:text-5xl mt-6 mb-4">{T.outroTitle[lang]}</h2>
          <p className="max-w-xl mx-auto text-pale-stone leading-relaxed mb-2">{T.outroLead[lang]}</p>
          <p className="text-amber-gold font-medium mb-8">{T.address[lang]} · {T.hours[lang]}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <a href={WHATSAPP} target="_blank" rel="noopener"
               className="px-6 py-3 rounded-sm bg-wine-red hover:bg-burgundy-deep text-warm-white font-medium transition-colors">
              {T.ctaWa[lang]}
            </a>
            <a href={MAPS} target="_blank" rel="noopener"
               className="px-6 py-3 rounded-sm border border-warm-white/40 hover:border-amber-gold text-warm-white font-medium transition-colors">
              {T.ctaMap[lang]}
            </a>
          </div>
        </div>
      </section>

      <footer className="bg-deep-black border-t border-warm-white/10">
        <div className="max-w-6xl mx-auto px-5 py-6 text-center overline text-pale-stone/50">
          Wine &amp; Whiskey · Rawai, Phuket
        </div>
      </footer>
    </main>
  )
}
