import { describe, it, expect } from "vitest";
import { bestFuzzyKey } from "../src/cache.js";

describe("bestFuzzyKey", () => {
  const keys = [
    "cellers grifoll declara predicat 2021",
    "montgras day one 2020",
    "chateau x 2018",
  ];

  it("bridges one-character OCR noise within the same vintage", () => {
    // "cellars" (a-typo) should map to the stored "cellers" row.
    expect(bestFuzzyKey("cellars grifoll declara predicat 2021", keys)).toBe(
      "cellers grifoll declara predicat 2021",
    );
  });

  it("never merges different vintages of the same wine", () => {
    // 2019 vs stored 2018 — one digit apart, high char-similarity, but years differ → no match.
    expect(bestFuzzyKey("chateau x 2019", keys)).toBeNull();
  });

  it("returns null when nothing clears the threshold", () => {
    expect(bestFuzzyKey("penfolds bin 28 2019", keys)).toBeNull();
  });

  it("ignores the exact key itself (exact hits are handled before fuzzy)", () => {
    expect(bestFuzzyKey("montgras day one 2020", keys)).toBeNull();
  });
});
