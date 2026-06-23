import { describe, it, expect } from "vitest";
import { localPriceVerdict, thbToUsd, usdToThb } from "../src/priceLocal.js";

describe("localPriceVerdict", () => {
  it("rates a cheap local price on a good wine and compares to world market", () => {
    const s = localPriceVerdict(90, 15, 450, "en"); // ฿450 ≈ $12.6, market $15
    expect(s).toMatch(/At ฿450/);
    expect(s).toMatch(/\d\/10/);
    expect(s.toLowerCase()).toContain("world price");
    expect(s.toLowerCase()).toContain("below world market");
  });
  it("flags a price well above world market", () => {
    const s = localPriceVerdict(88, 15, 1200, "en"); // ฿1200 ≈ $33.6 vs $15
    expect(s.toLowerCase()).toContain("above world market");
  });
  it("renders Russian", () => {
    expect(localPriceVerdict(90, 15, 450, "ru")).toMatch(/[Ѐ-ӿ]/);
  });
  it("says so when there is no quality/market basis", () => {
    const s = localPriceVerdict(null, null, 450, "en");
    expect(s.toLowerCase()).toContain("not enough");
  });
  it("round-trips THB/USD roughly", () => {
    expect(usdToThb(10)).toBeGreaterThan(300);
    expect(thbToUsd(usdToThb(10))).toBeCloseTo(10, 0);
  });
});
