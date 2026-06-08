// Public festival landing — Russian wine & spirits. Server component: fetches
// the live store retail price (inventory.sku.default_price) for each catalog
// SKU by loyverse_product_code, then hands the price map to the client UI.
import { sbInventory } from '@/lib/supabase'
import { BOTTLES } from './data'
import RussianWineClient from './RussianWineClient'

// Always render fresh so prices track the store price list.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Russian Wine & Spirits · Wine & Whiskey Phuket',
  description: 'Russian wine and spirits at the Wine & Whiskey store in Rawai, Phuket.',
}

async function loadPrices(): Promise<Record<string, number>> {
  const codes = BOTTLES.map((b) => b.code)
  const out: Record<string, number> = {}
  try {
    const { data } = await sbInventory
      .from('sku')
      .select('loyverse_product_code,default_price')
      .in('loyverse_product_code', codes)
    for (const r of (data ?? []) as { loyverse_product_code: string | null; default_price: number | null }[]) {
      if (r.loyverse_product_code && r.default_price != null) {
        out[r.loyverse_product_code] = Number(r.default_price)
      }
    }
  } catch {
    // Prices are best-effort; the page still renders without them.
  }
  return out
}

export default async function Page() {
  const prices = await loadPrices()
  return <RussianWineClient prices={prices} />
}
