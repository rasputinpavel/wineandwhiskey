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

  // When awaiting review, resolve the open catalog_update so the upload-screen
  // poller can jump straight to the diff instead of spinning forever.
  let review_update_id: string | null = null
  if (data?.status === 'review') {
    const { data: cu } = await supabase
      .from('catalog_updates').select('id')
      .eq('new_price_list_id', id).eq('status', 'pending_review')
      .maybeSingle()
    review_update_id = cu?.id ?? null
  }
  return NextResponse.json({ ...data, review_update_id })
}

// Edit the catalog's effective date ("valid as of"), which drives current/expired.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}
  if ('date' in body) patch.date = body.date || null
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('price_lists').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
