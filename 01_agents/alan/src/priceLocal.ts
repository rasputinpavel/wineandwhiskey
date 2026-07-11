import type { Lang } from "./types.js";
import { qprRating } from "./qpr.js";

const THB_RATE = 0.028;            // THB → USD
export const THAI_IMPORT_MULT = 2.4;  // typical Thai imported-wine markup over origin price

export function thbToUsd(thb: number): number { return thb * THB_RATE; }
export function usdToThb(usd: number): number { return Math.round(usd / THB_RATE); }

/** Rough Thailand retail range (THB) for a wine whose origin price is originUsd. */
export function estimateThaiThb(originUsd: number): { low: number; high: number } {
  return { low: usdToThb(originUsd * 2.0), high: usdToThb(originUsd * 3.0) };
}

/** Judge an asking price in THB against the assessed quality and the origin (world)
 *  price, accounting for Thailand's heavy import markup. Returns a short bilingual verdict. */
export function localPriceVerdict(
  qualityScore: number | null,
  originUsd: number | null,
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

  if (originUsd !== null) {
    const originThb = usdToThb(originUsd);
    const mult = priceUsd / originUsd;
    const thaiFairUsd = originUsd * THAI_IMPORT_MULT;
    const ratio = priceUsd / thaiFairUsd;
    const cmp = ratio <= 0.85
      ? (ru ? "выгодно для Таиланда" : "a good deal for Thailand")
      : ratio <= 1.2
        ? (ru ? "нормально для Таиланда" : "normal for Thailand")
        : (ru ? "дорого даже для Таиланда" : "steep even for Thailand");
    lines.push(ru
      ? `На родине ~$${Math.round(originUsd)} ≈ ฿${originThb}. Ты платишь ×${mult.toFixed(1)} от родной — ${cmp}.`
      : `Origin ~$${Math.round(originUsd)} ≈ ฿${originThb}. You're paying ×${mult.toFixed(1)} of origin — ${cmp}.`);
  }

  if (lines.length === 0) {
    lines.push(ru
      ? "Недостаточно данных о качестве/цене, чтобы судить о выгоде."
      : "Not enough quality/price data to judge the deal.");
  }
  return lines.join("\n");
}
