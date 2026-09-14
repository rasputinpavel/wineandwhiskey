// Shared between the live scrape form and the run history table.
export function ScrapeStatusChip({ status }: { status: string }) {
  const color =
    status === 'imported'  ? 'bg-deep-black text-warm-white' :
    status === 'succeeded' ? 'bg-amber-gold text-deep-black' :
    status === 'failed' || status === 'aborted' ? 'bg-wine-red text-warm-white' :
    'bg-cream text-graphite'
  return <span className={`text-[11px] px-2 py-0.5 rounded-sm uppercase ${color}`}>{status}</span>
}
