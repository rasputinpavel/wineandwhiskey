import { PaneHeader } from '@/components/shell/PaneHeader'
import { SuppliersNav } from '@/components/modules/suppliers/SuppliersNav'
import { findItem } from '@/lib/registry'

export default function SuppliersLayout({ children }: { children: React.ReactNode }) {
  const item = findItem('suppliers')!
  return (
    <>
      <PaneHeader item={item} />
      <SuppliersNav />
      <div className="flex-1 overflow-y-auto bg-cream">
        <div className="max-w-[1280px] mx-auto px-6 py-6">
          {children}
        </div>
      </div>
    </>
  )
}
