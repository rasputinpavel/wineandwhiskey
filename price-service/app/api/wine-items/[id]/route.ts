import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

type Params = { params: Promise<{ id: string }> }

const ALLOWED_FIELDS = [
  'name', 'country', 'region', 'grape_variety', 'price', 'year', 'volume',
  'description', 'winery', 'category', 'wine_type', 'image_url',
]

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  const update: Record<string, unknown> = {}
  for (const key of ALLOWED_FIELDS) {
    if (key in body) update[key] = body[key] === '' ? null : body[key]
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  }
  const { data, error } = await supabase.from('wine_items').update(update).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const { error } = await supabase.from('wine_items').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
