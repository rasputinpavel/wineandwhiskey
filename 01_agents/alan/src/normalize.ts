import type { CriticScore } from "./types.js";

const PRIOR_MEAN = 90;
const PRIOR_WEIGHT = 3;

/** Convert one critic score to the 100-point scale. */
export function toHundred(s: CriticScore): number {
  switch (s.scale) {
    case "100pt": return s.rawScore;
    case "20pt":  return s.rawScore * 5;
    case "5star": return s.rawScore * 20;
  }
}

/** Quantity-weighted Bayesian aggregate on the 100-pt scale, rounded to an int.
 *  Returns null when there are no scores. */
export function bayesianAggregate(scores: CriticScore[]): number | null {
  if (scores.length === 0) return null;
  const sum = scores.reduce((acc, s) => acc + toHundred(s), 0);
  const agg = (PRIOR_MEAN * PRIOR_WEIGHT + sum) / (PRIOR_WEIGHT + scores.length);
  return Math.round(agg);
}
