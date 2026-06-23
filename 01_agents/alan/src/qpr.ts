export interface Qpr {
  rating: number; // 1–10
  label: string;
}

const LABELS: Record<number, string> = {
  10: "Bargain of a lifetime",
  9: "Outstanding value",
  8: "Excellent value",
  7: "Very good value",
  6: "Good value",
  5: "Fair value",
  4: "Slightly pricey",
  3: "Pricey for what it is",
  2: "Expensive for what it is",
  1: "Forget it",
};

/** Rough market-expected price (USD) for a wine of the given 100-pt quality.
 *  Prices climb steeply with quality — that's what makes a cheap good wine
 *  "value" and an expensive mediocre one "overpriced". */
function fairPriceUsd(quality: number): number {
  if (quality < 84) return 12;
  if (quality < 87) return 18;
  if (quality < 90) return 28;
  if (quality < 92) return 45;
  if (quality < 94) return 75;
  if (quality < 96) return 120;
  return 200;
}

/** Quality (0–100) + price (USD) → 1–10 value rating by comparing the asking
 *  price to the fair price for that quality. Returns null if price unknown. */
export function qprRating(quality: number, priceUsd: number): Qpr | null {
  if (!(priceUsd > 0)) return null;
  const ratio = fairPriceUsd(quality) / priceUsd; // > 1 = cheaper than fair = good value
  let rating: number;
  if (ratio >= 2.5) rating = 10;
  else if (ratio >= 1.8) rating = 9;
  else if (ratio >= 1.4) rating = 8;
  else if (ratio >= 1.15) rating = 7;
  else if (ratio >= 0.95) rating = 6;
  else if (ratio >= 0.8) rating = 5;
  else if (ratio >= 0.65) rating = 4;
  else if (ratio >= 0.5) rating = 3;
  else if (ratio >= 0.35) rating = 2;
  else rating = 1;
  return { rating, label: LABELS[rating] };
}
