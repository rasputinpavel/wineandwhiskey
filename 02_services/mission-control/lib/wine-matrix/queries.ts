import 'server-only'
import { sbInventory, sbPublic } from '@/lib/supabase'
import { classifySparklingType, SPARKLING_TYPE_ORDER, SPARKLING_TYPE_LABEL, type SparklingType } from './sparkling'

export type ShelfItem = {
  key:            string            // stable React key
  name:           string
  qty:            number            // 0 for supplier-only
  cost_price:     number | null
  retail_price:   number | null
  source:         'stock' | 'supplier'
  supplier_name:  string | null
  product_code:   string | null     // for linking to /m/inventory/sku/<code>
  image_url:      string | null     // direct vivino image; null → fallback
  country:        string | null
  grape_variety:  string | null
  winery:         string | null
}

export type Shelf = {
  label:    string
  items:    ShelfItem[]
}

type SkuBreakdownRow = {
  sku_id: string
  loyverse_product_code: string | null
  name: string
  wine_color: string | null
  grape_variety: string | null
  wine_country: string | null
  default_price: number | null
  on_hand: number
}

type WineItemLite = {
  id: string
  name: string
  country: string | null
  region: string | null
  winery: string | null
  grape_variety: string | null
  wine_type: string | null
  price: number | null
  supplier_name: string | null
  vivino_image_url: string | null
  image_url: string | null
}

// ── normalization helpers ──────────────────────────────────────────────────

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, '')          // strip vintages
    .replace(/\b\d+(?:[.,]\d+)?\s*(l|ml|cl)\b/gi, '') // strip volumes
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// Fold cheap country/grape aliases so supplier name "Argentina" matches our "Argentina"
// and supplier "Sauvignon Blanc " matches grape "Sauvignon Blanc".
function normToken(s: string | null): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Last cost from purchase_orders + consignment_price for a SKU. Cheap to bulk-load
// once for all SKU IDs at the start of a request.
async function loadCostPrices(skuIds: string[]): Promise<Map<string, number>> {
  if (!skuIds.length) return new Map()
  // PO items use loyverse_product_code as `sku`; resolve via the sku table.
  const { data: skus } = await sbInventory
    .from('sku')
    .select('id,loyverse_product_code')
    .in('id', skuIds)
  const codeById   = new Map<string, string>()
  const idsByCode  = new Map<string, string>()
  for (const r of (skus ?? []) as { id: string; loyverse_product_code: string | null }[]) {
    if (r.loyverse_product_code) { codeById.set(r.id, r.loyverse_product_code); idsByCode.set(r.loyverse_product_code, r.id) }
  }

  const out = new Map<string, number>()

  // Consignment prices keyed by sku_id directly.
  const { data: consign } = await sbInventory
    .from('consignment_price')
    .select('sku_id,price_hc,created_at')
    .in('sku_id', skuIds)
    .order('created_at', { ascending: false })
  for (const r of (consign ?? []) as { sku_id: string; price_hc: number | null }[]) {
    if (r.price_hc != null && !out.has(r.sku_id)) out.set(r.sku_id, Number(r.price_hc))
  }

  // PO items: take the most recent cost_price for each sku code.
  const codes = Array.from(idsByCode.keys())
  if (codes.length) {
    const { data: poItems } = await sbPublic
      .from('purchase_order_items')
      .select('sku,cost_price,scraped_at')
      .in('sku', codes)
      .order('scraped_at', { ascending: false })
      .limit(5000)
    for (const r of (poItems ?? []) as { sku: string; cost_price: number | null }[]) {
      const skuId = idsByCode.get(r.sku)
      if (skuId && r.cost_price != null && !out.has(skuId)) out.set(skuId, Number(r.cost_price))
    }
  }

  return out
}

// ── shared loaders ─────────────────────────────────────────────────────────

async function loadStockSkus(wineColor: string): Promise<SkuBreakdownRow[]> {
  const { data, error } = await sbInventory
    .from('v_sku_breakdown')
    .select('sku_id,loyverse_product_code,name,wine_color,grape_variety,wine_country,default_price,on_hand')
    .eq('wine_color', wineColor)
    .gt('on_hand', 0)
  if (error) throw error
  return (data ?? []) as SkuBreakdownRow[]
}

async function loadWineItems(wineType: string): Promise<WineItemLite[]> {
  const { data, error } = await sbPublic
    .from('wine_items')
    .select('id,name,country,region,winery,grape_variety,wine_type,price,supplier_name,vivino_image_url,image_url')
    .eq('wine_type', wineType)
  if (error) throw error
  return (data ?? []) as WineItemLite[]
}

// Picks supplier-only items: skip any wine_item whose normalized name overlaps a stock SKU.
function filterSupplierOnly(stock: SkuBreakdownRow[], supplier: WineItemLite[]): WineItemLite[] {
  const taken = new Set(stock.map(s => normName(s.name)))
  const seen = new Set<string>()
  return supplier.filter(w => {
    const k = normName(w.name)
    if (!k || taken.has(k) || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function stockToItem(s: SkuBreakdownRow, cost: number | null, wi?: WineItemLite): ShelfItem {
  return {
    key:           `stock:${s.sku_id}`,
    name:          s.name,
    qty:           Number(s.on_hand) || 0,
    cost_price:    cost,
    retail_price:  s.default_price != null ? Number(s.default_price) : null,
    source:        'stock',
    supplier_name: null,
    product_code:  s.loyverse_product_code,
    image_url:     wi?.vivino_image_url ?? wi?.image_url ?? null,
    country:       s.wine_country,
    grape_variety: s.grape_variety,
    winery:        wi?.winery ?? null,
  }
}

function supplierToItem(w: WineItemLite): ShelfItem {
  return {
    key:           `wi:${w.id}`,
    name:          w.name,
    qty:           0,
    cost_price:    w.price != null ? Number(w.price) : null,
    retail_price:  null,
    source:        'supplier',
    supplier_name: w.supplier_name,
    product_code:  null,
    image_url:     w.vivino_image_url ?? w.image_url ?? null,
    country:       w.country,
    grape_variety: w.grape_variety,
    winery:        w.winery,
  }
}

// Build a lookup so stock items can borrow vivino_image_url and winery from wine_items
// when names match.
function indexWineItemsByName(items: WineItemLite[]): Map<string, WineItemLite> {
  const m = new Map<string, WineItemLite>()
  for (const w of items) {
    const k = normName(w.name)
    if (k && !m.has(k)) m.set(k, w)
  }
  return m
}

// ── public API ─────────────────────────────────────────────────────────────

export async function getWhiteShelves(): Promise<Shelf[]> {
  const [stock, supplier] = await Promise.all([loadStockSkus('white'), loadWineItems('white')])
  const costMap = await loadCostPrices(stock.map(s => s.sku_id))
  const wineByName = indexWineItemsByName(supplier)
  const supplierOnly = filterSupplierOnly(stock, supplier)

  const groups = new Map<string, ShelfItem[]>()
  const push = (label: string, item: ShelfItem) => {
    const arr = groups.get(label) ?? []; arr.push(item); groups.set(label, arr)
  }

  for (const s of stock) {
    const item = stockToItem(s, costMap.get(s.sku_id) ?? null, wineByName.get(normName(s.name)))
    push(s.grape_variety || 'Other / Blend', item)
  }
  for (const w of supplierOnly) {
    push(w.grape_variety || 'Other / Blend', supplierToItem(w))
  }

  return sortShelves(groups)
}

export async function getRedShelves(): Promise<Shelf[]> {
  const [stock, supplier] = await Promise.all([loadStockSkus('red'), loadWineItems('red')])
  const costMap = await loadCostPrices(stock.map(s => s.sku_id))
  const wineByName = indexWineItemsByName(supplier)
  const supplierOnly = filterSupplierOnly(stock, supplier)

  const groups = new Map<string, ShelfItem[]>()
  const push = (label: string, item: ShelfItem) => {
    const arr = groups.get(label) ?? []; arr.push(item); groups.set(label, arr)
  }

  for (const s of stock) {
    const item = stockToItem(s, costMap.get(s.sku_id) ?? null, wineByName.get(normName(s.name)))
    push(s.wine_country || 'Country unknown', item)
  }
  for (const w of supplierOnly) {
    push(normalizeCountry(w.country) || 'Country unknown', supplierToItem(w))
  }

  return sortShelves(groups)
}

export async function getSparklingShelves(): Promise<Shelf[]> {
  const [stock, supplier] = await Promise.all([loadStockSkus('sparkling'), loadWineItems('sparkling')])
  const costMap = await loadCostPrices(stock.map(s => s.sku_id))
  const wineByName = indexWineItemsByName(supplier)
  const supplierOnly = filterSupplierOnly(stock, supplier)

  const groups = new Map<SparklingType, ShelfItem[]>()
  const push = (type: SparklingType, item: ShelfItem) => {
    const arr = groups.get(type) ?? []; arr.push(item); groups.set(type, arr)
  }

  for (const s of stock) {
    const wi = wineByName.get(normName(s.name))
    const type = classifySparklingType({
      country: s.wine_country,
      region:  wi?.region ?? null,
      winery:  wi?.winery ?? null,
      name:    s.name,
    })
    push(type, stockToItem(s, costMap.get(s.sku_id) ?? null, wi))
  }
  for (const w of supplierOnly) {
    const type = classifySparklingType({
      country: w.country, region: w.region, winery: w.winery, name: w.name,
    })
    push(type, supplierToItem(w))
  }

  return SPARKLING_TYPE_ORDER
    .filter(t => groups.has(t))
    .map(t => ({
      label: SPARKLING_TYPE_LABEL[t],
      items: sortItems(groups.get(t)!),
    }))
}

// ── helpers ────────────────────────────────────────────────────────────────

function sortItems(items: ShelfItem[]): ShelfItem[] {
  return items.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'stock' ? -1 : 1
    if (a.qty !== b.qty) return b.qty - a.qty
    return a.name.localeCompare(b.name)
  })
}

function sortShelves(groups: Map<string, ShelfItem[]>): Shelf[] {
  // Shelves with stock first; within that group, by # of in-stock items desc.
  const arr: Shelf[] = []
  for (const [label, items] of groups) arr.push({ label, items: sortItems(items) })
  return arr.sort((a, b) => {
    const aStock = a.items.filter(i => i.source === 'stock').length
    const bStock = b.items.filter(i => i.source === 'stock').length
    if ((aStock > 0) !== (bStock > 0)) return aStock > 0 ? -1 : 1
    if (aStock !== bStock) return bStock - aStock
    return a.label.localeCompare(b.label)
  })
}

function normalizeCountry(c: string | null): string {
  const v = normToken(c)
  if (!v) return ''
  if (v.startsWith('франц') || v === 'france')           return 'France'
  if (v.startsWith('итал')  || v === 'italy')            return 'Italy'
  if (v.startsWith('испан') || v === 'spain')            return 'Spain'
  if (v.startsWith('португ')|| v === 'portugal')         return 'Portugal'
  if (v.startsWith('аргент')|| v === 'argentina')        return 'Argentina'
  if (v.startsWith('чили')  || v === 'chile')            return 'Chile'
  if (v === 'сша' || v === 'usa' || v === 'united states') return 'USA'
  if (v.startsWith('австрали') || v === 'australia')     return 'Australia'
  if (v.startsWith('новая') || v === 'new zealand')      return 'New Zealand'
  if (v === 'юар' || v === 'south africa')               return 'South Africa'
  if (v.startsWith('герман')|| v === 'germany')          return 'Germany'
  if (v.startsWith('австри')|| v === 'austria')          return 'Austria'
  if (v.startsWith('груз')  || v === 'georgia')          return 'Georgia'
  if (v.startsWith('молдов')|| v === 'moldova')          return 'Moldova'
  if (v.startsWith('грец')  || v === 'greece')           return 'Greece'
  if (v.startsWith('венгр') || v === 'hungary')          return 'Hungary'
  if (v.startsWith('болгар')|| v === 'bulgaria')         return 'Bulgaria'
  return c!.replace(/\b\w/g, ch => ch.toUpperCase())
}
