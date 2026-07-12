import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/price/supabase'
import { extractFromFile } from '@/lib/price/extract'
import { classifyItem } from '@/lib/price/classify'

export async function GET() {
  const { data, error } = await supabase
    .from('price_lists')
    .select('*')
    .order('uploaded_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach the open catalog_update id (if any) so the UI can link lists in
  // 'review' status to their diff screen. Degrades to null if the
  // catalog_updates table isn't there yet (migration 010 not applied).
  const { data: openUpdates } = await supabase
    .from('catalog_updates')
    .select('id,new_price_list_id')
    .eq('status', 'pending_review')
  const updateIdByList: Record<string, string> = {}
  for (const u of openUpdates ?? []) {
    if (u.new_price_list_id) updateIdByList[u.new_price_list_id] = u.id
  }
  const withReview = (data ?? []).map(pl => ({
    ...pl,
    review_update_id: updateIdByList[pl.id] ?? null,
  }))
  return NextResponse.json(withReview)
}

// Accepts { path, filename, mimeType, kind } — file already uploaded to Supabase Storage
export async function POST(req: NextRequest) {
  const { path, filename, mimeType, kind, supplierId } = await req.json()
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })

  const validKinds = ['regular', 'promo', 'wholesale', 'closeout', 'vip']
  const resolvedKind = validKinds.includes(kind) ? kind : detectKindFromFilename(filename ?? path)

  const { data: { publicUrl } } = supabase.storage.from('price-pdfs').getPublicUrl(path)

  const { data: priceList, error: insertError } = await supabase
    .from('price_lists')
    .insert({ pdf_url: publicUrl, status: 'processing', kind: resolvedKind })
    .select()
    .single()

  if (insertError || !priceList) {
    return NextResponse.json({ error: insertError?.message }, { status: 500 })
  }

  runExtraction(priceList.id, path, filename ?? path, mimeType ?? 'application/pdf', supplierId || undefined).catch(console.error)

  return NextResponse.json({ id: priceList.id, status: 'processing', kind: resolvedKind })
}

function detectKindFromFilename(name: string): string {
  const n = name.toLowerCase()
  if (/promo/.test(n)) return 'promo'
  if (/wholesale|trade/.test(n)) return 'wholesale'
  if (/closeout|clearance|offer/.test(n)) return 'closeout'
  if (/vip|exclusive|fine\s+wine|reserve\s+collection/.test(n)) return 'vip'
  return 'regular'
}

async function runExtraction(priceListId: string, storagePath: string, filename: string, mimeType: string, targetSupplierId?: string) {
  try {
    const { data: blob, error: dlError } = await supabase.storage
      .from('price-pdfs')
      .download(storagePath)

    if (dlError || !blob) throw dlError ?? new Error('Download failed')

    const buffer = Buffer.from(await blob.arrayBuffer())
    console.log(`[extraction] file: ${filename} (${mimeType}), size: ${buffer.length} bytes`)

    // Throttle progress writes — don't hit the DB more than once per 1.5s
    // even if the parser reports more frequently.
    let lastProgressAt = 0
    let lastProgress = -1
    const onProgress = async (pct: number, phase?: string, itemCount?: number) => {
      const now = Date.now()
      if (pct === lastProgress && now - lastProgressAt < 1500) return
      lastProgress = pct
      lastProgressAt = now
      const update: Record<string, unknown> = {
        progress: Math.min(100, Math.max(0, Math.round(pct))),
        progress_phase: phase ?? null,
      }
      if (typeof itemCount === 'number') update.item_count = itemCount
      await supabase.from('price_lists').update(update).eq('id', priceListId)
    }
    await onProgress(2, 'starting')

    const result = await extractFromFile(buffer, filename, mimeType, onProgress)
    console.log(`[extraction] items found: ${result.items.length}`)

    const rawName = result.supplier_name
    const isUnknown = !rawName || rawName === 'null' || rawName === 'Unknown' || rawName === 'Unknown Supplier'
    result.supplier_name = isUnknown ? 'Unknown Supplier' : rawName

    let supplierId: string | null = null
    if (targetSupplierId) {
      // Explicit target: this upload updates a known supplier regardless of the
      // name printed on the PDF cover (e.g. "Harvest Creation" vs the older
      // "Russian Wine Harvest"). Adopt the supplier's canonical name so inserted
      // rows and the diff stay consistent, then reconcile against its catalog.
      supplierId = targetSupplierId
      const { data: tgt } = await supabase
        .from('suppliers').select('name').eq('id', targetSupplierId).single()
      if (tgt?.name) result.supplier_name = tgt.name
    } else {
      const supplierSlug = result.supplier_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'unknown'

      const { data: existing } = await supabase
        .from('suppliers').select('id').eq('slug', supplierSlug).single()

      if (existing) {
        supplierId = existing.id
      } else {
        const { data: newSupplier } = await supabase
          .from('suppliers').insert({ name: result.supplier_name, slug: supplierSlug })
          .select('id').single()
        supplierId = newSupplier?.id ?? null
      }
    }

    // Does this supplier already have an active catalog? If so, reconcile
    // instead of blindly inserting duplicates.
    const { data: existingItems } = await supabase
      .from('wine_items')
      .select('*')
      .eq('supplier_id', supplierId)
      .eq('status', 'active')

    await supabase.from('price_lists').update({
      supplier_id: supplierId,
      supplier_name: result.supplier_name,
      date: result.price_list_date ?? null,
      item_count: result.items.length,
      progress: 95,
      progress_phase: existingItems && existingItems.length ? 'reconciling' : 'inserting',
    }).eq('id', priceListId)

    if (existingItems && existingItems.length > 0) {
      const { computeDiff } = await import('@/lib/price/reconcile')
      const diff = computeDiff(existingItems as unknown as import('@/lib/price/supabase').WineItem[], result.items)
      const { error: cuErr } = await supabase.from('catalog_updates').insert({
        supplier_id: supplierId,
        new_price_list_id: priceListId,
        status: 'pending_review',
        diff,
      })
      if (cuErr) throw new Error(`catalog_updates insert failed: ${cuErr.message}`)
      await supabase.from('price_lists')
        .update({ status: 'review', progress: 100, progress_phase: null })
        .eq('id', priceListId)
      return
    }

    const VALID_CATEGORY = new Set(['wine', 'spirits', 'beer', 'other'])
    const VALID_WINE_TYPE = new Set(['red', 'white', 'rose', 'orange', 'sparkling'])

    const items = result.items.map(item => {
      // Coerce categories the DB CHECK won't accept (e.g. 'liqueur',
      // 'fortified', 'aperitif') into the closest legal value, and route
      // the original term into spirit_type so we don't lose the signal.
      let category = item.category as string | null | undefined
      let spiritType = item.spirit_type ?? null
      if (category && !VALID_CATEGORY.has(category)) {
        if (!spiritType) spiritType = category
        category = 'spirits'
      }
      if (!category) {
        const fallback = classifyItem(item.name, item.description)
        category = fallback.category
        if (!spiritType) spiritType = fallback.spirit_type
      }

      let wineType = item.wine_type as string | null | undefined
      if (wineType && !VALID_WINE_TYPE.has(wineType)) wineType = null

      return {
        price_list_id: priceListId,
        supplier_id: supplierId,
        supplier_name: result.supplier_name,
        name: item.name,
        country: item.country,
        region: item.region,
        grape_variety: item.grape_variety,
        price: item.price,
        year: item.year,
        volume: item.volume,
        description: item.description,
        category,
        wine_type: wineType,
        spirit_type: spiritType,
        supplier_sku: item.supplier_sku ?? null,
      }
    })

    let inserted = 0
    for (let i = 0; i < items.length; i += 100) {
      const batch = items.slice(i, i + 100)
      const { error: insErr, count } = await supabase
        .from('wine_items')
        .insert(batch, { count: 'exact' })
      if (insErr) {
        console.error(`[extraction] insert batch ${i}-${i + batch.length} failed:`, insErr.message, insErr.details ?? '', insErr.hint ?? '')
        throw new Error(`wine_items insert failed at batch ${i}: ${insErr.message}`)
      }
      inserted += count ?? batch.length
    }
    console.log(`[extraction] inserted ${inserted}/${items.length} wine_items`)
    await supabase.from('price_lists')
      .update({ status: 'done', progress: 100, progress_phase: null })
      .eq('id', priceListId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[extraction] failed:', message)
    await supabase.from('price_lists')
      .update({ status: 'error', error_message: message })
      .eq('id', priceListId)
  }
}
