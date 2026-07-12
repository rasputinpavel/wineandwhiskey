import { supabase } from '@/lib/price/supabase'
import type { CatalogUpdate } from '@/lib/price/supabase'
import ReviewClient from './ReviewClient'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data } = await supabase.from('catalog_updates').select('*').eq('id', id).single()
  if (!data) return <div className="p-6">Update not found.</div>
  return <ReviewClient update={data as CatalogUpdate} />
}
