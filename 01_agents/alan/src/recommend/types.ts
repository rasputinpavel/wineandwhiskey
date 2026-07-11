export type TierKey = "stock" | "catalog" | "world";
export type LabelKey = "value" | "peer" | "upgrade";
export type PriceDirection = "cheaper" | "same" | "pricier" | "unknown";
export type QualityVsAnchor = "lower" | "similar" | "higher";

/** Everything the matcher needs about the scanned wine, built from a Verdict. */
export interface MatchProfile {
  label: string;            // "Producer Name Vintage" — for prompts/echo
  type: string;             // normalized catalog type: red|white|rose|sparkling|orange|"" (fortified/unknown → "")
  grape: string;            // "" if unknown
  region: string;           // hint for the LLM only ("" if unknown)
  qualityScore: number | null;
  marketUsd: number | null; // world origin price in USD
}

/** A wine currently in stock (from inventory.v_sku_breakdown). */
export interface StockItem {
  name: string;
  grape: string;
  country: string;
  priceThb: number | null;
}

/** A wine from a supplier price list (from public.wine_items). */
export interface CatalogItem {
  name: string;
  supplier: string;
  grape: string;
  country: string;
  region: string;
  year: number | null;
  priceThb: number | null;
  vivinoRating: number | null;
}

/** One selection returned by the LLM re-rank, referencing a candidate by index. */
export interface RankPick {
  ref: number;
  why: string;
  qualityVsAnchor: QualityVsAnchor;
}

/** A finished recommendation line ready to render. */
export interface RecoItem {
  name: string;
  supplier?: string;   // present for the catalog tier
  priceLabel: string;  // "฿890" | "~$25" | ""
  labelKey: LabelKey;
  why: string;
}

export interface RecoTier {
  key: TierKey;
  items: RecoItem[];
}

export interface Recommendations {
  tiers: RecoTier[];   // only non-empty tiers, in display order stock→catalog→world
}
