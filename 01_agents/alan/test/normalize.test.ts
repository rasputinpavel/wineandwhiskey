import { describe, it, expect } from "vitest";
import { toHundred, bayesianAggregate } from "../src/normalize.js";
import type { CriticScore } from "../src/types.js";

describe("toHundred", () => {
  it("passes through 100-pt", () => {
    expect(toHundred({ source: "x", rawScore: 92, scale: "100pt" })).toBe(92);
  });
  it("converts 20-pt by ×5", () => {
    expect(toHundred({ source: "x", rawScore: 18, scale: "20pt" })).toBe(90);
    expect(toHundred({ source: "x", rawScore: 19, scale: "20pt" })).toBe(95);
  });
  it("maps 5-star onto 80–100", () => {
    expect(toHundred({ source: "x", rawScore: 5, scale: "5star" })).toBe(100);
    expect(toHundred({ source: "x", rawScore: 4, scale: "5star" })).toBe(80);
    expect(toHundred({ source: "x", rawScore: 3, scale: "5star" })).toBe(60);
  });
});

describe("bayesianAggregate", () => {
  it("returns null for no scores", () => {
    expect(bayesianAggregate([])).toBeNull();
  });
  it("pulls a single extreme score toward the prior", () => {
    const scores: CriticScore[] = [{ source: "a", rawScore: 99, scale: "100pt" }];
    expect(bayesianAggregate(scores)).toBe(92);
  });
  it("converges toward the mean as evidence accumulates", () => {
    const scores: CriticScore[] = [
      { source: "a", rawScore: 95, scale: "100pt" },
      { source: "b", rawScore: 93, scale: "100pt" },
      { source: "c", rawScore: 94, scale: "100pt" },
      { source: "d", rawScore: 96, scale: "100pt" },
      { source: "e", rawScore: 95, scale: "100pt" },
      { source: "f", rawScore: 94, scale: "100pt" },
    ];
    expect(bayesianAggregate(scores)).toBe(93);
  });
});
