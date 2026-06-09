import { PaneHeader } from '@/components/shell/PaneHeader'
import { findItem } from '@/lib/registry'

export default function RollingLayout({ children }: { children: React.ReactNode }) {
  const item = findItem('rolling')!
  return (
    <>
      <PaneHeader item={item} />
      <div className="flex-1 overflow-y-auto bg-cream">
        <div className="max-w-[1200px] mx-auto px-4 py-4 md:px-6 md:py-6">
          {children}
        </div>
      </div>
    </>
  )
}
