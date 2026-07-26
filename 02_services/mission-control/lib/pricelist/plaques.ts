import type { PlaqueZone } from './types'

// Brand tokens (04_brand/design-system.md §2). `sparkling` reuses amber-gold
// with a bubble texture applied in the template; the swatch hex here is the
// base fill. `label` is the vertical plaque caption.
export const PLAQUE_TOKENS: Record<PlaqueZone, string> = {
  white:     '#C9A84C', // amber-gold
  red:       '#8C1C1C', // wine-red
  sparkling: '#C9A84C', // amber-gold + bubble pattern (template)
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
