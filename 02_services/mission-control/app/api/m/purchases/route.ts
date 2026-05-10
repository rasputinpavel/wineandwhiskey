import { NextResponse } from 'next/server'
import { sbPublic } from '@/lib/supabase'

// PATCH /api/m/purchases — обновить поля одного PO.
// Body: { id: number, cashflow_override?, paid_at?, docs_url? }
//   cashflow_override: 'auto' | 'include' | 'exclude'
//   paid_at: ISO 'YYYY-MM-DD' | null  (null = снять отметку оплаты)
//   docs_url: string | null

const VALID_OVERRIDES = new Set(['auto', 'include', 'exclude'])

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { id, cashflow_override, paid_at, docs_url } = body
  if (typeof id !== 'number') {
    return NextResponse.json({ error: 'id (number) required' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}

  if (cashflow_override !== undefined) {
    if (!VALID_OVERRIDES.has(cashflow_override)) {
      return NextResponse.json({ error: `cashflow_override must be one of ${[...VALID_OVERRIDES].join(', ')}` }, { status: 400 })
    }
    patch.cashflow_override = cashflow_override
  }

  if (paid_at !== undefined) {
    if (paid_at === null) {
      patch.paid_at = null
    } else if (typeof paid_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(paid_at)) {
      patch.paid_at = paid_at
    } else {
      return NextResponse.json({ error: 'paid_at must be ISO YYYY-MM-DD or null' }, { status: 400 })
    }
  }

  if (docs_url !== undefined) {
    if (docs_url === null || docs_url === '') {
      patch.docs_url = null
    } else if (typeof docs_url === 'string') {
      try { new URL(docs_url) } catch { return NextResponse.json({ error: 'docs_url must be a valid URL' }, { status: 400 }) }
      patch.docs_url = docs_url
    } else {
      return NextResponse.json({ error: 'docs_url must be string or null' }, { status: 400 })
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }

  const { error } = await sbPublic
    .from('purchase_orders')
    .update(patch)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
