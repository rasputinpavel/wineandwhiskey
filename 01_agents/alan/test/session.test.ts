import { describe, it, expect } from "vitest";
import { SessionStore } from "../src/session.js";
import type { Verdict } from "../src/types.js";

const v = { bottomLine: "x" } as Verdict;

describe("SessionStore", () => {
  it("stores and retrieves a verdict + lang by key", () => {
    const s = new SessionStore(1000, () => 1000);
    s.set(42, v, "ru");
    expect(s.get(42)).toEqual({ verdict: v, lang: "ru" });
  });
  it("returns undefined after TTL expiry", () => {
    let now = 1000;
    const s = new SessionStore(500, () => now);
    s.set(42, v, "en");
    now = 1600;
    expect(s.get(42)).toBeUndefined();
  });
  it("returns undefined for unknown keys", () => {
    const s = new SessionStore(1000, () => 1000);
    expect(s.get(99)).toBeUndefined();
  });
});
