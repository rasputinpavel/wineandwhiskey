import { catalogDb } from "../store.js";
import { catalogPriceRangeThb } from "../priceMatch.js";
import type { CatalogItem, MatchProfile } from "../types.js";

interface Row {
  name: string;
  supplier_name: string | null;
  grape_variety: string | null;
  country: string | null;
  region: string | null;
  year: number | null;
  price: number | null;
  vivino_rating: number | null;
}

/** Pure: map a wine_items row to a CatalogItem. */
export function toCatalogItem(r: Row): CatalogItem {
  return {
    name: r.name,
    supplier: r.supplier_name ?? "",
    grape: r.grape_variety ?? "",
    country: r.country ?? "",
    region: r.region ?? "",
    year: r.year,
    priceThb: r.price,
    vivinoRating: r.vivino_rating,
  };
}

/** Prefiltered supplier-catalog candidates: category=wine, same type, grape match,
 *  price corridor; best-rated first, capped at 50. [] on error / no client. */
export async function fetchCatalogCandidates(p: MatchProfile): Promise<CatalogItem[]> {
  if (!catalogDb) return [];
  let q = catalogDb
    .from("wine_items")
    .select("name,supplier_name,grape_variety,country,region,year,price,vivino_rating")
    .eq("category", "wine")
    .order("vivino_rating", { ascending: false, nullsFirst: false })
    .limit(50);
  if (p.type) q = q.eq("wine_type", p.type);
  if (p.grape) q = q.ilike("grape_variety", `%${p.grape}%`);
  const range = catalogPriceRangeThb(p.marketUsd);
  if (range) q = q.gte("price", range.minThb).lte("price", range.maxThb);
  const { data, error } = await q;
  if (error || !data) {
    if (error) console.error("catalog fetch failed:", error.message);
    return [];
  }
  return (data as Row[]).map(toCatalogItem);
}
