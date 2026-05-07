'use client'

import { Item, STATUS_LABEL } from '@/lib/registry'

export function PlaceholderPanel({ item }: { item: Item }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="text-5xl mb-4">{item.icon}</div>
        <h2 className="font-heading text-2xl text-deep-black mb-2">{item.name}</h2>
        <div className="overline text-amber-gold mb-3">{STATUS_LABEL[item.status]}</div>
        <p className="text-graphite text-sm leading-relaxed">{item.description}</p>
      </div>
    </div>
  )
}
