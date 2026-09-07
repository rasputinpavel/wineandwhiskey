import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { sbInventory } from '@/lib/supabase'
import { isB2BCustomerName } from '@/lib/b2b'
import { RECEIPTS_CACHE_TAG } from '@/lib/receipts-cache'

// Manual B2B attribution of a Loyverse receipt (migration 046).
//
// A B2B sale rung up without picking the customer card and paid by cash/card/QR
// carries neither signal the classifier looks at, so it lands in retail and
// belongs to nobody. Loyverse won't let the receipt be corrected after the fact —
// this is where the correction lives instead.

// GET /api/m/receipts?q=5-9217 — search receipts by number, for the attach picker.
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (!q) return NextResponse.json({ items: [] })
  const { data, error } = await sbInventory
    .from('loyverse_receipt')
    .select('receipt_number, receipt_date, receipt_type, total, payment_method, is_b2b, b2b_manual, customer_name, b2b_customer_id')
    .ilike('receipt_number', `%${q}%`)
    .order('receipt_date', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

// PATCH /api/m/receipts — { receipt_number, b2b_customer_id }
//   uuid → mark B2B and attribute to that customer, flagged as a human decision.
//   null → drop the human decision and hand the receipt back to the classifier.
export async function PATCH(req: Request) {
  const { receipt_number, b2b_customer_id } = await req.json()
  if (typeof receipt_number !== 'string' || !receipt_number) {
    return NextResponse.json({ error: 'receipt_number required' }, { status: 400 })
  }
  if (b2b_customer_id !== null && typeof b2b_customer_id !== 'string') {
    return NextResponse.json({ error: 'b2b_customer_id must be a uuid or null' }, { status: 400 })
  }

  const { data: receipt, error: rErr } = await sbInventory
    .from('loyverse_receipt')
    .select('receipt_number, customer_id, is_bank_transfer')
    .eq('receipt_number', receipt_number)
    .maybeSingle()
  if (rErr)     return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!receipt) return NextResponse.json({ error: `receipt ${receipt_number} not found` }, { status: 404 })

  let patch: Record<string, unknown>
  if (b2b_customer_id) {
    const { data: cust, error: cErr } = await sbInventory
      .from('b2b_customer')
      .select('id, flowaccount_name')
      .eq('id', b2b_customer_id)
      .maybeSingle()
    if (cErr)  return NextResponse.json({ error: cErr.message }, { status: 500 })
    if (!cust) return NextResponse.json({ error: 'b2b_customer_id not found' }, { status: 400 })
    // customer_name carries the attribution so the sale reads as this client
    // everywhere a receipt shows a customer (supplier sales report, SKU history).
    // The sync leaves it alone while b2b_manual is true.
    patch = {
      is_b2b: true,
      b2b_manual: true,
      b2b_customer_id: cust.id,
      customer_name: cust.flowaccount_name,
    }
  } else {
    // Detaching restores exactly what the next sync would derive, so the row is
    // not left holding a half-manual state until that run happens.
    const lvName = receipt.customer_id
      ? (await sbInventory.from('loyverse_customer').select('name').eq('id', receipt.customer_id).maybeSingle()).data?.name ?? null
      : null
    patch = {
      is_b2b: !!receipt.is_bank_transfer || (!!lvName && isB2BCustomerName(lvName)),
      b2b_manual: false,
      b2b_customer_id: null,
      customer_name: lvName,
    }
  }

  const { error } = await sbInventory
    .from('loyverse_receipt')
    .update(patch)
    .eq('receipt_number', receipt_number)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Dashboard/Pulse/Income/Rolling all read the cached receipt history — without
  // this the retail/B2B split stays stale for up to 10 minutes.
  revalidateTag(RECEIPTS_CACHE_TAG)
  return NextResponse.json({ ok: true })
}
