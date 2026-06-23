import type { Lang } from "./types.js";

/** System prompt for the RESEARCH call (with web search). Enforces the honest,
 *  realist sommelier voice and forbids fabrication. */
export function researchSystemPrompt(lang: Lang): string {
  const langLine = lang === "ru" ? "Отвечай по-русски." : "Respond in English.";
  return [
    "You are Алан, a blunt, honest sommelier. You tell the truth about a wine — not marketing.",
    "",
    "Identify the wine from the image and/or text (producer, name, grape, region/country,",
    "vintage, style). Then research it with web search using a CASCADE — always end with a",
    "useful, positioned judgment, never a bare 'no data':",
    "",
    "TIER 1 — the exact wine + vintage: professional critic scores (Decanter, Wine Spectator,",
    "Wine Enthusiast, James Suckling, Jancis Robinson, Vinous…) WITH their scale; community",
    "rating (Vivino average + number of ratings); typical market price with currency.",
    "TIER 2 — if Tier 1 is thin, research the PRODUCER: are they respected? what tier/segment?",
    "flagship wines, general quality reputation, and the usual price band for their wines.",
    "TIER 3 — if the producer is also obscure, research the CATEGORY: what a [grape] from",
    "[region/country] at this price typically delivers — style, quality expectations, and",
    "whether the asking price is normal / cheap / steep for that category.",
    "",
    "Always produce a concise factual brief covering whatever tiers you reached, and explicitly include:",
    "- a note on the PRODUCER (reputation/positioning),",
    "- a note on the CATEGORY positioning,",
    "- a qualitative read on whether the price looks good / fair / steep,",
    "- which tier your judgment rests on (exact bottle / producer / category) and your confidence.",
    "",
    "Honesty: distinguish CRITIC scores from CROWD ratings. Never invent specific scores, prices,",
    "or sources. It is fine — and expected — to say 'no data on this exact bottle' AS LONG AS you",
    "then give the producer/category read. Cite sources for what you do find.",
    langLine,
  ].join("\n");
}

/** System prompt for the ANALOGUES research call. */
export function analoguesSystemPrompt(lang: Lang): string {
  const langLine = lang === "ru" ? "Отвечай по-русски." : "Respond in English.";
  return [
    "You are Алан, an honest sommelier. The user names a wine (image and/or text).",
    "Identify it, then propose 3–5 globally-available analogues — wines similar in",
    "STYLE, QUALITY LEVEL, and PRICE BAND. Not tied to any shop's stock.",
    "For each analogue give a one-line reason for the match and an approximate price.",
    "Use web search to ground your suggestions. Cite sources. If confidence is low,",
    "say so. NEVER invent wines that do not exist.",
    langLine,
  ].join("\n");
}

/** JSON schema for WineEvidence (the structure call). Mirrors types.ts::WineEvidence. */
export const EVIDENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    identity: {
      type: "object", additionalProperties: false,
      properties: {
        producer: { type: "string" }, name: { type: "string" },
        vintage: { type: "string" }, region: { type: "string" },
        grape: { type: "string" }, type: { type: "string" },
        idConfidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["producer", "name", "vintage", "region", "grape", "type", "idConfidence"],
    },
    criticScores: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          source: { type: "string" },
          rawScore: { type: "number" },
          scale: { type: "string", enum: ["100pt", "20pt", "5star"] },
        },
        required: ["source", "rawScore", "scale"],
      },
    },
    communityRating: {
      anyOf: [
        { type: "null" },
        {
          type: "object", additionalProperties: false,
          properties: {
            value: { type: "number" },
            scale: { type: "string", enum: ["5star", "100pt"] },
            count: { type: "number" },
          },
          required: ["value", "scale", "count"],
        },
      ],
    },
    priceObservations: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          amount: { type: "number" }, currency: { type: "string" }, context: { type: "string" },
        },
        required: ["amount", "currency", "context"],
      },
    },
    tastingNotes: { type: "string" },
    drinkingWindow: { type: "string" },
    producerNote: { type: "string" },
    categoryPositioning: { type: "string" },
    evidenceLevel: { type: "string", enum: ["exact", "producer", "category", "none"] },
    valueRead: { type: "string", enum: ["good", "fair", "steep", "unknown"] },
    dataConfidence: { type: "string", enum: ["high", "medium", "low"] },
    sources: { type: "array", items: { type: "string" } },
  },
  required: [
    "identity", "criticScores", "communityRating", "priceObservations",
    "tastingNotes", "drinkingWindow", "dataConfidence", "sources",
    "producerNote", "categoryPositioning", "evidenceLevel", "valueRead",
  ],
} as const;

/** JSON schema for AnaloguesResult. Mirrors types.ts::AnaloguesResult. */
export const ANALOGUES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    forWine: { type: "string" },
    analogues: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          name: { type: "string" }, why: { type: "string" }, approxPrice: { type: "string" },
        },
        required: ["name", "why", "approxPrice"],
      },
    },
    dataConfidence: { type: "string", enum: ["high", "medium", "low"] },
    sources: { type: "array", items: { type: "string" } },
  },
  required: ["forWine", "analogues", "dataConfidence", "sources"],
} as const;
