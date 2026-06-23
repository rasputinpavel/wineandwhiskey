import { describe, it, expect } from "vitest";
import { shortVerdict, fullCard, analoguesMessage } from "../src/format.js";
import type { Verdict, AnaloguesResult } from "../src/types.js";

const verdict: Verdict = {
  identity: { producer: "Test", name: "Red", vintage: "2018", region: "Rioja", grape: "Tempranillo", type: "red", idConfidence: "high" },
  criticConsensus: 92, criticCount: 3,
  communityNote: "4.1/5 (1200 reviews)",
  marketPrice: { amount: 15, currency: "USD", context: "avg" },
  qpr: { rating: 8, label: "Excellent value" },
  bottomLine: "take-value",
  tastingNotes: "dark fruit, soft tannins",
  drinkingWindow: "2024–2030",
  producerNote: "well-regarded family estate",
  categoryPositioning: "strong Rioja for the price",
  evidenceLevel: "exact",
  valueRead: "good",
  qualityScore: 92,
  marketUsd: 15,
  dataConfidence: "high",
  sources: ["https://a.com", "https://b.com"],
};

describe("shortVerdict", () => {
  it("includes name, bottom line, basis, and is compact", () => {
    const s = shortVerdict(verdict, "en");
    expect(s).toContain("Test");
    expect(s).toContain("take it");
    expect(s).toContain("Based on");
    expect(s.split("\n").length).toBeLessThanOrEqual(7);
  });
  it("shows positioning instead of a score when no critic consensus", () => {
    const s = shortVerdict({ ...verdict, criticConsensus: null, criticCount: 0, evidenceLevel: "producer" }, "en");
    expect(s).not.toMatch(/\b\d{2}\/100\b/);
    expect(s).toContain("well-regarded");
  });
  it("renders Russian labels", () => {
    expect(shortVerdict(verdict, "ru")).toMatch(/[Ѐ-ӿ]/);
  });
  it("invites a local baht price", () => {
    expect(shortVerdict(verdict, "ru")).toContain("батах");
  });
});

describe("fullCard", () => {
  it("lists producer, category, sources and tasting notes", () => {
    const c = fullCard(verdict, "en");
    expect(c).toContain("https://a.com");
    expect(c).toContain("dark fruit");
    expect(c).toContain("Excellent value");
    expect(c).toContain("well-regarded family estate");
    expect(c).toContain("strong Rioja for the price");
  });
  it("shows a qualitative value when there is no numeric QPR", () => {
    const c = fullCard({ ...verdict, qpr: null, criticConsensus: null, valueRead: "good" }, "en");
    expect(c.toLowerCase()).toContain("good price");
  });
  it("states when data is thin instead of inventing", () => {
    const thin = fullCard({ ...verdict, criticConsensus: null, qpr: null, communityNote: "", producerNote: "", categoryPositioning: "", sources: [], dataConfidence: "low", evidenceLevel: "none", valueRead: "unknown" }, "en");
    expect(thin.toLowerCase()).toContain("limited");
  });
  it("caps the source list to keep messages short", () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://src${i}.com`);
    const c = fullCard({ ...verdict, sources: many }, "en");
    const bullets = c.split("\n").filter((l) => l.startsWith("• ")).length;
    expect(bullets).toBeLessThanOrEqual(6);
  });
});

describe("analoguesMessage", () => {
  it("lists each analogue with its reason", () => {
    const a: AnaloguesResult = {
      forWine: "Test Red 2018",
      analogues: [
        { name: "Wine A", why: "same grape, similar price", approxPrice: "$14" },
        { name: "Wine B", why: "comparable body", approxPrice: "$17" },
      ],
      dataConfidence: "medium",
      sources: ["https://a.com"],
    };
    const m = analoguesMessage(a, "en");
    expect(m).toContain("Wine A");
    expect(m).toContain("same grape");
    expect(m).toContain("Wine B");
  });
});
