import type { Verdict } from "../types.js";
import { identityLabel } from "../identify.js";
import type { MatchProfile } from "./types.js";

/** Map a display wine type to the catalog's `wine_type` enum. Fortified/unknown → ""
 *  (no type filter — the catalog has no fortified bucket). */
export function normalizeType(t: string): string {
  const s = t.trim().toLowerCase();
  if (s === "rosé" || s === "rose") return "rose";
  if (s === "red" || s === "white" || s === "sparkling" || s === "orange") return s;
  return "";
}

/** Build the matcher's anchor profile from an assembled verdict. No LLM call. */
export function buildProfile(v: Verdict): MatchProfile {
  return {
    label: identityLabel(v.identity),
    type: normalizeType(v.identity.type),
    grape: v.identity.grape.trim(),
    region: v.identity.region.trim(),
    qualityScore: v.qualityScore,
    marketUsd: v.marketUsd,
  };
}
