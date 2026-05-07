'use client'

import { Item } from '@/lib/registry'

export function ExternalCard({ item }: { item: Item }) {
  if (item.embed.kind !== 'external') return null
  const { href, mirrors = [] } = item.embed

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-xl w-full bg-warm-white border border-pale-stone rounded-md p-8 text-center shadow-card">
        <div className="text-5xl mb-4 leading-none">{item.icon}</div>
        <h2 className="font-heading text-2xl text-deep-black mb-2">{item.name}</h2>
        <p className="text-graphite text-sm leading-relaxed mb-6">
          {item.description}
        </p>
        <p className="text-xs text-graphite mb-4">
          Этот сервис не разрешает встраивание в iframe.
          Открой в новой вкладке — всё под рукой.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-5 py-2.5 bg-wine-red hover:bg-burgundy-deep text-warm-white text-sm font-medium rounded-sm transition-colors"
          >
            Open ↗
          </a>
          {mirrors.map(m => (
            <a
              key={m.label}
              href={m.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-graphite hover:text-wine-red border border-pale-stone hover:border-wine-red px-3 py-2 rounded-sm transition-colors"
            >
              {m.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
