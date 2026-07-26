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

export function imageKey(name: string): string {
  const toks = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP.has(t) && !/^\d+ml$/.test(t))
  return [...new Set(toks)].sort().join('-')
}
