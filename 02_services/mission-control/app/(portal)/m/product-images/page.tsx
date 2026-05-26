import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { ProductGrid } from './ProductGrid'
import { uploadProductImage, replaceProductImage } from './upload-action'

export const dynamic = 'force-dynamic'

const REPO = 'https://github.com/rasputinpavel/wineandwhiskey'

export type ProductImage = {
  name: string        // file basename, e.g. "barolo-cannubi.png"
  slug: string        // without extension
  href: string        // public URL
  size: number
  mtime: number       // ms since epoch
}

async function listProductImages(): Promise<ProductImage[]> {
  const dir = path.join(process.cwd(), 'public', 'brand', 'products')
  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: ProductImage[] = []
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('.') || e.name.startsWith('_')) continue
    const ext = path.extname(e.name).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) continue
    const st = await stat(path.join(dir, e.name))
    out.push({
      name: e.name,
      slug: e.name.slice(0, e.name.length - ext.length),
      href: `/brand/products/${e.name}`,
      size: st.size,
      mtime: st.mtimeMs,
    })
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

export default async function ProductImagesPage() {
  const item = findItem('product-images')!
  const images = await listProductImages()

  return (
    <>
      <PaneHeader item={item} externalHref={`${REPO}/tree/main/04_brand/products`} />
      <div className="flex-1 overflow-y-auto bg-warm-white">
        <div className="max-w-[1200px] mx-auto px-6 py-6 space-y-5">
          <header>
            <div className="overline text-graphite">Brand & Design</div>
            <h1 className="font-display text-deep-black uppercase tracking-display" style={{ fontSize: 36, lineHeight: 1 }}>
              Product Images
            </h1>
            <p className="text-sm text-graphite mt-1">
              {images.length} cutouts in <code className="text-xs">04_brand/products/</code>.
              {' '}Used by the storefront, social posts, and as label material for new creatives.
            </p>
          </header>

          <ProductGrid
            images={images}
            uploadAction={uploadProductImage}
            replaceAction={replaceProductImage}
          />
        </div>
      </div>
    </>
  )
}
