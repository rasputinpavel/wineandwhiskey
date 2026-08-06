import { NextResponse } from 'next/server'
import { sbPublic } from '@/lib/supabase'

// Edit a PO scan's free-text note (e.g. "invoice disputed"). The only editable
// field — everything else is captured by the bot at upload time.
export async function PATCH(req: Request) {
  const { id, note } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (!(typeof note === 'string' || note === null)) {
    return NextResponse.json({ error: 'note must be a string or null' }, { status: 400 })
  }

  const { error } = await sbPublic
    .from('po_scans')
    .update({ note })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
