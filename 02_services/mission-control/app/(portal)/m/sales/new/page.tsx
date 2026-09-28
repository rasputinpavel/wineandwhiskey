import Link from 'next/link'
import { cookies } from 'next/headers'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { NewLeadFormClient } from '@/components/modules/sales/NewLeadFormClient'

export const dynamic = 'force-dynamic'

export default async function NewLeadPage() {
  const item = findItem('sales-crm')!
  const token = (await cookies()).get(COOKIE_NAME)?.value
  const user = token ? await verifyToken(token) : null
  return (
    <>
      <PaneHeader
        item={item}
        rightSlot={
          <Link href="/m/sales" className="text-xs px-3 py-1.5 border border-pale-stone hover:border-wine-red hover:text-wine-red text-graphite rounded-sm">
            ← Back to leads
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto bg-warm-white">
        <div className="max-w-[760px] mx-auto px-6 py-6 space-y-4">
          <div>
            <div className="overline text-graphite">B2B outreach</div>
            <h1 className="font-display text-deep-black uppercase tracking-display" style={{ fontSize: 36, lineHeight: 1 }}>
              Add lead
            </h1>
            <p className="text-sm text-graphite mt-1 max-w-xl">
              For leads that didn’t come from Apify — referrals, walk-ins, places not on Google Maps yet.
            </p>
          </div>
          <NewLeadFormClient salesName={user?.sales_name ?? ''} />
        </div>
      </div>
    </>
  )
}
