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

// Colour / qualifier words that carry no varietal signal for matching.
const GRAPE_STOPWORDS = new Set([
  "negra", "negre", "blanca", "blanco", "blanc", "noir", "tinto", "tinta", "gris", "seco", "dulce",
]);

// Cross-language grape synonyms so a Spanish blend still matches French-labelled catalog rows
// (and vice versa). Single-word entries only — they go into a PostgREST or() filter.
const GRAPE_SYNONYMS: Record<string, string[]> = {
  garnacha: ["grenache", "garnatxa"],
  grenache: ["garnacha", "garnatxa"],
  carignan: ["carinena", "carinema", "mazuelo", "samso", "carignano"],
  carinena: ["carignan", "mazuelo", "samso"],
  mazuelo: ["carignan", "carinena"],
  syrah: ["shiraz"],
  shiraz: ["syrah"],
  tempranillo: ["cencibel"],
  monastrell: ["mourvedre", "mataro"],
  mourvedre: ["monastrell", "mataro"],
};

/** Break a grape string (often a blend like "Garnacha Negra, Carignan, Merlot") into the
 *  core grape words to match on, plus their cross-language synonyms. Drops colour
 *  qualifiers, digits, and short noise tokens. */
export function grapeTokens(grape: string): string[] {
  const words = grape
    .toLowerCase()
    .replace(/[\/\-]/g, ",")
    .replace(/[0-9%]/g, " ")
    .split(/[,\s]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !GRAPE_STOPWORDS.has(w));
  const out = new Set<string>(words);
  for (const w of words) for (const syn of GRAPE_SYNONYMS[w] ?? []) out.add(syn);
  return [...out];
}

/** Supplier-catalog candidates: category=wine, same type, price corridor, matching ANY
 *  shared grape (with synonyms). Falls back to type+price only when the grape match is
 *  empty, so the tier still populates. best-rated first, up to 80. [] on error / no client. */
export async function fetchCatalogCandidates(p: MatchProfile): Promise<CatalogItem[]> {
  if (!catalogDb) return [];
  const range = catalogPriceRangeThb(p.marketUsd);
  const base = () => {
    let q = catalogDb!
      .from("wine_items")
      .select("name,supplier_name,grape_variety,country,region,year,price,vivino_rating")
      .eq("category", "wine")
      .order("vivino_rating", { ascending: false, nullsFirst: false })
      .limit(80);
    if (p.type) q = q.eq("wine_type", p.type);
    if (range) q = q.gte("price", range.minThb).lte("price", range.maxThb);
    return q;
  };

  // First pass: match any shared grape token (or() uses PostgREST's * wildcard).
  const tokens = grapeTokens(p.grape);
  let rows: Row[] | null = null;
  if (tokens.length) {
    const orExpr = tokens.map((t) => `grape_variety.ilike.*${t}*`).join(",");
    const res = await base().or(orExpr);
    if (res.error) console.error("catalog fetch (grape) failed:", res.error.message);
    else rows = res.data as Row[];
  }

  // Fallback: no grape tokens, or the grape pass found nothing → type + price only.
  if (!rows || rows.length === 0) {
    const res = await base();
    if (res.error || !res.data) {
      if (res.error) console.error("catalog fetch failed:", res.error.message);
      return [];
    }
    rows = res.data as Row[];
  }

  return rows.map(toCatalogItem);
}
