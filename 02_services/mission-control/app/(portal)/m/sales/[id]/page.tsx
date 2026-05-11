import Link from 'next/link'
import { notFound } from 'next/navigation'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { sbSales } from '@/lib/supabase'
import type { Lead } from '@/lib/sales/types'
import { LeadDetailClient } from '@/components/modules/sales/LeadDetailClient'

export const dynamic = 'force-dynamic'

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = findItem('sales-crm')!

  const { data, error } = await sbSales.from('lead').select('*').eq('id', id).maybeSingle()
  if (error) {
    return (
      <>
        <PaneHeader item={item} />
        <div className="p-6 text-sm">
          <div className="bg-wine-red/10 border border-wine-red/40 text-wine-red rounded-md p-4">
            {error.message}
          </div>
        </div>
      </>
    )
  }
  if (!data) notFound()
  const lead = data as Lead

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
        <div className="px-6 py-5 max-w-[1300px] mx-auto">
          <LeadDetailClient lead={lead} />
        </div>
      </div>
    </>
  )
}
