import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/price/supabase'
import { matchKey } from '@/lib/price/reconcile'
import { catalogFreshness } from '@/lib/price/freshness'

// Price history for one item across the SAME supplier's catalogs. The same wine
// is matched across catalogs by normalized name|volume (year-agnostic), then
// ordered by catalog date so you can see how its price moved version to version.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: item } = await supabase
    .from('wine_items').select('id,name,volume,supplier_id').eq('id', id).single()
  if (!item || !item.supplier_id) return NextResponse.json([])

  const key = matchKey(item.name, item.volume)
  const { data: siblings } = await supabase
    .from('wine_items').select('id,name,volume,price,price_list_id').eq('supplier_id', item.supplier_id)
  const matched = (siblings ?? []).filter(s => matchKey(s.name, s.volume) === key)
  if (matched.length <= 1) return NextResponse.json([])

  const plIds = [...new Set(matched.map(m => m.price_list_id))]
  const { data: pls } = await supabase
    .from('price_lists').select('id,date,uploaded_at').in('id', plIds)
  const plMap = new Map((pls ?? []).map(p => [p.id, p]))
  const { statusById } = await catalogFreshness()

  const rows = matched.map(s => {
    const pl = plMap.get(s.price_list_id)
    return {
      price_list_id: s.price_list_id,
      price: s.price,
      date: pl?.date ?? null,
      sortKey: new Date(pl?.date ?? pl?.uploaded_at ?? 0).getTime(),
      catalog_status: statusById.get(s.price_list_id) ?? null,
      is_self: s.id === id,
    }
  })
  rows.sort((a, b) => a.sortKey - b.sortKey)
  return NextResponse.json(rows)
}
