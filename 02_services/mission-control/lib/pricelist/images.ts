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

// Best existing-library slug for a SKU: a file whose tokens are all present in
// the SKU name (subset), preferring the most specific and colour-consistent one.
// Returns undefined when nothing is a safe subset.
export function bestImageSlug(skuName: string, index: { slug: string; tokens: string[] }[]): string | undefined {
  const sku = new Set(imageTokens(skuName))
  if (sku.size < 2) return undefined
  let best: string | undefined
  let bestScore = -1
  for (const f of index) {
    if (f.tokens.length < 2) continue
    if (!f.tokens.every(t => sku.has(t))) continue // file ⊆ sku
    let colorMatch = 0
    for (const t of f.tokens) if (COLOR_TOKENS.has(t)) colorMatch++
    // A SKU colour the file omits is a penalty — prefer a file that names it.
    let skuColorMissed = 0
    for (const t of sku) if (COLOR_TOKENS.has(t) && !f.tokens.includes(t)) skuColorMissed++
    const score = f.tokens.length * 2 + colorMatch * 4 - skuColorMissed * 5
    if (score > bestScore) { bestScore = score; best = f.slug }
  }
  return best
}
