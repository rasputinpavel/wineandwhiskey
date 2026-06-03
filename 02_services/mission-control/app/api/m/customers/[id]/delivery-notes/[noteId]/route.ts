import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// PUT: edit an existing delivery note. Updates the header and fully replaces
// its lines. Body: same shape as POST — { issued_at, number?, status?,
// with_vat?, lines: [{ sku_id, qty, unit_price? }, ...] }.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const { noteId } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  const { issued_at, number, lines, status, with_vat } = body as {
    issued_at?: string
    number?: string
    status?: 'draft' | 'issued' | 'delivered'
    with_vat?: boolean
    lines?: Array<{ sku_id: string; qty: number; unit_price?: number | null }>
  }

  if (!issued_at) return NextResponse.json({ error: 'issued_at required' }, { status: 400 })
  if (!Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: 'at least one line required' }, { status: 400 })
  }

  // Build the line payload first and bail before touching the DB if empty —
  // this avoids wiping existing lines on an invalid edit.
  const linesPayload = lines
    .filter(l => l.sku_id && Number(l.qty) > 0)
    .map(l => ({
      note_id: noteId,
      sku_id: l.sku_id,
      qty: Number(l.qty),
      unit_price: l.unit_price === undefined || l.unit_price === null ? null : Number(l.unit_price),
    }))
  if (linesPayload.length === 0) {
    return NextResponse.json({ error: 'no valid lines (need sku_id + qty > 0)' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { issued_at, with_vat: with_vat ?? true }
  if (number?.trim()) patch.number = number.trim()
  if (status) patch.status = status

  const { error: updErr } = await sbInventory
    .from('delivery_note')
    .update(patch)
    .eq('id', noteId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // Replace lines: drop the old set, insert the new.
  const { error: delErr } = await sbInventory
    .from('delivery_note_line')
    .delete()
    .eq('note_id', noteId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  const { error: insErr } = await sbInventory
    .from('delivery_note_line')
    .insert(linesPayload)
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, id: noteId })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const { noteId } = await params
  // Cascade-deletes the lines via FK ON DELETE CASCADE.
  const { error } = await sbInventory
    .from('delivery_note')
    .delete()
    .eq('id', noteId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
