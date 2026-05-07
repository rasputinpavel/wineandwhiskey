import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20)))
  if (q.length < 2) return NextResponse.json({ items: [] })

  // ILIKE on either name or product code; PostgREST `or` syntax escapes commas
  // by wrapping the value, but we keep it simple with two fallback queries
  // joined client-side.
  const pattern = `%${q.replace(/[%_]/g, m => `\\${m}`)}%`
  const { data, error } = await sbInventory
    .from('sku')
    .select('id, name, loyverse_product_code, category')
    .or(`name.ilike.${pattern},loyverse_product_code.ilike.${pattern}`)
    .order('name')
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}
