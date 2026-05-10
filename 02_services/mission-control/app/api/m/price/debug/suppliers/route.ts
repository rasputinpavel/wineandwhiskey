import { NextResponse } from 'next/server'
import { supabase } from '@/lib/price/supabase'

export async function GET() {
  const { data, error, count } = await supabase
    .from('wine_items')
    .select('supplier_name', { count: 'exact' })
    .not('supplier_name', 'is', null)
    .limit(10000)

  const unique = [...new Set((data ?? []).map(r => r.supplier_name))]

  return NextResponse.json({ error, total_rows: count, returned: data?.length, unique_suppliers: unique })
}
