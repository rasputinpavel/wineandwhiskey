// Shown the instant the user clicks a SKU — Next.js streams it while the
// page's server component fetches data. Without this the click looks dead
// for ~7s (the Loyverse REST window scan).

export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-3 w-24 bg-pale-stone/60 rounded-sm mb-4" />
      <div className="h-4 w-32 bg-pale-stone/60 rounded-sm mb-2" />
      <div className="h-8 w-72 bg-pale-stone/60 rounded-sm mb-8" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="bg-warm-white border border-pale-stone rounded-md p-4">
            <div className="h-3 w-20 bg-pale-stone/60 rounded-sm mb-3" />
            <div className="h-8 w-16 bg-pale-stone/40 rounded-sm" />
          </div>
        ))}
      </div>

      {[0, 1, 2, 3].map(i => (
        <div key={i} className="mb-10">
          <div className="h-4 w-48 bg-pale-stone/60 rounded-sm mb-3" />
          <div className="bg-warm-white border border-pale-stone rounded-md h-32" />
        </div>
      ))}
    </div>
  )
}
