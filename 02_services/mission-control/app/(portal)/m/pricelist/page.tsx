import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { readCatalog } from '@/lib/pricelist/catalog'
import { listSaved } from '@/lib/pricelist/store'
import { PricelistBuilderClient } from './PricelistBuilderClient'

export const dynamic = 'force-dynamic'

// Slugs of the bottle shots the render/preview can resolve by exact name-slug.
async function listImageSlugs(): Promise<string[]> {
  const dir = path.join(process.cwd(), 'public', 'brand', 'products')
  const files = await readdir(dir).catch(() => [] as string[])
  return files.filter(f => f.toLowerCase().endsWith('.png')).map(f => f.replace(/\.png$/i, ''))
}

export default async function PricelistPage() {
  const item = findItem('pricelist')!
  const [catalog, saved, imageSlugs] = await Promise.all([
    readCatalog().catch(() => []),
    listSaved().catch(() => []),
    listImageSlugs(),
  ])
  return (
    <div className="flex flex-col h-full">
      <PaneHeader item={item} />
      <PricelistBuilderClient catalog={catalog} saved={saved} imageSlugs={imageSlugs} />
    </div>
  )
}
