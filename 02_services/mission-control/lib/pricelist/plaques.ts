import type { PlaqueZone } from './types'

// Brand tokens (04_brand/design-system.md §2). `sparkling` reuses amber-gold
// with a bubble texture applied in the template; the swatch hex here is the
// base fill. `label` is the vertical plaque caption.
export const PLAQUE_TOKENS: Record<PlaqueZone, string> = {
  white:     '#C9A84C', // amber-gold
  red:       '#8C1C1C', // wine-red
  sparkling: '#5E9B8E', // eucalyptus teal — distinct from the gold White plaque
  rose:      '#C98C8C', // rose-dust
  spirits:   '#3D3D3D', // graphite
}

export const PLAQUE_LABELS: Record<PlaqueZone, string> = {
  white: 'WHITE', red: 'RED', sparkling: 'SPARKLING', rose: 'ROSÉ', spirits: 'SPIRITS',
}

export function zoneFromWineColor(c: string | null | undefined): PlaqueZone {
  switch (c) {
    case 'red':       return 'red'
    case 'white':     return 'white'
    case 'sparkling': return 'sparkling'
    case 'rose':      return 'rose'
    case 'orange':    return 'white' // folded into white zone in v1
    default:          return 'white'
  }
}

export function zoneToken(z: PlaqueZone): string {
  return PLAQUE_TOKENS[z]
}

// Strict variant: a known wine_color → its zone, otherwise null (so the caller
// can fall back to the category). Unlike zoneFromWineColor this does NOT default.
function zoneFromWineColorStrict(c: string | null | undefined): PlaqueZone | null {
  switch (c) {
    case 'red':       return 'red'
    case 'white':     return 'white'
    case 'sparkling': return 'sparkling'
    case 'rose':      return 'rose'
    case 'orange':    return 'white'
    default:          return null
  }
}

// inventory.sku.category is far better populated than wine_color: "Red Wine",
// "White Wine", "Sparkling Wine", "Rose Wine", "Pét-Nat", "Whiskey", "Rum"…
const CATEGORY_ZONE: Record<string, PlaqueZone> = {
  'red wine': 'red',
  'white wine': 'white',
  'orange wine': 'white',
  'rose wine': 'rose', 'rosé wine': 'rose',
  'sparkling wine': 'sparkling', 'pét-nat': 'sparkling', 'pet-nat': 'sparkling', 'pétnat': 'sparkling',
}
const SPIRIT_HINTS = ['whisky', 'whiskey', 'bourbon', 'scotch', 'rum', 'gin', 'tequila',
  'vodka', 'cognac', 'armagnac', 'brandy', 'liquor', 'liqueur', 'mezcal', 'sake', 'aperitif', 'vermouth']

export function zoneFromCategory(category: string | null | undefined): PlaqueZone | null {
  const k = String(category ?? '').trim().toLowerCase()
  if (!k) return null
  if (CATEGORY_ZONE[k]) return CATEGORY_ZONE[k]
  if (SPIRIT_HINTS.some(s => k.includes(s))) return 'spirits'
  return null
}

// Best zone for a catalog SKU: a curated wine_color wins; otherwise infer from
// the category; otherwise white (user can override per card).
export function inferZone(wineColor: string | null | undefined, category: string | null | undefined): PlaqueZone {
  return zoneFromWineColorStrict(wineColor) ?? zoneFromCategory(category) ?? 'white'
}
