import { notFound } from 'next/navigation'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { IframeEmbed } from '@/components/embeds/IframeEmbed'
import { ExternalCard } from '@/components/embeds/ExternalCard'
import { EnvPanel } from '@/components/embeds/EnvPanel'
import { PlaceholderPanel } from '@/components/embeds/PlaceholderPanel'

export const dynamic = 'force-dynamic'

export default async function ItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const item = findItem(slug)
  if (!item) notFound()
  if (item.embed.kind === 'native') {
    // Native modules own their own routes — this catch-all should never see them.
    notFound()
  }

  const externalHref =
    item.embed.kind === 'external' ? item.embed.href :
    item.embed.kind === 'iframe'   ? (item.embed.openHref ?? item.embed.src) :
    null

  return (
    <>
      <PaneHeader item={item} externalHref={externalHref} />
      <div className="flex-1 overflow-hidden bg-cream">
        {item.embed.kind === 'iframe'   && <IframeEmbed src={item.embed.src} title={item.name} />}
        {item.embed.kind === 'external' && <ExternalCard item={item} />}
        {item.embed.kind === 'builtin'  && item.embed.component === 'env'         && <EnvPanel />}
        {item.embed.kind === 'builtin'  && item.embed.component === 'placeholder' && <PlaceholderPanel item={item} />}
      </div>
    </>
  )
}
