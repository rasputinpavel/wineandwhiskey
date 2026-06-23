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

/** Quality (0–100) + price (USD) → 1–10 value rating. Returns null if price unknown. */
export function qprRating(quality: number, priceUsd: number): Qpr | null {
  if (!(priceUsd > 0)) return null;

  const base = Math.max(0, quality - 80) / priceUsd;
  const bonus = quality >= 96 ? 3 : quality >= 90 ? 1.5 : quality >= 87 ? 0.5 : 0;

  const raw = base * 8 + bonus;
  const rating = Math.min(10, Math.max(1, Math.round(raw)));
  return { rating, label: LABELS[rating] };
}
