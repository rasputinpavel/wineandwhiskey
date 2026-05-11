import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// GET /api/m/loyverse-customers?q=...
// Возвращает до 30 Loyverse-клиентов с именем, содержащим q (ILIKE).
// Используется в CustomerLoyverseCell для linking b2b_customer.loyverse_customer_id.

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  let query = sbInventory
    .from('loyverse_customer')
    .select('id, name, total_spent')
    .order('name')
    .limit(30)
  if (q) query = query.ilike('name', `%${q}%`)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}
