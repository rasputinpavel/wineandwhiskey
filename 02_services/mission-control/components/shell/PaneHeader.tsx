import { Item, STATUS_LABEL, statusDotClasses, findSectionForItem } from '@/lib/registry'

export function PaneHeader({
  item,
  externalHref,
  rightSlot,
}: {
  item: Item
  externalHref?: string | null
  rightSlot?: React.ReactNode
}) {
  const section = findSectionForItem(item.slug)
  return (
    <header className="bg-warm-white border-b border-pale-stone px-4 md:px-6 py-3 flex flex-wrap md:flex-nowrap items-center justify-between gap-x-3 md:gap-x-4 gap-y-2 shrink-0">
      <div className="min-w-0 flex items-center gap-3">
        <span className="text-xl leading-none">{item.icon}</span>
        <div className="min-w-0">
          <div className="overline text-graphite leading-none">{section?.label ?? '—'}</div>
          <h1 className="font-heading text-lg text-deep-black truncate leading-tight mt-0.5">{item.name}</h1>
        </div>
      </div>
      {/* Controls: on mobile wrap to their own row and scroll horizontally so
          nothing gets clipped by the content column's overflow-hidden. */}
      <div className="min-w-0 max-w-full overflow-x-auto no-scrollbar md:overflow-visible">
        <div className="flex items-center gap-2 md:gap-3 shrink-0 w-max md:w-auto">
          <span className="flex items-center gap-1.5 text-xs text-graphite shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${statusDotClasses(item.status)}`} />
            <span className="hidden md:inline">{STATUS_LABEL[item.status]}</span>
          </span>
          {rightSlot}
          {externalHref && (
            <a
              href={externalHref}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs px-3 py-1.5 border border-pale-stone hover:border-wine-red hover:text-wine-red text-graphite rounded-sm transition-colors"
            >
              Open externally ↗
            </a>
          )}
        </div>
      </div>
    </header>
  )
}
