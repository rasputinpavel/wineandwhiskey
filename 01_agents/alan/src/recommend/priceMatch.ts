import { thbToUsd, usdToThb, THAI_IMPORT_MULT } from "../priceLocal.js";
import type { PriceDirection, QualityVsAnchor, LabelKey } from "./types.js";

/** Compare two USD prices → cheaper / same / pricier. 'unknown' if either is missing. */
export function priceDirection(anchorUsd: number | null, candidateUsd: number | null): PriceDirection {
  if (anchorUsd === null || candidateUsd === null || !(anchorUsd > 0) || !(candidateUsd > 0)) return "unknown";
  const ratio = candidateUsd / anchorUsd;
  if (ratio < 0.8) return "cheaper";
  if (ratio <= 1.25) return "same";
  return "pricier";
}

/** Combine the (code-computed, reliable) price direction with the (LLM-judged) quality
 *  into one label. Price leads: a cheaper wine always reads as the value pick — the
 *  reliable price gap is never hidden behind a quality guess. Quality only decides
 *  whether a pricier wine earns "upgrade". */
export function pickLabel(dir: PriceDirection, quality: QualityVsAnchor): LabelKey {
  if (dir === "cheaper") return "value";
  if (dir === "pricier" && quality === "higher") return "upgrade";
  return "peer";
}

/** Expected Thailand-market price (USD) for a wine whose world origin price is marketUsd. */
export function thaiAnchorUsd(marketUsd: number | null): number | null {
  return marketUsd !== null && marketUsd > 0 ? marketUsd * THAI_IMPORT_MULT : null;
}

/** Rough THB corridor for the catalog prefilter (wide on purpose — precision is the
 *  label step's job). null → no price filter (marketUsd unknown). */
export function catalogPriceRangeThb(marketUsd: number | null): { minThb: number; maxThb: number } | null {
  if (!(marketUsd !== null && marketUsd > 0)) return null;
  return {
    minThb: Math.round(usdToThb(marketUsd) * 0.7),
    maxThb: Math.round(usdToThb(marketUsd * THAI_IMPORT_MULT) * 1.6),
  };
}

/** Price direction for a Thailand-market (THB-priced) candidate vs the scanned wine. */
export function directionForThb(marketUsd: number | null, priceThb: number | null): PriceDirection {
  const candidateUsd = priceThb !== null ? thbToUsd(priceThb) : null;
  return priceDirection(thaiAnchorUsd(marketUsd), candidateUsd);
}

/** Best-effort USD number from a free-text approx price ("~$25", "$1,200", "18 USD"). */
export function parseUsd(approx: string): number | null {
  const m = approx.replace(/[,\s]/g, "").match(/\$?(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

/** The scanned wine's expected Thailand price in THB (its anchor for proximity/labels).
 *  null when the world price is unknown. */
export function anchorThb(marketUsd: number | null): number | null {
  const usd = thaiAnchorUsd(marketUsd);
  return usd !== null ? usdToThb(usd) : null;
}

/** Order candidates by how close their THB price sits to the anchor (soft — nothing is
 *  dropped, price-less items sort last). Returns the anchor's own order when unknown. */
export function sortByPriceProximity<T extends { priceThb: number | null }>(
  items: T[],
  anchor: number | null,
): T[] {
  if (anchor === null) return items;
  const dist = (p: number | null): number => (p === null ? Infinity : Math.abs(p - anchor));
  return [...items].sort((a, b) => dist(a.priceThb) - dist(b.priceThb));
}
