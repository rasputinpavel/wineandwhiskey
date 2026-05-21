// GET /api/m/reactivation/banner?customerId=<id>
//
// Returns the seasonal banner with the customer's favourite bottle
// composited into the spotlight. Falls back to the empty base banner when:
//   - no customer matches the id in the current window
//   - the customer has no top product in stock
//   - the matched product has no PNG on disk (low coverage today —
//     we're filling in 04_brand/products/ over time)

import { NextResponse } from 'next/server'
import { loadReactivationCustomers } from '@/lib/reactivation/data'
import {
  compositeBannerWithBottle,
  findBottlePngForProductName,
  readBaseBanner,
} from '@/lib/reactivation/composite'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const customerId = url.searchParams.get('customerId') ?? ''
  if (!customerId) {
    return NextResponse.json({ error: 'customerId required' }, { status: 400 })
  }

  try {
    const customers = await loadReactivationCustomers({ windowDays: 365 })
    const customer = customers.find(c => c.customerId === customerId)
    if (!customer) {
      return NextResponse.json({ error: 'customer not found in window' }, { status: 404 })
    }

    const inStockFav = customer.topProducts.find(p => p.inStock === true)
    let png: Buffer
    let source: 'composite' | 'base-no-product' | 'base-no-png'

    if (!inStockFav) {
      png = await readBaseBanner()
      source = 'base-no-product'
    } else {
      const bottlePath = await findBottlePngForProductName(inStockFav.name)
      if (!bottlePath) {
        png = await readBaseBanner()
        source = 'base-no-png'
      } else {
        png = await compositeBannerWithBottle(bottlePath)
        source = 'composite'
      }
    }

    return new NextResponse(png as any, {
      headers: {
        'Content-Type': 'image/png',
        // Composite is deterministic per (banner, bottle) — let the browser
        // cache for an hour. Bottles going out of stock invalidate naturally
        // on next page load (server fetches fresh `inStock`).
        'Cache-Control': 'public, max-age=3600',
        'X-Reactivation-Source': source,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
