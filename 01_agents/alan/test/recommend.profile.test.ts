import { describe, it, expect } from "vitest";
import { buildProfile, normalizeType } from "../src/recommend/profile.js";
import { toStockItem } from "../src/recommend/sources/stock.js";
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

describe("toStockItem", () => {
  it("maps a v_sku_breakdown row, coalescing nulls", () => {
    const it = toStockItem({
      name: "Baron Philippe Cab Sauv", grape_variety: "Cabernet Sauvignon",
      wine_country: "Chile", default_price: 890, wine_color: "red", on_hand: 6,
    });
    expect(it).toEqual({ name: "Baron Philippe Cab Sauv", grape: "Cabernet Sauvignon", country: "Chile", priceThb: 890 });
  });
  it("coalesces null grape/country to empty string", () => {
    const it = toStockItem({ name: "X", grape_variety: null, wine_country: null, default_price: null, wine_color: "white", on_hand: 1 });
    expect(it).toEqual({ name: "X", grape: "", country: "", priceThb: null });
  });
});
