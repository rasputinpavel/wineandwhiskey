// Product-image slug. Files in 04_brand/products/ are named by a slug of the
// wine name (e.g. "Abrau Durso Chardonnay" → abrau-durso-chardonnay.png), NOT
// by Loyverse code. A LineItem's imageSlug is this slug; the render/preview
// layers resolve it against the available files by EXACT match only — a wrong
// bottle on a customer price list is worse than a placeholder, so we never fuzzy.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

// Order-independent, stopword-stripped token signature of a name. Two names with
// the SAME signature describe the same wine even if word order / vintages differ.
// Used to match an existing product-image file to a SKU by EXACT signature only —
// so a bottle named "…Reserve Brut" never matches a file "…Reserve ROSE Brut".
const STOP = new Set(['wine', 'the', 'of', 'and', 'de', 'di', 'du', 'la', 'le', 'el',
  'pgi', 'doc', 'docg', 'igt', 'igp', 'aop', 'ml', 'cl', 'bottle', 'can', 'premium', 'cuvee'])

// Significant tokens of a name (stopwords, bare vintages and volumes dropped —
// the label shot is the same across years/sizes).
export function imageTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t) && !/^\d+(ml|cl|l)$/.test(t))
}

export function imageKey(name: string): string {
  return [...new Set(imageTokens(name))].sort().join('-')
}

// Colour/style tokens that must not be crossed when matching a shot to a SKU
// (so a white never takes a rosé's photo). Used to break subset-match ties.
export const COLOR_TOKENS = new Set(['red', 'white', 'blanc', 'blancs', 'rouge',
  'rose', 'rosato', 'rosado', 'noir', 'orange', 'nero', 'tinto', 'bianco'])

// Best existing-library slug for a SKU. A file matches when one token set is a
// subset of the other (file ⊆ sku OR sku ⊆ file) — so "Ant Moore Sauvignon
// Blanc" still finds "ant-moore-a-plus-sauvignon-blanc". Requires ≥2 shared
// tokens and NO conflicting colour (a red never takes a white/rosé shot).
// Prefers the most specific, best-overlapping, colour-consistent file.
export function bestImageSlug(skuName: string, index: { slug: string; tokens: string[] }[]): string | undefined {
  const sku = new Set(imageTokens(skuName))
  if (sku.size < 2) return undefined
  const skuColors = new Set([...sku].filter(t => COLOR_TOKENS.has(t)))
  let best: string | undefined
  let bestScore = -1
  for (const f of index) {
    const fset = new Set(f.tokens)
    if (fset.size < 2) continue
    const shared = f.tokens.filter(t => sku.has(t))
    if (shared.length < 2) continue
    const fSubsetSku = f.tokens.every(t => sku.has(t))
    const skuSubsetF = [...sku].every(t => fset.has(t))
    if (!fSubsetSku && !skuSubsetF) continue // one must contain the other
    // Colour must never conflict: if both name a colour, they must be the same.
    const fColors = new Set(f.tokens.filter(t => COLOR_TOKENS.has(t)))
    if (skuColors.size && fColors.size) {
      let same = false
      for (const c of fColors) if (skuColors.has(c)) same = true
      if (!same) continue
    }
    const colorMatch = [...fColors].filter(c => skuColors.has(c)).length
    const extra = Math.abs(fset.size - sku.size) // token-count distance
    const score = shared.length * 3 + colorMatch * 4 - extra
    if (score > bestScore) { bestScore = score; best = f.slug }
  }
  return best
}
