import { NextResponse } from 'next/server'
import { sbInventory, sbPublic, type PurchaseOrder, type Supplier, type FlowInvoice } from '@/lib/supabase'
import { computeDueDate, todayBkk, daysBetween } from '@/lib/kpi'

// Open payables (кредиторка / PO) + receivables (дебиторка / B2B-инвойсы) for the
// "Чип и Дейл" Telegram bot morning briefing. Mirrors the Payment Calendar's OUT/IN
// logic 1:1 so the bot and the calendar never disagree — payables drop off the moment
// a PO is marked paid (paid_at) in the portal.
//
// Lives under /api/public/ so middleware skips the cookie check (the bot has no
// session) — guarded instead by a bearer secret (PAYABLES_ALERT_SECRET).

export const dynamic = 'force-dynamic'

type AlertItem = { name: string; date: string; amount: number; daysUntil: number }

const PO_COLS = 'id,po_number,order_date,supplier,total_thb,status,cashflow_override,paid_at'

export async function GET(req: Request) {
  const secret = process.env.PAYABLES_ALERT_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'payables-alerts not configured' }, { status: 503 })
  }
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.headers.get('x-api-key') ?? ''
  if (token !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const today = todayBkk()

  // ── OUT: PO (кредиторка) ───────────────────────────────────────────────
  const { data: openPoData, error: poErr } = await sbPublic
    .from('purchase_orders').select(PO_COLS)
    .is('paid_at', null)
    .order('order_date', { ascending: true })
  if (poErr) return NextResponse.json({ error: poErr.message }, { status: 500 })

  const { data: supRows, error: supErr } = await sbInventory
    .from('supplier').select('name,type,payment_terms_days')
  if (supErr) return NextResponse.json({ error: supErr.message }, { status: 500 })
  const supByName = new Map<string, { type: Supplier['type']; terms: number }>()
  for (const s of (supRows ?? []) as Supplier[]) {
    supByName.set(s.name.trim().toLowerCase(), { type: s.type, terms: s.payment_terms_days ?? 0 })
  }
  const supType  = (n: string | null): Supplier['type'] => supByName.get((n ?? '').trim().toLowerCase())?.type ?? 'regular'
  const supTerms = (n: string | null): number          => supByName.get((n ?? '').trim().toLowerCase())?.terms ?? 0

  // Консигнация + force-exclude PO платятся не обычным инвойсом — наружу.
  // force-include (напр. точечная консигнация у обычного поставщика: pending-PO
  // как счёт к оплате) — внутрь. Обычные PO берём в любом статусе, включая
  // pending: статус — состояние приёмки склада, а не признак платежа; лишнее
  // снимается вручную force-exclude. Симметрично Payment Calendar, чтобы бот и
  // календарь не разошлись.
  function poEligible(p: PurchaseOrder): boolean {
    if (p.cashflow_override === 'exclude') return false
    if (!p.order_date) return false
    if (p.cashflow_override === 'include') return true
    if (supType(p.supplier) === 'consignment') return false
    return true
  }

  const payables: AlertItem[] = []
  for (const p of (openPoData ?? []) as PurchaseOrder[]) {
    if (!poEligible(p)) continue
    const date = computeDueDate(p.order_date!, supTerms(p.supplier))
    payables.push({
      name: p.supplier ?? '—', date, amount: Number(p.total_thb ?? 0),
      daysUntil: daysBetween(date, today),
    })
  }

  // ── IN: B2B-инвойсы (дебиторка) ────────────────────────────────────────
  const [{ data: invData, error: invErr }, { data: custData, error: custErr }] = await Promise.all([
    sbInventory
      .from('flowaccount_invoice')
      .select('id, number, customer_id, customer_name, issued_at, due_at, status, total, excluded')
      .not('status', 'in', '(Paid,Cancelled)')
      .eq('excluded', false)
      .limit(500),
    sbInventory.from('b2b_customer').select('id, payment_terms_days'),
  ])
  if (invErr)  return NextResponse.json({ error: invErr.message }, { status: 500 })
  if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 })

  const custTerms = new Map<string, number>()
  for (const c of (custData ?? []) as { id: string; payment_terms_days: number }[]) {
    custTerms.set(c.id, c.payment_terms_days ?? 0)
  }
  // due_at из FA часто = '' (не null) → || ловит оба случая.
  function invoiceDue(inv: FlowInvoice): string | null {
    const terms = inv.customer_id ? (custTerms.get(inv.customer_id) ?? 0) : 0
    return (inv.due_at || (terms > 0 ? computeDueDate(inv.issued_at, terms) : null)) || null
  }

  const receivables: AlertItem[] = []
  for (const inv of (invData ?? []) as FlowInvoice[]) {
    const date = invoiceDue(inv)
    if (!date) continue   // нет вычислимой даты — пропускаем (как inNoDate в календаре)
    receivables.push({
      name: inv.customer_name, date, amount: Number(inv.total ?? 0),
      daysUntil: daysBetween(date, today),
    })
  }

  return NextResponse.json({ today, receivables, payables })
}
