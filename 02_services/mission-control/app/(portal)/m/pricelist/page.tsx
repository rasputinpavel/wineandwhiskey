import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { readCatalog } from '@/lib/pricelist/catalog'
import { listSaved } from '@/lib/pricelist/store'
import { PricelistBuilderClient } from './PricelistBuilderClient'

export const dynamic = 'force-dynamic'

export default async function PricelistPage() {
  const item = findItem('pricelist')!
  const [catalog, saved] = await Promise.all([
    readCatalog().catch(() => []),
    listSaved().catch(() => []),
  ])
  return (
    <div className="flex flex-col h-full">
      <PaneHeader item={item} />
      <PricelistBuilderClient catalog={catalog} saved={saved} />
    </div>
  )
}
