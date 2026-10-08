import { describe, it, expect } from "vitest";
import { describeError, isIgnorableTelegramError } from "./errors.js";

describe("describeError", () => {
  it("keeps the HTTP status and message of an SDK error", () => {
    const e = Object.assign(new Error("invalid x-api-key"), {
      status: 401,
      name:   "AuthenticationError",
    });
    const s = describeError(e);
    expect(s).toContain("401");
    expect(s).toContain("AuthenticationError");
    expect(s).toContain("invalid x-api-key");
  });

  it("reports a plain runtime error", () => {
    const s = describeError(new TypeError("Cannot read properties of undefined (reading 'endsWith')"));
    expect(s).toContain("TypeError");
    expect(s).toContain("endsWith");
  });

  it("never leaks a secret that leaked into the message", () => {
    const token = "8761359622:AAH-fake-token-value-for-the-test-01234";
    const e = new Error(`request to https://api.telegram.org/bot${token}/getFile failed`);
    const s = describeError(e, [token]);
    expect(s).not.toContain(token);
    expect(s).toContain("***");
  });

  it("redacts an api key even when it was not passed in", () => {
    const e = new Error("bad key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 rejected");
    const s = describeError(e);
    expect(s).not.toContain("sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
    expect(s).toContain("***");
  });

  it("truncates a long message", () => {
    const s = describeError(new Error("x".repeat(1000)));
    expect(s.length).toBeLessThanOrEqual(300);
  });

  it("survives a thrown non-error", () => {
    expect(describeError("боль")).toContain("боль");
    expect(describeError(undefined)).not.toHaveLength(0);
  });
});

describe("isIgnorableTelegramError", () => {
  it("ignores the edit that changes nothing — it used to crash the whole bot", () => {
    const e = Object.assign(new Error("Call to 'editMessageText' failed!"), {
      error_code:  400,
      description: "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
    });
    expect(isIgnorableTelegramError(e)).toBe(true);
  });

  it("matches it by message text too", () => {
    expect(isIgnorableTelegramError(new Error("400: Bad Request: message is not modified: ..."))).toBe(true);
  });

  it("does not ignore a real failure", () => {
    const e = Object.assign(new Error("Call to 'sendMessage' failed!"), {
      error_code:  403,
      description: "Forbidden: bot was kicked from the group chat",
    });
    expect(isIgnorableTelegramError(e)).toBe(false);
    expect(isIgnorableTelegramError(new TypeError("fetch failed"))).toBe(false);
  });
});
