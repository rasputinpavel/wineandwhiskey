import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { extractPriceList } from '@/lib/claude'

export async function GET() {
  const { data, error } = await supabase
    .from('price_lists')
    .select('*')
    .order('uploaded_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null

  if (!file || file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'PDF file required' }, { status: 400 })
  }

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const filename = `${Date.now()}_${file.name.replace(/[^a-z0-9._-]/gi, '_')}`

  // Upload PDF to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from('price-pdfs')
    .upload(filename, buffer, { contentType: 'application/pdf', upsert: false })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = supabase.storage
    .from('price-pdfs')
    .getPublicUrl(filename)

  // Create price_list record
  const { data: priceList, error: insertError } = await supabase
    .from('price_lists')
    .insert({ pdf_url: publicUrl, status: 'processing' })
    .select()
    .single()

  if (insertError || !priceList) {
    return NextResponse.json({ error: insertError?.message }, { status: 500 })
  }

  // Fire-and-forget extraction (Railway runs persistent Node.js — not serverless)
  runExtraction(priceList.id, buffer).catch(console.error)

  return NextResponse.json({ id: priceList.id, status: 'processing' })
}

async function runExtraction(priceListId: string, buffer: Buffer) {
  try {
    const pdfBase64 = buffer.toString('base64')
    const result = await extractPriceList(pdfBase64)

    // Upsert supplier
    const supplierSlug = result.supplier_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    let supplierId: string | null = null

    const { data: existing } = await supabase
      .from('suppliers')
      .select('id')
      .eq('slug', supplierSlug)
      .single()

    if (existing) {
      supplierId = existing.id
    } else {
      const { data: newSupplier } = await supabase
        .from('suppliers')
        .insert({ name: result.supplier_name, slug: supplierSlug })
        .select('id')
        .single()
      supplierId = newSupplier?.id ?? null
    }

    // Update price_list with supplier info and date
    await supabase
      .from('price_lists')
      .update({
        supplier_id: supplierId,
        supplier_name: result.supplier_name,
        date: result.price_list_date ?? null,
        status: 'done',
        item_count: result.items.length,
      })
      .eq('id', priceListId)

    // Insert wine items in batches of 100
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
    await supabase
      .from('price_lists')
      .update({ status: 'error', error_message: message })
      .eq('id', priceListId)
  }
}
