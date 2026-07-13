import { NextResponse } from 'next/server'
import { supabase } from '@/lib/price/supabase'

// Done catalogs — options for the upload screen's "new version of…" picker.
export async function GET() {
  const { data, error } = await supabase
    .from('price_lists')
    .select('id,supplier_name,date,uploaded_at,item_count')
    .eq('status', 'done')
    .order('uploaded_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
