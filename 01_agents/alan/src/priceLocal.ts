import type { Lang } from "./types.js";
import { qprRating } from "./qpr.js";

const THB_RATE = 0.028; // THB → USD (mirrors assess.ts USD_RATE.THB)

export function thbToUsd(thb: number): number { return thb * THB_RATE; }
export function usdToThb(usd: number): number { return Math.round(usd / THB_RATE); }

/** Judge an asking price in THB against the assessed quality (0–100, may be null)
 *  and the world market price in USD (may be null). Returns a short bilingual verdict. */
export function localPriceVerdict(
  qualityScore: number | null,
  marketUsd: number | null,
  baht: number,
  lang: Lang,
): string {
  const ru = lang === "ru";
  const priceUsd = thbToUsd(baht);
  const lines: string[] = [];

  const qpr = qualityScore !== null ? qprRating(qualityScore, priceUsd) : null;
  if (qpr) {
    lines.push(ru
      ? `За ฿${baht}: ${qpr.rating}/10 — ${qpr.label}.`
      : `At ฿${baht}: ${qpr.rating}/10 — ${qpr.label}.`);
  }

  if (marketUsd !== null) {
    const marketThb = usdToThb(marketUsd);
    const ratio = priceUsd / marketUsd;
    const cmp = ratio <= 0.9
      ? (ru ? "дешевле мирового рынка" : "below world market")
      : ratio >= 1.25
        ? (ru ? "дороже мирового рынка" : "above world market")
        : (ru ? "примерно на уровне мирового рынка" : "about world-market level");
    lines.push(ru
      ? `Мировая цена ~$${Math.round(marketUsd)} ≈ ฿${marketThb} → ${cmp}.`
      : `World price ~$${Math.round(marketUsd)} ≈ ฿${marketThb} → ${cmp}.`);
  }

  if (lines.length === 0) {
    lines.push(ru
      ? "Недостаточно данных о качестве/мировой цене, чтобы судить о выгоде."
      : "Not enough quality/market data to judge the deal.");
  }
  return lines.join("\n");
}
