// Thin wrapper around the Loyverse REST API. Used today only by the Inventory
// module's SKU detail page to pull recent B2C sales for one variant.
//
// Loyverse REST does NOT support filtering /receipts by variant_id (the param
// is ignored), so for "sales of one SKU" we have to scan every receipt in the
// time window and filter line_items in memory. This is why we cap to 90 days
// in the UI — long windows would mean dozens of paginated requests.

const BASE = 'https://api.loyverse.com/v1.0'

type ReceiptsPage = { receipts: Receipt[]; cursor?: string }

export type ReceiptLine = {
  variant_id: string
  item_id: string
  item_name: string
  quantity: number
  price: number
  total_money: number
  total_discount?: number
}

export type Receipt = {
  receipt_number: string
  receipt_type: 'SALE' | 'REFUND' | string
  receipt_date: string
  customer_id: string | null
  total_money: number
  line_items: ReceiptLine[]
}

async function getJson<T>(path: string): Promise<T> {
  const token = process.env.LOYVERSE_API_TOKEN
  if (!token) throw new Error('LOYVERSE_API_TOKEN not set')
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    // Cache for 5 min — Loyverse data is eventually consistent and the SKU
    // page is a drill-down, not a live ticker.
    next: { revalidate: 300 },
  })
  if (!res.ok) throw new Error(`Loyverse ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export type SkuB2cSalesWindow = {
  windowDays: number
  fromISO: string
  totalQty: number
  totalRevenue: number
  receiptsCount: number
  recent: Array<{ date: string; qty: number; total: number; receiptNumber: string }>
}

// Pull all SALE receipts in the window, filter line_items by variant_id,
// return aggregates + the most recent N sales of this SKU.
export async function fetchSkuB2cSalesWindow(
  variantId: string,
  windowDays = 90,
  recentLimit = 10,
): Promise<SkuB2cSalesWindow> {
  const fromISO = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()

  let totalQty = 0
  let totalRevenue = 0
  let receiptsCount = 0
  const recent: SkuB2cSalesWindow['recent'] = []

  let cursor: string | undefined
  // Hard cap on pages just in case Loyverse returns endless pages.
  for (let page = 0; page < 30; page++) {
    const qs = new URLSearchParams({
      created_at_min: fromISO,
      limit: '250',
    })
    if (cursor) qs.set('cursor', cursor)
    const data = await getJson<ReceiptsPage>(`/receipts?${qs.toString()}`)

    for (const r of data.receipts) {
      const sign = r.receipt_type === 'REFUND' ? -1 : 1
      let receiptHasSku = false
      for (const li of r.line_items) {
        if (li.variant_id !== variantId) continue
        receiptHasSku = true
        const qty = sign * Number(li.quantity || 0)
        const rev = sign * Number(li.total_money || 0)
        totalQty += qty
        totalRevenue += rev
        recent.push({
          date: r.receipt_date,
          qty,
          total: rev,
          receiptNumber: r.receipt_number,
        })
      }
      if (receiptHasSku) receiptsCount++
    }

    if (!data.cursor) break
    cursor = data.cursor
  }

  recent.sort((a, b) => b.date.localeCompare(a.date))
  return {
    windowDays,
    fromISO,
    totalQty,
    totalRevenue,
    receiptsCount,
    recent: recent.slice(0, recentLimit),
  }
}
