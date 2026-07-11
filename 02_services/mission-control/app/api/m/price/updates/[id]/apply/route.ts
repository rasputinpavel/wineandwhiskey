import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/price/supabase'
import { matchKey } from '@/lib/price/reconcile'
import type { CatalogDiff, DiffChange } from '@/lib/price/reconcile'
import type { ExtractedItem } from '@/lib/price/claude'

type Decision = { accept: boolean; bindTo?: string | 'new' }

// Fields to copy from a parsed item onto a wine_items row.
function itemFields(inc: ExtractedItem) {
  return {
    name: inc.name, country: inc.country, region: inc.region,
    grape_variety: inc.grape_variety, price: inc.price, year: inc.year,
    volume: inc.volume, description: inc.description, category: inc.category,
    wine_type: inc.wine_type, spirit_type: inc.spirit_type ?? null,
    match_key: matchKey(inc.name, inc.volume),
  }
}

// Reset Vivino enrichment when identity (name/year) changed so the tick job re-runs.
function vivinoResetIfIdentityChanged(existingName: string, existingYear: number | null, inc: ExtractedItem) {
  if (existingName !== inc.name || (existingYear ?? null) !== (inc.year ?? null))
    return { vivino_enriched_at: null, vivino_failed_at: null }
  return {}
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { decisions } = (await req.json()) as { decisions: Record<number, Decision> }

  const { data: cu, error } = await supabase
    .from('catalog_updates').select('*').eq('id', id).single()
  if (error || !cu) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (cu.status !== 'pending_review')
    return NextResponse.json({ error: `already ${cu.status}` }, { status: 409 })

  const diff = cu.diff as CatalogDiff
  const plId = cu.new_price_list_id as string
  const supplierId = cu.supplier_id as string | null

  let applied = 0
  for (let i = 0; i < diff.changes.length; i++) {
    const c = diff.changes[i]
    const d = decisions[i]
    if (!d?.accept) continue
    const inc = c.incoming

    if (c.kind === 'added' && inc) {
      await supabase.from('wine_items').insert({
        ...itemFields(inc), price_list_id: plId, supplier_id: supplierId,
        supplier_name: diff.supplier_name, status: 'active',
      })
      applied++
    } else if ((c.kind === 'price_changed' || c.kind === 'updated') && inc && c.existing_id) {
      await supabase.from('wine_items').update({
        ...itemFields(inc), price_list_id: plId,
        ...vivinoResetIfIdentityChanged(c.existing_name ?? '', null, inc),
      }).eq('id', c.existing_id)
      applied++
    } else if (c.kind === 'reactivated' && inc && c.existing_id) {
      await supabase.from('wine_items').update({
        ...itemFields(inc), price_list_id: plId, status: 'active', discontinued_at: null,
      }).eq('id', c.existing_id)
      applied++
    } else if (c.kind === 'discontinued' && c.existing_id) {
      await supabase.from('wine_items')
        .update({ status: 'discontinued', discontinued_at: new Date().toISOString() })
        .eq('id', c.existing_id)
      applied++
    } else if (c.kind === 'ambiguous' && inc) {
      if (d.bindTo && d.bindTo !== 'new') {
        await supabase.from('wine_items').update({
          ...itemFields(inc), price_list_id: plId, status: 'active', discontinued_at: null,
        }).eq('id', d.bindTo)
      } else {
        await supabase.from('wine_items').insert({
          ...itemFields(inc), price_list_id: plId, supplier_id: supplierId,
          supplier_name: diff.supplier_name, status: 'active',
        })
      }
      applied++
    }
  }

  await supabase.from('catalog_updates')
    .update({ status: 'applied', applied_at: new Date().toISOString() }).eq('id', id)
  await supabase.from('price_lists')
    .update({ status: 'done', progress: 100, progress_phase: null }).eq('id', plId)

  return NextResponse.json({ ok: true, applied })
}
