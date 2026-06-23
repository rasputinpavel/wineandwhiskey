import type { Lang } from "./types.js";

/** System prompt for the RESEARCH call (with web search). Enforces the honest,
 *  realist sommelier voice and forbids fabrication. */
export function researchSystemPrompt(lang: Lang): string {
  const langLine = lang === "ru" ? "Отвечай по-русски." : "Respond in English.";
  return [
    "You are Алан, a blunt, honest sommelier. You tell the truth about a wine — not marketing.",
    "",
    "Work through this ladder with web search, narrating each rung in 1–2 short lines AS YOU GO",
    "(so the reader can follow your logic), then end with a positioned verdict. Never a bare 'no data'.",
    "",
    "1) IDENTIFY from the image(s)/text: producer, wine, grape, country, region, vintage, style.",
    "   Multiple photos may be the front and back of the SAME bottle — use both.",
    "2) GRAPE × COUNTRY: what this grape means from THIS country — e.g. Sauvignon Blanc vs US vs",
    "   French Cabernet are different propositions. State the style and quality expectation.",
    "3) REGION within the country: place it (e.g. Napa vs Oregon vs Washington; Rhône vs Burgundy)",
    "   and what that region implies for quality and price.",
    "4) PRODUCER: find their standing — ratings/reputation, tier, how serious they are.",
    "5) RANGE: where THIS wine sits in the producer's lineup (entry / estate / reserve / flagship).",
    "6) DATA: critic scores (with scale) and community rating (Vivino avg + count) for the exact",
    "   wine if they exist; and the typical WORLD market price with currency.",
    "",
    "Then output a concise brief that explicitly includes: producer standing + this wine's place in",
    "their range (put this in the producer note), the grape×country×region positioning (category note),",
    "any critic/crowd numbers and the world market price found, a qualitative read of whether that",
    "world price looks good/fair/steep, the tier your judgment rests on (exact bottle / producer /",
    "category), and your confidence.",
    "",
    "Honesty: distinguish CRITIC scores from CROWD ratings; never invent scores, prices, or sources;",
    "'no data on this exact bottle' is fine AS LONG AS you give the producer/category read. Cite sources.",
    "Do not try to guess any local retail price — that will be supplied separately.",
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
