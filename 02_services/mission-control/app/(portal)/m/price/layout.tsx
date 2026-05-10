import { PriceNav } from '@/components/modules/price/PriceNav'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { findItem } from '@/lib/registry'

export default function PriceLayout({ children }: { children: React.ReactNode }) {
  const item = findItem('price')!
  return (
    <>
      <PaneHeader item={item} />
      <PriceNav />
      <div className="flex-1 overflow-y-auto bg-cream">
        <div className="max-w-[1200px] mx-auto px-6 py-6">
          {children}
        </div>
      </div>
    </>
  )
}
