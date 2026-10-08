import { describe, it, expect, vi } from "vitest";
import { withRetry, isTransient } from "./retry.js";

const aborted = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
const withStatus = (status: number) => Object.assign(new Error(`Loyverse ${status}: /receipts`), { status });

describe("isTransient", () => {
  it("retries an aborted request — that is the timeout we hit", () => {
    expect(isTransient(aborted())).toBe(true);
  });

  it("retries a network failure", () => {
    expect(isTransient(new TypeError("fetch failed"))).toBe(true);
    expect(isTransient(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(true);
  });

  it("retries throttling and server errors", () => {
    expect(isTransient(withStatus(429))).toBe(true);
    expect(isTransient(withStatus(502))).toBe(true);
  });

  it("does not retry a bad token or a bad request", () => {
    expect(isTransient(withStatus(401))).toBe(false);
    expect(isTransient(withStatus(400))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the first value without sleeping", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn, { sleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a transient failure and succeeds — one slow page no longer kills the call", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw aborted();
      return "page";
    });
    await expect(withRetry(fn, { sleep })).resolves.toBe("page");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("backs off exponentially between attempts", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn(async () => { throw aborted(); });
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1000, sleep })).rejects.toThrow(/aborted/);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("gives up after the last attempt and throws the final error", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn(async () => { throw aborted(); });
    await expect(withRetry(fn, { attempts: 2, sleep })).rejects.toThrow(/aborted/);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("fails fast on a non-transient error", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn(async () => { throw withStatus(401); });
    await expect(withRetry(fn, { sleep })).rejects.toThrow(/401/);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("reports every retry so the log says what was slow", async () => {
    const onRetry = vi.fn();
    let calls = 0;
    const fn = async () => { if (++calls === 1) throw aborted(); return 1; };
    await withRetry(fn, { sleep: async () => {}, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toBe(1);
  });
});
