import { PaneHeader } from '@/components/shell/PaneHeader'
import { PulseTabs } from '@/components/modules/pulse/PulseTabs'
import { findItem } from '@/lib/registry'

export default function PulseLayout({ children }: { children: React.ReactNode }) {
  const item = findItem('pulse')!
  return (
    <>
      <PaneHeader item={item} />
      <div className="flex-1 overflow-y-auto bg-cream">
        <div className="max-w-[1280px] mx-auto px-4 py-4 md:px-6 md:py-6">
          <PulseTabs />
          {children}
        </div>
      </div>
    </>
  )
}
