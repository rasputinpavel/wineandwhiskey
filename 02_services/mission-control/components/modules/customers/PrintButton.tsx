'use client'

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="text-xs px-3 py-1.5 bg-wine-red hover:bg-burgundy-deep text-warm-white rounded-sm"
    >
      Print / Save as PDF
    </button>
  )
}
