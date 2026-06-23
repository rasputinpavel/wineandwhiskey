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
  dataConfidence: "high",
  sources: ["https://a.com", "https://b.com"],
};

describe("shortVerdict", () => {
  it("includes name, bottom line, and is compact", () => {
    const s = shortVerdict(verdict, "en");
    expect(s).toContain("Test");
    expect(s).toContain("take it");
    expect(s.split("\n").length).toBeLessThanOrEqual(6);
  });
  it("does not show a critic score when consensus is null", () => {
    const s = shortVerdict({ ...verdict, criticConsensus: null, criticCount: 0 }, "en");
    expect(s).not.toMatch(/\b\d{2}\/100\b/);
  });
  it("renders Russian labels", () => {
    expect(shortVerdict(verdict, "ru")).toMatch(/[Ѐ-ӿ]/);
  });
});

describe("fullCard", () => {
  it("lists sources and tasting notes", () => {
    const c = fullCard(verdict, "en");
    expect(c).toContain("https://a.com");
    expect(c).toContain("dark fruit");
    expect(c).toContain("Excellent value");
  });
  it("states when data is thin instead of inventing", () => {
    const thin = fullCard({ ...verdict, criticConsensus: null, qpr: null, communityNote: "", sources: [], dataConfidence: "low" }, "en");
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
