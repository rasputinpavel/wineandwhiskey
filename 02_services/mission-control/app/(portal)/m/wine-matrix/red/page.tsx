import { getRedShelves } from '@/lib/wine-matrix/queries'
import { resolveBottleUrl } from '@/lib/wine-matrix/bottle-image'
import { ShelfGrid } from '@/components/modules/wine-matrix/ShelfGrid'

export const dynamic = 'force-dynamic'

export default async function WineMatrixRedPage() {
  const shelves = await getRedShelves()
  for (const sh of shelves) {
    for (const item of sh.items) {
      if (!item.image_url) item.image_url = await resolveBottleUrl(item.name)
    }
  }
  return <ShelfGrid shelves={shelves} />
}
