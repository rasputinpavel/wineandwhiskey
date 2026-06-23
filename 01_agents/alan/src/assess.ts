import type { WineEvidence, Verdict, PriceObservation } from "./types.js";
import { bayesianAggregate } from "./normalize.js";
import { qprRating } from "./qpr.js";

/** Approximate FX to USD — coarse on purpose; only feeds the value bucket. */
const USD_RATE: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, THB: 0.028, RUB: 0.011, AUD: 0.66, NZD: 0.61,
};

function toUsd(p: PriceObservation): number | null {
  const rate = USD_RATE[p.currency.toUpperCase()];
  return rate ? p.amount * rate : null;
}

/** Pick the most representative price: prefer an "average"/"market" observation,
 *  else the median of all convertible observations. */
function pickPrice(obs: PriceObservation[]): PriceObservation | null {
  if (obs.length === 0) return null;
  const avg = obs.find((o) => /aver|market|search/i.test(o.context));
  if (avg && toUsd(avg) !== null) return avg;
  const convertible = obs.filter((o) => toUsd(o) !== null);
  if (convertible.length === 0) return null;
  const sorted = [...convertible].sort((a, b) => toUsd(a)! - toUsd(b)!);
  return sorted[Math.floor(sorted.length / 2)];
}

export function assembleVerdict(e: WineEvidence): Verdict {
  const criticConsensus = bayesianAggregate(e.criticScores);
  const marketPrice = pickPrice(e.priceObservations);
  const priceUsd = marketPrice ? toUsd(marketPrice) : null;

  const quality = criticConsensus
    ?? (e.communityRating ? communityToHundred(e.communityRating) : null);
  const qpr = quality !== null && priceUsd !== null ? qprRating(quality, priceUsd) : null;

  const communityNote = e.communityRating
    ? `${e.communityRating.value}/${e.communityRating.scale === "5star" ? "5" : "100"}` +
      (e.communityRating.count ? ` (${e.communityRating.count} reviews)` : "")
    : "";

  return {
    identity: e.identity,
    criticConsensus,
    criticCount: e.criticScores.length,
    communityNote,
    marketPrice,
    qpr,
    bottomLine: bottomLine(quality, qpr ? qpr.rating : null),
    tastingNotes: e.tastingNotes,
    drinkingWindow: e.drinkingWindow,
    dataConfidence: e.dataConfidence,
    sources: e.sources,
  };
}

/** Map a community rating to the 100-pt scale. Linear (×20 for 5-star), matching
 *  normalize.ts — crowd ratings are not inflated into the critic band. */
function communityToHundred(c: WineEvidence["communityRating"]): number | null {
  if (!c) return null;
  return c.scale === "100pt" ? c.value : Math.min(100, c.value * 20);
}

/** Honest one-word-ish bottom line. */
function bottomLine(quality: number | null, qpr: number | null): string {
  if (quality === null) return "depends — not enough data";
  if (qpr !== null && qpr <= 3) return "overpriced — skip unless you love the style";
  if (qpr !== null && qpr >= 7) return "take it — strong value";
  if (quality >= 90) return "take it — genuinely good";
  if (quality < 85) return "skip — unremarkable";
  return "depends — fine but not special";
}
