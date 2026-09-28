'use client'
import { pick, t } from '@/lib/i18n'
import type { Hint, Lang } from '@/lib/types'

export function HintFeed({ hints, lang }: { hints: Hint[]; lang: Lang }) {
  if (hints.length === 0) return null
  return (
    <ul className="space-y-2">
      {hints.map((h, i) => (
        <li key={i} className="rounded-md border border-amber-gold/40 bg-amber-gold/10 px-3 py-2">
          <span className="block text-[11px] uppercase tracking-overline text-amber-gold/80">
            {t('hint', lang)} {i + 1}
          </span>
          <span className="text-warm-white">{pick(h, lang)}</span>
        </li>
      ))}
    </ul>
  )
}
