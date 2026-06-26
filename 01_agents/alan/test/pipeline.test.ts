import { describe, it, expect } from "vitest";
import { lacksVintageData, stripVintage } from "../src/pipeline.js";
import type { WineEvidence } from "../src/types.js";

const base: WineEvidence = {
  identity: { producer: "Gruber Röschitz", name: "Pinot Noir Ried Galgenberg", vintage: "2021", region: "Weinviertel", grape: "Pinot Noir", type: "red", idConfidence: "high" },
  criticScores: [],
  communityRating: null,
  priceObservations: [],
  tastingNotes: "",
  drinkingWindow: "",
  agingNote: "",
  producerNote: "",
  categoryPositioning: "",
  evidenceLevel: "none",
  valueRead: "unknown",
  priceTier: "unknown",
  punchline: "",
  dataConfidence: "low",
  sources: [],
};

describe("lacksVintageData", () => {
  it("is true when there are no critic scores, no crowd and no prices", () => {
    expect(lacksVintageData(base)).toBe(true);
  });
  it("is true even when there is producer/category prose (not vintage-specific)", () => {
    expect(lacksVintageData({ ...base, producerNote: "serious bio house", categoryPositioning: "cool-climate Pinot" })).toBe(true);
  });
  it("is false when there is at least one critic score", () => {
    expect(lacksVintageData({ ...base, criticScores: [{ source: "Decanter", rawScore: 89, scale: "100pt" }] })).toBe(false);
  });
  it("is false when there is a community rating", () => {
    expect(lacksVintageData({ ...base, communityRating: { value: 3.8, scale: "5star", count: 40 } })).toBe(false);
  });
  it("is false when there is a price observation", () => {
    expect(lacksVintageData({ ...base, priceObservations: [{ amount: 16, currency: "USD", context: "avg" }] })).toBe(false);
  });
});

describe("stripVintage", () => {
  it("removes the year token from a typed name", () => {
    expect(stripVintage("Gruber Roschitz Ried Galgenberg Pinot Noir 2021", "2021"))
      .toBe("Gruber Roschitz Ried Galgenberg Pinot Noir");
  });
  it("removes a year embedded mid-string and collapses whitespace", () => {
    expect(stripVintage("Chateau X 2018 Reserve", "2018")).toBe("Chateau X Reserve");
  });
  it("returns the text unchanged when no vintage is given", () => {
    expect(stripVintage("Chateau X Reserve", "")).toBe("Chateau X Reserve");
  });
  it("returns empty for empty text (photo-only query)", () => {
    expect(stripVintage("", "2021")).toBe("");
  });
});
