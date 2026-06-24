import { describe, it, expect } from "vitest";
import { assembleVerdict } from "../src/assess.js";
import type { WineEvidence } from "../src/types.js";

const base: WineEvidence = {
  identity: { producer: "Test", name: "Red", vintage: "2018", region: "", grape: "", type: "red", idConfidence: "high" },
  criticScores: [
    { source: "Decanter", rawScore: 93, scale: "100pt" },
    { source: "Suckling", rawScore: 18, scale: "20pt" },
  ],
  communityRating: { value: 4.1, scale: "5star", count: 1200 },
  priceObservations: [{ amount: 15, currency: "USD", context: "avg" }],
  tastingNotes: "dark fruit, soft tannins",
  drinkingWindow: "2024–2030",
  agingNote: "Tempranillo выдерживается; 2018 в самой поре",
  producerNote: "well-regarded estate",
  categoryPositioning: "solid Rioja in this band",
  evidenceLevel: "exact",
  valueRead: "good",
  priceTier: "entry",
  punchline: "Берём, это рабочая лошадка.",
  dataConfidence: "high",
  sources: ["https://example.com"],
};

describe("assembleVerdict", () => {
  it("computes critic consensus and QPR for complete evidence", () => {
    const v = assembleVerdict(base);
    expect(v.criticConsensus).not.toBeNull();
    expect(v.criticCount).toBe(2);
    expect(v.qpr).not.toBeNull();
    expect(v.marketPrice?.currency).toBe("USD");
    expect(v.sources).toEqual(["https://example.com"]);
  });

  it("passes through cascade fields", () => {
    const v = assembleVerdict(base);
    expect(v.producerNote).toBe("well-regarded estate");
    expect(v.categoryPositioning).toBe("solid Rioja in this band");
    expect(v.evidenceLevel).toBe("exact");
    expect(v.valueRead).toBe("good");
    expect(v.priceTier).toBe("entry");
    expect(v.agingNote).toBe("Tempranillo выдерживается; 2018 в самой поре");
    expect(v.punchline).toBe("Берём, это рабочая лошадка.");
    expect(v.detail).toBe("");
  });

  it("omits QPR when no price is known", () => {
    const v = assembleVerdict({ ...base, priceObservations: [] });
    expect(v.qpr).toBeNull();
    expect(v.bottomLine).toBeTruthy();
  });

  it("omits critic consensus when there are no critics", () => {
    const v = assembleVerdict({ ...base, criticScores: [] });
    expect(v.criticConsensus).toBeNull();
    expect(v.criticCount).toBe(0);
  });

  it("gives a real take from producer/category context when numbers are absent", () => {
    const v = assembleVerdict({
      ...base,
      criticScores: [], communityRating: null, priceObservations: [],
      evidenceLevel: "producer", valueRead: "good",
      producerNote: "respected grower", categoryPositioning: "classic dry Riesling",
    });
    expect(v.bottomLine).toBe("take-value");   // not "nodata"
    expect(v.qpr).toBeNull();
  });

  it("returns nodata only when truly nothing is known", () => {
    const v = assembleVerdict({
      ...base,
      criticScores: [], communityRating: null, priceObservations: [],
      tastingNotes: "", drinkingWindow: "", producerNote: "", categoryPositioning: "",
      evidenceLevel: "none", valueRead: "unknown", dataConfidence: "low", sources: [],
    });
    expect(v.bottomLine).toBe("nodata");
    expect(v.criticConsensus).toBeNull();
    expect(v.qpr).toBeNull();
  });

  it("flags an overpriced wine in the bottom line", () => {
    const v = assembleVerdict({
      ...base,
      criticScores: [{ source: "Decanter", rawScore: 86, scale: "100pt" }],
      priceObservations: [{ amount: 80, currency: "USD", context: "avg" }],
      valueRead: "steep",
    });
    expect(v.bottomLine).toBe("overpriced");
  });
});
