'use client'
import type { Lang } from '@/lib/types'

export function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-pale-stone/30 text-xs">
      {(['ru', 'en'] as Lang[]).map(l => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={l === lang ? 'bg-amber-gold px-3 py-1 text-deep-black' : 'px-3 py-1 text-pale-stone'}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
