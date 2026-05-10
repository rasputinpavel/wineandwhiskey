import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/price/supabase'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data, error } = await supabase
    .from('price_lists')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Get pdf_url to delete from storage
  const { data: pl } = await supabase
    .from('price_lists')
    .select('pdf_url')
    .eq('id', id)
    .single()

  if (pl?.pdf_url) {
    const path = pl.pdf_url.split('/price-pdfs/')[1]
    if (path) await supabase.storage.from('price-pdfs').remove([path])
  }

  // wine_items cascade on delete
  const { error } = await supabase.from('price_lists').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
