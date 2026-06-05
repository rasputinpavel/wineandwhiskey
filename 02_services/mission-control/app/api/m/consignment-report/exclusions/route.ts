import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// Per-period receipt exclusions for a consignment supplier's monthly report.
//
//   GET    ?supplier_id=&period=                       → { items: string[] }
//   POST   { supplier_id, period, receipt_number }     → add (receipt_number may
//                                                         be comma/space-separated)
//   DELETE ?supplier_id=&period=&receipt_number=       → remove one

const TABLE = 'consignment_report_exclusion'

function parseNumbers(input: unknown): string[] {
  if (typeof input !== 'string') return []
  return [...new Set(input.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean))]
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const supplier_id = url.searchParams.get('supplier_id')
  const period = url.searchParams.get('period')
  if (!supplier_id || !period) return NextResponse.json({ error: 'supplier_id and period required' }, { status: 400 })

  const { data, error } = await sbInventory
    .from(TABLE).select('receipt_number')
    .eq('supplier_id', supplier_id).eq('period', period)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: (data ?? []).map((r: { receipt_number: string }) => r.receipt_number) })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { supplier_id, period } = body
  if (typeof supplier_id !== 'string' || !supplier_id) return NextResponse.json({ error: 'supplier_id required' }, { status: 400 })
  if (typeof period !== 'string' || !/^\d{4}-\d{2}$/.test(period)) return NextResponse.json({ error: 'period YYYY-MM required' }, { status: 400 })
  const numbers = parseNumbers(body.receipt_number)
  if (numbers.length === 0) return NextResponse.json({ error: 'receipt_number required' }, { status: 400 })

  const rows = numbers.map(n => ({ supplier_id, period, receipt_number: n }))
  const { error } = await sbInventory
    .from(TABLE).upsert(rows, { onConflict: 'supplier_id,period,receipt_number', ignoreDuplicates: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, added: numbers.length })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const supplier_id = url.searchParams.get('supplier_id')
  const period = url.searchParams.get('period')
  const receipt_number = url.searchParams.get('receipt_number')
  if (!supplier_id || !period || !receipt_number) return NextResponse.json({ error: 'supplier_id, period, receipt_number required' }, { status: 400 })

  const { error } = await sbInventory
    .from(TABLE).delete()
    .eq('supplier_id', supplier_id).eq('period', period).eq('receipt_number', receipt_number)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
