import { ContentSkeleton } from '@/components/shell/ContentSkeleton'

// Catch-all fallback for sections without their own loading.tsx — keeps the
// content column from looking frozen while the page's server component fetches.
export default function Loading() {
  return (
    <div className="flex-1 overflow-y-auto bg-cream">
      <div className="max-w-[1200px] mx-auto px-4 py-4 md:px-6 md:py-6">
        <ContentSkeleton />
      </div>
    </div>
  )
}
