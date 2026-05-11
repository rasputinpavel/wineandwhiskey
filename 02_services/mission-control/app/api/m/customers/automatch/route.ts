import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'
import { scoreCandidates, decideMatch, type AutoMatchResult } from '@/lib/customer_match'

// POST /api/m/customers/automatch
// Body: { dryRun?: boolean }
//   dryRun=true → ничего не пишет, только возвращает proposals
//   default (false) → авто-линкует уверенные совпадения (score ≥ 0.7 + gap к
//                     #2 ≥ 0.15), возвращает applied count + ambiguous остаток
//
// Только для b2b_customer.loyverse_customer_id IS NULL — уже привязанных не трогаем.

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const dryRun = body?.dryRun === true

  const { data: cust, error: cErr } = await sbInventory
    .from('b2b_customer')
    .select('id, flowaccount_name, loyverse_customer_id')
    .is('loyverse_customer_id', null)
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  const { data: lv, error: lErr } = await sbInventory
    .from('loyverse_customer')
    .select('id, name')
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })

  const unlinkedB2b = (cust ?? []) as { id: string; flowaccount_name: string }[]
  const allLv = (lv ?? []) as { id: string; name: string }[]

  const results: AutoMatchResult[] = []
  for (const b of unlinkedB2b) {
    const candidates = scoreCandidates(b.flowaccount_name, allLv)
    results.push(decideMatch(b.id, b.flowaccount_name, candidates))
  }

  const toApply = results.filter(r => r.applied !== null)
  let appliedCount = 0
  if (!dryRun) {
    // Многие FA-customer'ы могут указать на один и тот же LV (бранчи). Это OK
    // — пользователь потом разрулит руками если надо. Просто PATCH'им параллельно.
    const updates = toApply.map(r =>
      sbInventory.from('b2b_customer')
        .update({ loyverse_customer_id: r.applied!.lvId, updated_at: new Date().toISOString() })
        .eq('id', r.b2bId)
    )
    const settled = await Promise.allSettled(updates)
    appliedCount = settled.filter(s => s.status === 'fulfilled').length
  }

  const ambiguous = results
    .filter(r => r.applied === null && r.suggestions.length > 0)
    .map(r => ({ b2bId: r.b2bId, b2bName: r.b2bName, top3: r.suggestions }))

  const noMatch = results
    .filter(r => r.applied === null && r.suggestions.length === 0)
    .map(r => ({ b2bId: r.b2bId, b2bName: r.b2bName }))

  return NextResponse.json({
    ok: true,
    dryRun,
    totalUnlinked: unlinkedB2b.length,
    toApplyCount: toApply.length,
    appliedCount,
    ambiguous,
    noMatch,
  })
}
