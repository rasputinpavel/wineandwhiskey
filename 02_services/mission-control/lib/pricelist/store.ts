import { sbMarketing } from '@/lib/supabase'
import type { PriceListDoc, LineItem } from './types'

export type SavedList = { id: string; title: string; grouping: string; items: LineItem[]; settings: PriceListDoc['settings']; updated_at: string }

export async function listSaved(): Promise<Pick<SavedList, 'id' | 'title' | 'updated_at'>[]> {
  const { data, error } = await sbMarketing.from('price_lists')
    .select('id,title,updated_at').order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getList(id: string): Promise<SavedList | null> {
  const { data, error } = await sbMarketing.from('price_lists').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as SavedList | null
}

export async function createList(doc: PriceListDoc): Promise<string> {
  const { data, error } = await sbMarketing.from('price_lists')
    .insert({ title: doc.settings.title, grouping: doc.settings.grouping, items: doc.items, settings: doc.settings })
    .select('id').single()
  if (error) throw error
  return data.id
}

export async function updateList(id: string, doc: PriceListDoc): Promise<void> {
  const { error } = await sbMarketing.from('price_lists')
    .update({ title: doc.settings.title, grouping: doc.settings.grouping, items: doc.items, settings: doc.settings, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// Upsert region/producer/volume for every inventory-backed item that has them,
// so they prefill next time. Called on save.
export async function upsertEnrichment(items: LineItem[]): Promise<void> {
  const rows = items
    .filter(it => it.code && (it.region || it.producer || it.volume))
    .map(it => ({ loyverse_product_code: it.code!, region: it.region ?? null, producer: it.producer ?? null, volume: it.volume ?? null, updated_at: new Date().toISOString() }))
  if (!rows.length) return
  const { error } = await sbMarketing.from('sku_enrichment').upsert(rows, { onConflict: 'loyverse_product_code' })
  if (error) throw error
}
