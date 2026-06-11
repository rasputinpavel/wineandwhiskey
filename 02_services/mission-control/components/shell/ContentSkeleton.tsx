// Generic content-area skeleton shown the instant a section is opened, while
// its server component fetches data. Sits inside each section layout so the
// PaneHeader stays put and only the content pane pulses. Without this every
// navigation looks frozen until the server finishes paging the receipt
// history (see the analytics pages).

export function ContentSkeleton({
  cards = 4,
  rows = 8,
}: {
  cards?: number
  rows?: number
}) {
  return (
    <div className="animate-pulse">
      {/* headline strip */}
      <div className="h-4 w-40 bg-pale-stone/60 rounded-sm mb-2" />
      <div className="h-8 w-64 bg-pale-stone/50 rounded-sm mb-6" />

      {/* KPI cards */}
      {cards > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="bg-warm-white border border-pale-stone rounded-md p-4">
              <div className="h-3 w-20 bg-pale-stone/60 rounded-sm mb-3" />
              <div className="h-7 w-16 bg-pale-stone/40 rounded-sm" />
            </div>
          ))}
        </div>
      )}

      {/* table / list block */}
      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <div className="h-9 bg-pale-stone/30 border-b border-pale-stone" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 h-11 border-b border-pale-stone/60 last:border-0">
            <div className="h-3 flex-1 bg-pale-stone/40 rounded-sm" />
            <div className="h-3 w-24 bg-pale-stone/30 rounded-sm" />
            <div className="h-3 w-16 bg-pale-stone/30 rounded-sm" />
          </div>
        ))}
      </div>
    </div>
  )
}
