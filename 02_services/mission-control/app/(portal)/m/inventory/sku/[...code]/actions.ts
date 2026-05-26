'use server'

import { revalidatePath } from 'next/cache'
import { sbInventory } from '@/lib/supabase'

export type WineColor = 'red' | 'white' | 'rose' | 'sparkling' | 'orange'

export async function updateSkuWineAttrs(input: {
  skuId:          string
  wine_color:     WineColor | null
  grape_variety:  string | null
  wine_country:   string | null
}) {
  const { error } = await sbInventory
    .from('sku')
    .update({
      wine_color:           input.wine_color,
      grape_variety:        input.grape_variety?.trim() || null,
      wine_country:         input.wine_country?.trim() || null,
      wine_attrs_source:    'manual',
      wine_attrs_updated_at: new Date().toISOString(),
    })
    .eq('id', input.skuId)
  if (error) return { ok: false as const, error: error.message }
  revalidatePath('/m/wine-matrix/white')
  revalidatePath('/m/wine-matrix/red')
  revalidatePath('/m/wine-matrix/sparkling')
  return { ok: true as const }
}
