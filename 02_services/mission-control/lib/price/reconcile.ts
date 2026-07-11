// Pure catalog-reconciliation logic: compare a freshly parsed price list against
// a supplier's current active items and produce a reviewable diff. No I/O here.
import type { ExtractedItem } from './claude'
import type { WineItem } from './supabase'

export function normalizeName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[’']/g, '')                              // elide apostrophes (d'Or -> dor)
    .replace(/\b\d{4}\b/g, ' ')                        // drop vintage year tokens
    .replace(/[^a-z0-9]+/g, ' ')                       // punctuation -> space
    .trim()
    .replace(/\s+/g, ' ')
}

export function canonicalVolume(volume: string | null | undefined): string {
  if (!volume) return '750'
  const v = volume.toLowerCase().replace(/\s+/g, '')
  const l = v.match(/^([\d.]+)l$/)                     // e.g. 0.75l
  if (l) return String(Math.round(parseFloat(l[1]) * 1000))
  const ml = v.match(/(\d+)ml/)                        // e.g. 750ml
  if (ml) return ml[1]
  const bare = v.match(/^(\d+)$/)
  return bare ? bare[1] : '750'
}

export function matchKey(name: string, volume: string | null | undefined): string {
  return `${normalizeName(name)}|${canonicalVolume(volume)}`
}
