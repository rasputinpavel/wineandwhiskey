import type { PlaqueZone } from './types'

// Brand tokens (04_brand/design-system.md §2). `sparkling` reuses amber-gold
// with a bubble texture applied in the template; the swatch hex here is the
// base fill. `label` is the vertical plaque caption.
export const PLAQUE_TOKENS: Record<PlaqueZone, string> = {
  white:     '#C9A84C', // amber-gold
  red:       '#8C1C1C', // wine-red
  sparkling: '#5E9B8E', // eucalyptus teal — distinct from the gold White plaque
  champagne: '#B98F28', // rich gold — rendered as a gradient on the plaque (template)
  rose:      '#C98C8C', // rose-dust
  spirits:   '#3D3D3D', // graphite
}

export const PLAQUE_LABELS: Record<PlaqueZone, string> = {
  white: 'WHITE', red: 'RED', sparkling: 'SPARKLING', champagne: 'CHAMPAGNE', rose: 'ROSÉ', spirits: 'SPIRITS',
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
  'champagne': 'champagne',
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

// Sparkling / rosé cues in the name — needed because many sparkling SKUs sit
// under a non-colour category (e.g. "RUSSIA") with no wine_color, so they'd
// otherwise default to White. "Brut" etc. are unambiguous sparkling markers.
// Champagne (from the Champagne region) is its own type; check it before the
// generic sparkling markers so "…Champagne" routes to the champagne zone.
const CHAMPAGNE_NAME = /\bchampagne\b/
const SPARKLING_NAME = /\b(brut|spumante|prosecco|cava|cremant|sekt|asti|franciacorta|pet.?nat|blanc de blanc|extra dry|metodo classico)\b/
const ROSE_NAME = /\b(rose|rosato|rosado)\b/

const RED_GRAPE = /\b(cabernet|merlot|malbec|syrah|shiraz|pinot noir|nebbiolo|sangiovese|tempranillo|grenache|garnacha|zinfandel|montepulciano|nero d.?avola|nero|primitivo|carmenere|mourvedre|barbera|saperavi|aglianico|tannat|pinotage|negroamaro|corvina|petit verdot|touriga|krasnostop)\b/
const WHITE_GRAPE = /\b(chardonnay|sauvignon|riesling|pinot grigio|pinot gris|gewurztraminer|viognier|chenin|semillon|muscat|moscato|albarino|verdejo|gruner|vermentino|trebbiano|garganega|cortese|fiano|greco|torrontes|rkatsiteli|marsanne|roussanne|colombard|pinot blanc|verdicchio|grillo|catarratto|silvaner|muscadet)\b/

export function zoneFromName(text: string | null | undefined): PlaqueZone | null {
  const k = String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  if (CHAMPAGNE_NAME.test(k)) return 'champagne'
  if (SPARKLING_NAME.test(k)) return 'sparkling'
  if (ROSE_NAME.test(k)) return 'rose'
  // "Blanc de Noirs" is a white made from a red grape — the blanc marker wins.
  if (/\bblanc\b|\bbianco\b|\bblanco\b/.test(k)) return 'white'
  if (RED_GRAPE.test(k)) return 'red'
  if (WHITE_GRAPE.test(k)) return 'white'
  return null
}

// Best zone for a catalog SKU: a curated wine_color wins; then an explicit
// colour/spirit category; then sparkling/rosé/grape cues in the name; else White
// (user can override per card).
export function inferZone(wineColor: string | null | undefined, category: string | null | undefined, name?: string | null): PlaqueZone {
  return zoneFromWineColorStrict(wineColor) ?? zoneFromCategory(category) ?? zoneFromName(name) ?? 'white'
}
