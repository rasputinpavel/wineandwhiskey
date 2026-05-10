import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/price/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q = searchParams.get('q') ?? ''
  const supplier = searchParams.get('supplier') ?? ''
  const country = searchParams.get('country') ?? ''
  const grape = searchParams.get('grape') ?? ''
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = 50
  const offset = (page - 1) * limit

  let query = supabase
    .from('wine_items')
    .select('*', { count: 'exact' })
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1)

  if (q) query = query.ilike('name', `%${q}%`)
  if (supplier) query = query.eq('supplier_name', supplier)
  if (country) query = query.eq('country', country)
  if (grape) query = query.ilike('grape_variety', `%${grape}%`)

  const { data, error, count } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data, total: count ?? 0, page, limit })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const { data, error } = await supabase.from('wine_items').insert({
    name: body.name,
    country: body.country ?? null,
    region: body.region ?? null,
    grape_variety: body.grape_variety ?? null,
    price: body.price ?? null,
    year: body.year ?? null,
    volume: body.volume ?? null,
    description: body.description ?? null,
    winery: body.winery ?? null,
    category: body.category ?? null,
    wine_type: body.wine_type ?? null,
    supplier_name: body.supplier_name ?? null,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
