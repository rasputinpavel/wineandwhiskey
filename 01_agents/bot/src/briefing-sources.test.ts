import { describe, it, expect, vi } from "vitest";
import {
  sourceValue, sourceValueOr, criticalSource, BriefingDataError, formatBriefingFailure, NO_DATA,
} from "./briefing-sources.js";

const ok  = <T>(value: T): PromiseSettledResult<T> => ({ status: "fulfilled", value });
const bad = (message: string): PromiseSettledResult<any> =>
  ({ status: "rejected", reason: Object.assign(new Error(message), { name: "AbortError" }) });

describe("sourceValue", () => {
  it("passes a loaded source through", () => {
    expect(sourceValue(ok("Выручка: 13216 THB"), "остатки")).toBe("Выручка: 13216 THB");
  });

  it("degrades a failed source instead of killing the briefing", () => {
    expect(sourceValue(bad("This operation was aborted"), "остатки")).toBe(NO_DATA);
  });

  it("tells the log which source was lost and why", () => {
    const onFail = vi.fn();
    sourceValue(bad("This operation was aborted"), "остатки", onFail);
    expect(onFail).toHaveBeenCalledTimes(1);
    const [label, reason] = onFail.mock.calls[0];
    expect(label).toBe("остатки");
    expect(String(reason)).toMatch(/aborted/);
  });
});

describe("sourceValueOr", () => {
  it("keeps a loaded list", () => {
    expect(sourceValueOr(ok([{ name: "Harvest" }]), "календарь платежей", [])).toHaveLength(1);
  });

  it("falls back to an empty list when the source is down", () => {
    expect(sourceValueOr(bad("This operation was aborted"), "календарь платежей", [])).toEqual([]);
  });
});

describe("criticalSource", () => {
  it("passes yesterday's sales through", () => {
    expect(criticalSource(ok("Чеков: 13"), "продажи за вчера")).toBe("Чеков: 13");
  });

  it("refuses to invent a briefing when yesterday's sales are missing", () => {
    expect(() => criticalSource(bad("This operation was aborted"), "продажи за вчера"))
      .toThrow(BriefingDataError);
  });

  it("names the source and the reason in the error", () => {
    try {
      criticalSource(bad("This operation was aborted"), "продажи за вчера");
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain("продажи за вчера");
      expect((e as Error).message).toMatch(/aborted/);
    }
  });
});

describe("formatBriefingFailure", () => {
  it("says the briefing did not happen and why — in the chat, not only in the Railway log", () => {
    const text = formatBriefingFailure(new BriefingDataError("продажи за вчера: AbortError: This operation was aborted"));
    expect(text).toMatch(/брифинг/i);
    expect(text).toContain("продажи за вчера");
    expect(text).not.toMatch(/<[^>]+>/);
  });

  it("does not stutter the error name of our own BriefingDataError", () => {
    const text = formatBriefingFailure(new BriefingDataError("продажи за вчера: Error HTTP 401: Loyverse 401: /receipts"));
    expect(text).not.toContain("BriefingDataError");
    expect(text).toContain("продажи за вчера");
  });

  it("survives a non-error being thrown", () => {
    expect(formatBriefingFailure("боль")).toContain("боль");
  });

  it("never leaks a token that leaked into the message", () => {
    const token = "8761359622:AAH-fake-token-value-for-the-test-01234";
    expect(formatBriefingFailure(new Error(`auth failed for ${token}`))).not.toContain(token);
  });
});
