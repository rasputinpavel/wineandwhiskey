import { describe, it, expect } from "vitest";
import { SessionStore } from "../src/session.js";
import type { Verdict } from "../src/types.js";

const v = { bottomLine: "x" } as Verdict;

describe("SessionStore", () => {
  it("stores and retrieves a verdict by chat id", () => {
    const s = new SessionStore(1000, () => 1000);
    s.setVerdict(42, v);
    expect(s.getVerdict(42)).toBe(v);
  });
  it("returns undefined after TTL expiry", () => {
    let now = 1000;
    const s = new SessionStore(500, () => now);
    s.setVerdict(42, v);
    now = 1600;
    expect(s.getVerdict(42)).toBeUndefined();
  });
  it("returns undefined for unknown chats", () => {
    const s = new SessionStore(1000, () => 1000);
    expect(s.getVerdict(99)).toBeUndefined();
  });
});
