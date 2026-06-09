import { WineMatrixNav } from '@/components/modules/wine-matrix/ModuleNav'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { findItem } from '@/lib/registry'

export default function WineMatrixLayout({ children }: { children: React.ReactNode }) {
  const item = findItem('wine-matrix')!
  return (
    <>
      <PaneHeader item={item} />
      <WineMatrixNav />
      <div className="flex-1 overflow-y-auto bg-cream">
        <div className="max-w-[1400px] mx-auto px-4 py-4 md:px-6 md:py-6">
          {children}
        </div>
      </div>
    </>
  )
}
