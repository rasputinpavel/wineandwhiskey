import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { extractPriceList } from '@/lib/claude'
import { extractTextFromPdf } from '@/lib/pdf'

export async function GET() {
  const { data, error } = await supabase
    .from('price_lists')
    .select('*')
    .order('uploaded_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Accepts { path } — PDF already uploaded directly to Supabase Storage
export async function POST(req: NextRequest) {
  const { path } = await req.json()
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })

  const { data: { publicUrl } } = supabase.storage.from('price-pdfs').getPublicUrl(path)

  const { data: priceList, error: insertError } = await supabase
    .from('price_lists')
    .insert({ pdf_url: publicUrl, status: 'processing' })
    .select()
    .single()

  if (insertError || !priceList) {
    return NextResponse.json({ error: insertError?.message }, { status: 500 })
  }

  runExtraction(priceList.id, path).catch(console.error)

  return NextResponse.json({ id: priceList.id, status: 'processing' })
}

async function runExtraction(priceListId: string, storagePath: string) {
  try {
    // Download PDF from Supabase Storage
    const { data: blob, error: dlError } = await supabase.storage
      .from('price-pdfs')
      .download(storagePath)

    if (dlError || !blob) throw dlError ?? new Error('Download failed')

    const buffer = Buffer.from(await blob.arrayBuffer())
    const pdfText = await extractTextFromPdf(buffer)

    if (pdfText.trim().length < 100) {
      throw new Error('Не удалось извлечь текст из PDF. Возможно, это скан без OCR.')
    }

    const result = await extractPriceList(pdfText)

    // Upsert supplier
    const supplierSlug = result.supplier_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    let supplierId: string | null = null
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

    await supabase.from('price_lists').update({
      supplier_id: supplierId,
      supplier_name: result.supplier_name,
      date: result.price_list_date ?? null,
      status: 'done',
      item_count: result.items.length,
    }).eq('id', priceListId)

    const items = result.items.map(item => ({
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
    }))

    for (let i = 0; i < items.length; i += 100) {
      await supabase.from('wine_items').insert(items.slice(i, i + 100))
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabase.from('price_lists')
      .update({ status: 'error', error_message: message })
      .eq('id', priceListId)
  }
}
