import { describe, it, expect } from "vitest";
import {
  priceDirection, pickLabel, thaiAnchorUsd, catalogPriceRangeThb, directionForThb, parseUsd,
  anchorThb, sortByPriceProximity,
} from "../src/recommend/priceMatch.js";
import { toCatalogItem, grapeTokens } from "../src/recommend/sources/catalog.js";

describe("priceDirection", () => {
  it("classifies by ratio", () => {
    expect(priceDirection(100, 50)).toBe("cheaper");   // 0.5
    expect(priceDirection(100, 100)).toBe("same");     // 1.0
    expect(priceDirection(100, 120)).toBe("same");     // 1.2 (≤1.25)
    expect(priceDirection(100, 200)).toBe("pricier");  // 2.0
  });
  it("returns 'unknown' when either side is null/zero", () => {
    expect(priceDirection(null, 50)).toBe("unknown");
    expect(priceDirection(100, null)).toBe("unknown");
    expect(priceDirection(0, 50)).toBe("unknown");
  });
});

describe("pickLabel", () => {
  it("cheaper → value regardless of quality (price gap never hidden)", () => {
    expect(pickLabel("cheaper", "similar")).toBe("value");
    expect(pickLabel("cheaper", "higher")).toBe("value");
    expect(pickLabel("cheaper", "lower")).toBe("value");
  });
  it("pricier + higher quality → upgrade", () => {
    expect(pickLabel("pricier", "higher")).toBe("upgrade");
  });
  it("same price, or pricier without a quality gain, or unknown → peer", () => {
    expect(pickLabel("same", "similar")).toBe("peer");
    expect(pickLabel("pricier", "similar")).toBe("peer");
    expect(pickLabel("pricier", "lower")).toBe("peer");
    expect(pickLabel("unknown", "similar")).toBe("peer");
  });
});

describe("thaiAnchorUsd", () => {
  it("scales world price by the Thai import multiplier", () => {
    expect(thaiAnchorUsd(20)).toBeCloseTo(48); // 20 × 2.4
    expect(thaiAnchorUsd(null)).toBeNull();
    expect(thaiAnchorUsd(0)).toBeNull();
  });
});

describe("catalogPriceRangeThb", () => {
  it("returns a wide THB corridor when marketUsd is known", () => {
    const r = catalogPriceRangeThb(20)!;
    expect(r.minThb).toBeGreaterThan(0);
    expect(r.maxThb).toBeGreaterThan(r.minThb);
  });
  it("returns null when marketUsd is unknown", () => {
    expect(catalogPriceRangeThb(null)).toBeNull();
  });
});

describe("directionForThb", () => {
  it("compares a THB candidate against the Thai-adjusted anchor", () => {
    // anchor world $20 → Thai anchor $48 ≈ ฿1714. A ฿700 bottle ≈ $19.6 → ratio ~0.41 → cheaper.
    expect(directionForThb(20, 700)).toBe("cheaper");
    // ฿1700 ≈ $47.6 → ratio ~0.99 → same.
    expect(directionForThb(20, 1700)).toBe("same");
    expect(directionForThb(null, 700)).toBe("unknown");
    expect(directionForThb(20, null)).toBe("unknown");
  });
});

describe("parseUsd", () => {
  it("extracts a USD number from an approx-price string", () => {
    expect(parseUsd("~$25")).toBe(25);
    expect(parseUsd("$1,200")).toBe(1200);
    expect(parseUsd("around 18 USD")).toBe(18);
    expect(parseUsd("n/a")).toBeNull();
  });
});

describe("anchorThb", () => {
  it("returns the Thai-market anchor in THB, null when unknown", () => {
    expect(anchorThb(20)).toBeGreaterThan(0);   // 20 × 2.4 USD, converted to THB
    expect(anchorThb(null)).toBeNull();
    expect(anchorThb(0)).toBeNull();
  });
});

describe("sortByPriceProximity", () => {
  it("orders by closeness to the anchor THB, price-less last", () => {
    const items = [
      { priceThb: 3000 }, { priceThb: 1000 }, { priceThb: null }, { priceThb: 1600 },
    ];
    const sorted = sortByPriceProximity(items, 1500);
    expect(sorted.map((i) => i.priceThb)).toEqual([1600, 1000, 3000, null]);
  });
  it("leaves order unchanged when anchor is unknown", () => {
    const items = [{ priceThb: 3000 }, { priceThb: 1000 }];
    expect(sortByPriceProximity(items, null)).toEqual(items);
  });
});

describe("grapeTokens", () => {
  it("splits a blend into core grapes, drops colour words, adds synonyms", () => {
    const toks = grapeTokens("Garnacha Negra, Carignan, Merlot");
    expect(toks).toContain("garnacha");
    expect(toks).toContain("carignan");
    expect(toks).toContain("merlot");
    expect(toks).toContain("grenache");   // garnacha synonym
    expect(toks).not.toContain("negra");  // colour qualifier dropped
  });
  it("expands a single grape to its synonyms", () => {
    expect(grapeTokens("Grenache")).toContain("garnacha");
    expect(grapeTokens("Shiraz")).toContain("syrah");
  });
  it("returns [] for empty/unknown grape", () => {
    expect(grapeTokens("")).toEqual([]);
    expect(grapeTokens("   ")).toEqual([]);
  });
});

describe("toCatalogItem", () => {
  it("maps a wine_items row, coalescing nulls", () => {
    const it = toCatalogItem({
      name: "Errazuriz Max Reserva", supplier_name: "IWS", grape_variety: "Cabernet Sauvignon",
      country: "Chile", region: "Aconcagua", year: 2021, price: 1200, vivino_rating: 4.1,
    });
    expect(it).toEqual({
      name: "Errazuriz Max Reserva", supplier: "IWS", grape: "Cabernet Sauvignon",
      country: "Chile", region: "Aconcagua", year: 2021, priceThb: 1200, vivinoRating: 4.1,
    });
  });
  it("coalesces null text fields to empty string", () => {
    const it = toCatalogItem({ name: "X", supplier_name: null, grape_variety: null, country: null, region: null, year: null, price: null, vivino_rating: null });
    expect(it).toEqual({ name: "X", supplier: "", grape: "", country: "", region: "", year: null, priceThb: null, vivinoRating: null });
  });
});
