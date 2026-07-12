import { NextResponse } from 'next/server'
import { supabase } from '@/lib/price/supabase'

// Suppliers that already have an active catalog — the valid targets for an
// "update this supplier" re-upload. Used by the upload screen's supplier picker.
export async function GET() {
  const { data: suppliers, error } = await supabase
    .from('suppliers').select('id,name,slug').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const out: { id: string; name: string; slug: string; item_count: number }[] = []
  for (const s of suppliers ?? []) {
    const { count } = await supabase
      .from('wine_items').select('id', { count: 'exact', head: true })
      .eq('supplier_id', s.id).eq('status', 'active')
    if ((count ?? 0) > 0) out.push({ id: s.id, name: s.name, slug: s.slug, item_count: count ?? 0 })
  }
  return NextResponse.json(out)
}
