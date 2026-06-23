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

  it("never invents sources or notes on thin evidence", () => {
    const v = assembleVerdict({
      ...base,
      criticScores: [], communityRating: null, priceObservations: [],
      tastingNotes: "", drinkingWindow: "", dataConfidence: "low", sources: [],
    });
    expect(v.criticConsensus).toBeNull();
    expect(v.qpr).toBeNull();
    expect(v.communityNote).toBe("");
    expect(v.sources).toEqual([]);
    expect(v.dataConfidence).toBe("low");
  });

  it("flags an overpriced wine in the bottom line", () => {
    const v = assembleVerdict({
      ...base,
      criticScores: [{ source: "Decanter", rawScore: 86, scale: "100pt" }],
      priceObservations: [{ amount: 80, currency: "USD", context: "avg" }],
    });
    expect(v.bottomLine).toBe("overpriced");
  });
});
