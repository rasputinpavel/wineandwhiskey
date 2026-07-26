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
