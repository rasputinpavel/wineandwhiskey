import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Use the get_filter_options() SQL function (003_filter_options_fn.sql) so
// DISTINCT happens server-side. Selecting raw rows hits PostgREST's 1000-row
// limit and silently drops suppliers that fall outside the first page —
// e.g. a 1195-item Bangkok Beer & Beverages list.
export async function GET() {
  const { data, error } = await supabase.rpc('get_filter_options')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? { suppliers: [], countries: [], grapes: [], wine_types: [], spirit_types: [], kinds: [] })
}
