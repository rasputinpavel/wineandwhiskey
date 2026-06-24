import { describe, it, expect } from "vitest";
import { localPriceVerdict, thbToUsd, usdToThb, estimateThaiThb } from "../src/priceLocal.js";

describe("localPriceVerdict", () => {
  it("rates a local price and compares to origin with Thai markup in mind", () => {
    const s = localPriceVerdict(90, 15, 900, "en"); // ฿900 ≈ $25.2 vs origin $15 → ×1.67 ≈ Thai-fair
    expect(s).toMatch(/At ฿900/);
    expect(s).toMatch(/\d\/10/);
    expect(s.toLowerCase()).toContain("origin");
    expect(s.toLowerCase()).toMatch(/thailand/);
  });
  it("flags a price steep even for Thailand", () => {
    const s = localPriceVerdict(88, 15, 2000, "en"); // ฿2000 ≈ $56 vs origin $15 → ×3.7
    expect(s.toLowerCase()).toContain("steep even for thailand");
  });
  it("calls a low markup a good deal for Thailand", () => {
    const s = localPriceVerdict(90, 15, 550, "en"); // ฿550 ≈ $15.4 vs origin $15 → ×1.0
    expect(s.toLowerCase()).toContain("good deal for thailand");
  });
  it("renders Russian", () => {
    expect(localPriceVerdict(90, 15, 900, "ru")).toMatch(/[Ѐ-ӿ]/);
  });
  it("says so when there is no basis", () => {
    expect(localPriceVerdict(null, null, 900, "en").toLowerCase()).toContain("not enough");
  });
  it("estimates a Thai range above origin", () => {
    const r = estimateThaiThb(15);
    expect(r.low).toBeLessThan(r.high);
    expect(r.low).toBeGreaterThan(usdToThb(15)); // always above bare origin
  });
  it("round-trips THB/USD", () => {
    expect(thbToUsd(usdToThb(10))).toBeCloseTo(10, 0);
  });
});
