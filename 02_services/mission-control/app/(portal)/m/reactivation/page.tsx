import { loadReactivationCustomers } from '@/lib/reactivation/data'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { ReactivationTable } from './ReactivationTable'

export const dynamic = 'force-dynamic'

type SearchParams = { window?: string }

export default async function ReactivationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const windowDays = sp.window === '180' || sp.window === '365' || sp.window === '730'
    ? Number(sp.window)
    : 365

  let customers
  try {
    customers = await loadReactivationCustomers({ windowDays })
  } catch (e) {
    return <div className="p-6"><SchemaError error={(e as Error).message} /></div>
  }

  return (
    <div className="p-6">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">Reactivation</h2>
        <DataFreshness sources={['loyverse_receipts']} />
      </div>
      <p className="text-graphite text-sm mb-4 max-w-3xl">
        B2C customers who bought from us in the last {windowDays} days, sorted by net spend.
        Skipped: B2B receipts, walk-ins without a customer card, and Yuri (former owner). Use
        the <span className="text-deep-black">Message</span> button to draft a warm English
        reminder for WhatsApp — Claude personalises it from the customer&apos;s last visit and
        favourite drink.
      </p>

      <div className="flex items-center gap-1 mb-4 text-xs">
        {([180, 365, 730] as const).map(d => {
          const active = windowDays === d
          return (
            <a key={d}
              href={`/m/reactivation?window=${d}`}
              className={`px-3 py-1.5 rounded-sm border transition-colors ${
                active
                  ? 'bg-wine-red text-warm-white border-wine-red'
                  : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
              }`}>
              {d === 730 ? '2 years' : d === 365 ? '1 year' : '6 months'}
            </a>
          )
        })}
      </div>

      <ReactivationTable customers={customers} />
    </div>
  )
}
