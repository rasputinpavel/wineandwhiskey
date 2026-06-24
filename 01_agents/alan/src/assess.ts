import type { WineEvidence, Verdict, PriceObservation, BottomLine, ValueRead, EvidenceLevel } from "./types.js";
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

function communityToHundred(c: WineEvidence["communityRating"]): number | null {
  if (!c) return null;
  return c.scale === "100pt" ? c.value : Math.min(100, c.value * 20);
}

/** Honest bottom-line code (localized for display in format.ts). Uses the numeric
 *  QPR when available, otherwise the qualitative value read + evidence level, so a
 *  wine with only producer/category context still gets a real take. */
function bottomLine(
  quality: number | null,
  qpr: number | null,
  valueRead: ValueRead,
  level: EvidenceLevel,
): BottomLine {
  if (qpr !== null) {
    if (qpr <= 3) return "overpriced";
    if (qpr >= 7) return "take-value";
  }
  if (quality !== null && quality >= 90) return "take-quality";
  if (valueRead === "steep") return "overpriced";
  if (valueRead === "good") return "take-value";
  if (quality !== null && quality < 85) return "skip";
  if (level === "none" && quality === null && valueRead === "unknown") return "nodata";
  return "depends-ok";
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
    bottomLine: bottomLine(quality, qpr ? qpr.rating : null, e.valueRead, e.evidenceLevel),
    tastingNotes: e.tastingNotes,
    drinkingWindow: e.drinkingWindow,
    producerNote: e.producerNote,
    categoryPositioning: e.categoryPositioning,
    evidenceLevel: e.evidenceLevel,
    valueRead: e.valueRead,
    priceTier: e.priceTier,
    qualityScore: quality,
    marketUsd: priceUsd,
    punchline: e.punchline,
    detail: "",
    dataConfidence: e.dataConfidence,
    sources: e.sources,
  };
}
