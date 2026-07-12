import { buildQuery } from "../../input.js";
import { findAnalogues } from "../../pipeline.js";
import { priceDirection, pickLabel, parseUsd } from "../priceMatch.js";
import type { Verdict, Lang } from "../../types.js";
import type { RecoItem } from "../types.js";

/** World-tier recommendations via the existing analogues web search. [] on failure. */
export async function worldTier(verdict: Verdict, label: string, lang: Lang): Promise<RecoItem[]> {
  try {
    const query = buildQuery({ text: label, lang });
    query.intent = "analogues";
    const res = await findAnalogues(query);
    return res.analogues.slice(0, 3).map((a) => {
      const usd = parseUsd(a.approxPrice);
      const dir = priceDirection(verdict.marketUsd, usd);
      return {
        name: a.name,
        priceLabel: usd !== null ? `~$${Math.round(usd)}` : a.approxPrice,
        labelKey: pickLabel(dir, "similar"),
        why: a.why,
      };
    });
  } catch (err) {
    console.error("world tier failed:", err);
    return [];
  }
}
