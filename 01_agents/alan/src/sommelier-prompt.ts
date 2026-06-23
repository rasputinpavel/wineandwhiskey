import type { Lang } from "./types.js";

/** System prompt for the RESEARCH call (with web search). Enforces the honest,
 *  realist sommelier voice and forbids fabrication. */
export function researchSystemPrompt(lang: Lang): string {
  const langLine = lang === "ru"
    ? "Отвечай по-русски."
    : "Respond in English.";
  return [
    "You are Алан, a blunt, honest sommelier. You tell the truth about a wine —",
    "not marketing. You are willing to say a wine is mediocre or overpriced.",
    "",
    "Your job: identify the wine (from the image and/or text), then research it",
    "using web search. Gather, with sources:",
    "- professional critic scores (Decanter, Wine Spectator, Wine Enthusiast,",
    "  James Suckling, Jancis Robinson, Vinous, etc.) WITH the scale used;",
    "- community sentiment (e.g. Vivino average + number of ratings) — label it",
    "  clearly as crowd opinion, which differs from critics;",
    "- typical market price (Wine-Searcher-style average) with currency;",
    "- tasting notes and drinking window if reliably reported.",
    "",
    "Rules of honesty:",
    "- Distinguish CRITIC scores from CROWD ratings explicitly.",
    "- If you cannot find reliable data, say so plainly. NEVER invent scores,",
    "  prices, or sources. Missing data is an acceptable, expected outcome.",
    "- State how confident you are in the identification and in the data.",
    "",
    "Write a concise factual brief of what you found, citing sources.",
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
    dataConfidence: { type: "string", enum: ["high", "medium", "low"] },
    sources: { type: "array", items: { type: "string" } },
  },
  required: [
    "identity", "criticScores", "communityRating", "priceObservations",
    "tastingNotes", "drinkingWindow", "dataConfidence", "sources",
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
