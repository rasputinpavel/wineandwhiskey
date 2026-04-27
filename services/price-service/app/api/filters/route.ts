import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const [suppliersRes, countriesRes, grapesRes] = await Promise.all([
    supabase.from('wine_items').select('supplier_name').not('supplier_name', 'is', null),
    supabase.from('wine_items').select('country').not('country', 'is', null),
    supabase.from('wine_items').select('grape_variety').not('grape_variety', 'is', null),
  ])

  const unique = <T>(arr: T[]): T[] => [...new Set(arr)].sort() as T[]

  const suppliers = unique(
    (suppliersRes.data ?? []).map(r => r.supplier_name as string).filter(Boolean)
  )
  const countries = unique(
    (countriesRes.data ?? []).map(r => r.country as string).filter(Boolean)
  )
  const grapes = unique(
    (grapesRes.data ?? [])
      .flatMap(r => (r.grape_variety as string ?? '').split(',').map(g => g.trim()))
      .filter(Boolean)
  )

  return NextResponse.json({ suppliers, countries, grapes })
}
