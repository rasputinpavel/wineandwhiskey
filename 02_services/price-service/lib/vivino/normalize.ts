// Build a stable, cache-friendly query string for Vivino.
// We normalize aggressively so that minor name punctuation/case differences
// across price lists collapse to the same cache key.

const VOLUME_RX = /\b\d+(?:[.,]\d+)?\s*(?:ml|cl|l|л|мл)\b/gi
const YEAR_RX = /\b(19|20)\d{2}\b/g
const PUNCT_RX = /[«»"'`’“”()\[\]{}.,;:!?#*/\\|]+/g
const WHITESPACE_RX = /\s+/g

export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    // strip diacritics
    .replace(/[̀-ͯ]/g, '')
    .replace(VOLUME_RX, ' ')
    // Strip 4-digit year tokens — the Vivino actor removes them from
    // `searchQuery` before returning, so leaving them in our query breaks
    // the exact-match mapping (we'd never find the result by query key).
    .replace(YEAR_RX, ' ')
    .replace(PUNCT_RX, ' ')
    .replace(/\s*-\s*/g, ' ')
    .replace(WHITESPACE_RX, ' ')
    .trim()
}

// More aggressive normalizer for fuzzy matching in the public lookup endpoint.
// Differences from `normalizeName`: hyphens always become separators (`Bila-Haut`
// → `bila haut`), `&` is treated as punctuation, and bare decimal volumes
// (`0.75`, `0,75`) are stripped.
//
// Kept separate because changing `normalizeName` would invalidate existing
// vivino_cache keys built with the old normalization.
const BARE_DECIMAL_RX = /\b\d+[.,]\d+\b/g
const MATCH_PUNCT_RX = /[«»"'`’“”()\[\]{}.,;:!?#*/\\|&_+=]+/g

export function normalizeForMatch(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(VOLUME_RX, ' ')
    .replace(BARE_DECIMAL_RX, ' ')
    .replace(YEAR_RX, ' ')
    .replace(MATCH_PUNCT_RX, ' ')
    // Hyphens as separators regardless of surrounding spaces.
    .replace(/-/g, ' ')
    .replace(WHITESPACE_RX, ' ')
    .trim()
}

// Build the actual search query we send to the Apify actor.
// We add winery only — the actor strips year tokens from `searchQuery` before
// returning, which would break our exact-match-by-searchQuery mapping. Vintage
// is still recovered from the actor's `vintage` field on the result.
export function buildVivinoQuery(item: {
  name: string
  winery: string | null
  year: number | null
}): string {
  const base = normalizeName(item.name)
  const parts: string[] = [base]

  if (item.winery) {
    const w = normalizeName(item.winery)
    if (w && !base.includes(w)) parts.unshift(w)
  }

  return parts.join(' ').replace(WHITESPACE_RX, ' ').trim()
}
