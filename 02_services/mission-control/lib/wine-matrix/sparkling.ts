export type SparklingType = 'champagne' | 'cremant' | 'prosecco' | 'cava' | 'sekt' | 'other'

export const SPARKLING_TYPE_LABEL: Record<SparklingType, string> = {
  champagne: 'Champagne',
  cremant:   'Crémant',
  prosecco:  'Prosecco',
  cava:      'Cava',
  sekt:      'Sekt',
  other:     'Other sparkling',
}

export const SPARKLING_TYPE_ORDER: SparklingType[] = [
  'champagne', 'cremant', 'prosecco', 'cava', 'sekt', 'other',
]

export function classifySparklingType(input: {
  country?: string | null
  region?:  string | null
  winery?:  string | null
  name?:    string | null
}): SparklingType {
  const country = (input.country ?? '').toLowerCase()
  const region  = (input.region  ?? '').toLowerCase()
  const name    = (input.name    ?? '').toLowerCase()
  const winery  = (input.winery  ?? '').toLowerCase()
  const hay     = `${name} ${winery}`

  if (country.includes('france')) {
    if (/champagne/.test(region) || /champagne/.test(hay)) return 'champagne'
    if (/cr[eé]mant/.test(hay)) return 'cremant'
  }
  if (country.includes('italy')   && /prosecco/.test(hay)) return 'prosecco'
  if (country.includes('spain')   && /cava/.test(hay))     return 'cava'
  if (country.includes('germany') && /sekt/.test(hay))     return 'sekt'

  // Country-less fallback: pure name keywords (in case country is missing).
  if (/champagne/.test(hay)) return 'champagne'
  if (/cr[eé]mant/.test(hay)) return 'cremant'
  if (/prosecco/.test(hay))   return 'prosecco'
  if (/\bcava\b/.test(hay))   return 'cava'
  if (/\bsekt\b/.test(hay))   return 'sekt'

  return 'other'
}
