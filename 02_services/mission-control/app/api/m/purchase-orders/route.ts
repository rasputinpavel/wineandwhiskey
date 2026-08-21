import { NextResponse } from 'next/server'
import { sbPublic } from '@/lib/supabase'
import { isPoStatus, PO_STATUSES } from '@/lib/po/status'

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
