import { describe, it, expect } from "vitest";
import { qprRating } from "../src/qpr.js";

describe("qprRating", () => {
  it("rates a cheap high-scorer near the top", () => {
    const r = qprRating(92, 15)!;
    expect(r.rating).toBeGreaterThanOrEqual(8);
    expect(r.label).toBeTruthy();
  });
  it("rates an expensive mediocre wine near the bottom", () => {
    const r = qprRating(86, 60)!;
    expect(r.rating).toBeLessThanOrEqual(3);
  });
  it("does NOT punish a cheap, decently-rated wine (regression: $11 / crowd 4-star → 80)", () => {
    const r = qprRating(80, 11)!;
    expect(r.rating).toBeGreaterThanOrEqual(5);
  });
  it("clamps into the 1–10 range", () => {
    expect(qprRating(100, 5)!.rating).toBeLessThanOrEqual(10);
    expect(qprRating(80, 500)!.rating).toBeGreaterThanOrEqual(1);
  });
  it("treats a non-positive price as unknown (null)", () => {
    expect(qprRating(92, 0)).toBeNull();
    expect(qprRating(92, -5)).toBeNull();
  });
});
