import { describe, it, expect } from "vitest";
import { buildProfile, normalizeType } from "../src/recommend/profile.js";
import type { Verdict } from "../src/types.js";

const verdict: Verdict = {
  identity: { producer: "MontGras", name: "Day One", vintage: "2020", region: "Colchagua", grape: "Cabernet Sauvignon", type: "red", idConfidence: "high" },
  criticConsensus: 90, criticCount: 2, communityNote: "", marketPrice: null,
  qpr: null, bottomLine: "take-quality", tastingNotes: "", drinkingWindow: "",
  agingNote: "", producerNote: "", categoryPositioning: "", evidenceLevel: "exact",
  valueRead: "good", priceTier: "mid", qualityScore: 90, marketUsd: 20,
  punchline: "", detail: "", dataConfidence: "high", sources: [],
};

describe("normalizeType", () => {
  it("maps rosé (accented) and rose to 'rose'", () => {
    expect(normalizeType("rosé")).toBe("rose");
    expect(normalizeType("Rose")).toBe("rose");
  });
  it("passes through known catalog types", () => {
    expect(normalizeType("red")).toBe("red");
    expect(normalizeType("SPARKLING")).toBe("sparkling");
  });
  it("returns '' for fortified/unknown (no type filter)", () => {
    expect(normalizeType("fortified")).toBe("");
    expect(normalizeType("")).toBe("");
  });
});

describe("buildProfile", () => {
  it("derives the match profile from a verdict", () => {
    const p = buildProfile(verdict);
    expect(p.label).toBe("MontGras Day One 2020");
    expect(p.type).toBe("red");
    expect(p.grape).toBe("Cabernet Sauvignon");
    expect(p.region).toBe("Colchagua");
    expect(p.qualityScore).toBe(90);
    expect(p.marketUsd).toBe(20);
  });
});
