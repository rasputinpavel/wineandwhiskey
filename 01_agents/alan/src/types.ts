export type Lang = "ru" | "en";

export type Intent = "assess" | "analogues";

/** Normalized user input, language-detected, ready for the pipeline. */
export interface WineQuery {
  text: string;          // typed text, voice transcript, or photo caption ("" if none)
  imageBase64?: string;  // PNG/JPEG label photo, base64 (no data: prefix)
  imageMediaType?: "image/png" | "image/jpeg" | "image/webp";
  lang: Lang;
  intent: Intent;
}

export type BottomLine =
  | "take-value"     // good wine, strong price
  | "take-quality"   // good wine (price unknown/irrelevant)
  | "overpriced"     // not worth the asking price
  | "skip"           // unremarkable
  | "depends-ok"     // fine but not special
  | "nodata";        // not enough data to judge

export type CriticScale = "100pt" | "20pt" | "5star";

export type EvidenceLevel = "exact" | "producer" | "category" | "none";
export type ValueRead = "good" | "fair" | "steep" | "unknown";

export interface CriticScore {
  source: string;        // e.g. "Decanter", "James Suckling"
  rawScore: number;      // as published, on `scale`
  scale: CriticScale;
}

export interface CommunityRating {
  value: number;         // as published
  scale: "5star" | "100pt";
  count: number;         // number of reviews (0 if unknown)
}

export interface PriceObservation {
  amount: number;        // numeric
  currency: string;      // ISO-ish, e.g. "USD", "THB", "EUR"
  context: string;       // e.g. "Wine-Searcher average", "retailer X"
}

/** Raw, source-attributed evidence extracted from research. The model fills this;
 *  all scoring math happens in code (normalize.ts / qpr.ts / assess.ts). */
export interface WineEvidence {
  identity: {
    producer: string;
    name: string;
    vintage: string;     // "" if NV/unknown
    region: string;      // "" if unknown
    grape: string;       // "" if unknown
    type: string;        // "red" | "white" | "sparkling" | "rosé" | "fortified" | ""
    idConfidence: "high" | "medium" | "low";
  };
  criticScores: CriticScore[];
  communityRating: CommunityRating | null;
  priceObservations: PriceObservation[];
  tastingNotes: string;  // short, factual
  drinkingWindow: string; // "" if unknown
  producerNote: string;        // producer reputation / positioning ("" if unknown)
  categoryPositioning: string; // what this grape/region at this price typically delivers ("" if unknown)
  evidenceLevel: EvidenceLevel; // most specific tier the evidence actually supports
  valueRead: ValueRead;         // qualitative price read when no numeric QPR
  dataConfidence: "high" | "medium" | "low"; // overall confidence in the evidence
  sources: string[];     // URLs or named sources
}

export interface AnalogueItem {
  name: string;          // producer + wine
  why: string;           // one-line reasoning for the match
  approxPrice: string;   // "" if unknown
}

export interface AnaloguesResult {
  forWine: string;       // the wine we matched against
  analogues: AnalogueItem[];
  dataConfidence: "high" | "medium" | "low";
  sources: string[];
}

/** The honest verdict assembled deterministically from WineEvidence. */
export interface Verdict {
  identity: WineEvidence["identity"];
  criticConsensus: number | null;   // 0–100 Bayesian aggregate, null if no critics
  criticCount: number;
  communityNote: string;            // human phrasing of crowd signal, "" if none
  marketPrice: PriceObservation | null;
  qpr: { rating: number; label: string } | null; // 1–10 + label, null if price/quality missing
  bottomLine: BottomLine;           // localized for display in format.ts
  tastingNotes: string;
  drinkingWindow: string;
  producerNote: string;
  categoryPositioning: string;
  evidenceLevel: EvidenceLevel;
  valueRead: ValueRead;
  dataConfidence: WineEvidence["dataConfidence"];
  sources: string[];
}
