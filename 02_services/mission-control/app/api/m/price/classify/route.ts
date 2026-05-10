import { NextResponse } from 'next/server'
import { supabase } from '@/lib/price/supabase'
import { classifyItem } from '@/lib/price/classify'

export async function POST() {
  const { data: items, error } = await supabase
    .from('wine_items')
    .select('id, name, description')
    .is('category', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!items || items.length === 0) return NextResponse.json({ classified: 0, message: 'Already up to date' })

  let classified = 0
  const BATCH = 500
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH)
    await Promise.all(
      batch.map(item => {
        const { category, wine_type } = classifyItem(item.name, item.description)
        return supabase.from('wine_items').update({ category, wine_type }).eq('id', item.id)
      })
    )
    classified += batch.length
  }

  return NextResponse.json({ classified, total: items.length })
}
