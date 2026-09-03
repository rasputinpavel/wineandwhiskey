import { NextResponse } from 'next/server'
import { sbPublic } from '@/lib/supabase'
import { isPoStatus, PO_STATUSES } from '@/lib/po/status'
import { deleteScanObject } from '@/lib/po/scans'

// Edit a PO scan row from the portal. The bot captures these fields at upload
// time from the scan; managers correct them here (OCR slips, Buddhist-Era dates
// the bot missed, a wrong total). Send { id, ...fields } — only whitelisted
// fields are applied. `note` alone is the common case (inline NoteCell).
const TEXT_FIELDS = ['supplier', 'doc_number', 'note', 'loyverse_po'] as const
const DATE_FIELDS = ['order_date', 'received_date'] as const

export async function PATCH(req: Request) {
  const body = await req.json()
  const { id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, string | number | null> = {}

  for (const f of TEXT_FIELDS) {
    if (!(f in body)) continue
    const v = body[f]
    if (!(typeof v === 'string' || v === null)) {
      return NextResponse.json({ error: `${f} must be a string or null` }, { status: 400 })
    }
    const trimmed = typeof v === 'string' ? v.trim() : v
    patch[f] = trimmed === '' ? null : trimmed
  }

  for (const f of DATE_FIELDS) {
    if (!(f in body)) continue
    const v = body[f]
    if (v === null || v === '') { patch[f] = null; continue }
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return NextResponse.json({ error: `${f} must be YYYY-MM-DD or null` }, { status: 400 })
    }
    patch[f] = v
  }

  if ('amount_total' in body) {
    const v = body.amount_total
    if (v === null || v === '') {
      patch.amount_total = null
    } else {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: 'amount_total must be a non-negative number or null' }, { status: 400 })
      }
      patch.amount_total = n
    }
  }

  if ('status' in body) {
    if (!isPoStatus(body.status)) {
      return NextResponse.json({ error: `status must be one of: ${PO_STATUSES.join(', ')}` }, { status: 400 })
    }
    patch.status = body.status
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no editable fields provided' }, { status: 400 })
  }

  const { error } = await sbPublic
    .from('po_scans')
    .update(patch)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/m/purchase-orders?id=<id> — drop a scan archived by mistake: the
// same invoice photographed twice (OCR reads the № differently, so the bot's
// doc_number dedupe misses it), or a photo of the wrong document. Hard delete —
// this table is the store's own copy of the paper PO, not an accounting record;
// the original still goes to bookkeeping.
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: row, error: readErr } = await sbPublic
    .from('po_scans')
    .select('scan_path')
    .eq('id', id)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { error } = await sbPublic.from('po_scans').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Take the scan file with the row — but only if no other row points at it.
  // The bot's overwrite path re-points every row with the same doc_number at
  // one object, so a shared path is real, not theoretical.
  if (row.scan_path) {
    const { data: others } = await sbPublic
      .from('po_scans')
      .select('id')
      .eq('scan_path', row.scan_path)
      .limit(1)
    if (!others?.length) await deleteScanObject(row.scan_path)
  }

  return NextResponse.json({ ok: true })
}
