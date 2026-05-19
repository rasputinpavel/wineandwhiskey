import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// POST: create a delivery note + lines for a consignment customer.
// Body: { issued_at: 'YYYY-MM-DD', number?: 'DN-2026-NNN' (auto if missing),
//         lines: [{ sku_id, qty, unit_price? }, ...] }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params
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

  // Find consignment_location for this customer.
  const { data: loc, error: locErr } = await sbInventory
    .from('consignment_location')
    .select('id')
    .eq('customer_id', customerId)
    .maybeSingle()
  if (locErr) return NextResponse.json({ error: locErr.message }, { status: 500 })
  if (!loc) {
    return NextResponse.json({ error: 'no consignment location for this customer — toggle Consignment first' }, { status: 400 })
  }

  // Auto-number if not provided: DN-YYYY-NNN, NNN = next per year.
  const year = issued_at.slice(0, 4)
  let finalNumber = number?.trim() || ''
  if (!finalNumber) {
    const { data: existing } = await sbInventory
      .from('delivery_note')
      .select('number')
      .like('number', `DN-${year}-%`)
    const max = (existing ?? []).reduce((m, r: any) => {
      const n = Number((r.number as string).split('-').pop())
      return Number.isFinite(n) && n > m ? n : m
    }, 0)
    finalNumber = `DN-${year}-${String(max + 1).padStart(3, '0')}`
  }

  // Insert header.
  const { data: note, error: noteErr } = await sbInventory
    .from('delivery_note')
    .insert({
      location_id: loc.id,
      number: finalNumber,
      issued_at,
      status: status ?? 'issued',
      with_vat: with_vat ?? true,
      created_by: 'mission-control',
    })
    .select('id, number')
    .single()
  if (noteErr) return NextResponse.json({ error: noteErr.message }, { status: 500 })

  // Insert lines.
  const linesPayload = lines
    .filter(l => l.sku_id && Number(l.qty) > 0)
    .map(l => ({
      note_id: note!.id,
      sku_id: l.sku_id,
      qty: Number(l.qty),
      unit_price: l.unit_price === undefined || l.unit_price === null ? null : Number(l.unit_price),
    }))

  if (linesPayload.length === 0) {
    // Roll back the empty header.
    await sbInventory.from('delivery_note').delete().eq('id', note!.id)
    return NextResponse.json({ error: 'no valid lines (need sku_id + qty > 0)' }, { status: 400 })
  }

  const { error: lineErr } = await sbInventory
    .from('delivery_note_line')
    .insert(linesPayload)
  if (lineErr) {
    await sbInventory.from('delivery_note').delete().eq('id', note!.id)
    return NextResponse.json({ error: lineErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: note!.id, number: note!.number })
}
