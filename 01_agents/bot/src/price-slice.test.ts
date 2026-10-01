import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  rememberSlice, recallSlice, forgetSlice, SLICE_TTL_MS,
} from "./price-slice.js";

const ITEMS = [{ name: "A", price: 1 }];

beforeEach(() => {
  vi.useFakeTimers();
  forgetSlice(1);
});
afterEach(() => vi.useRealTimers());

describe("кэш разобранного прайса", () => {
  it("возвращает свежую запись", () => {
    rememberSlice(1, { items: ITEMS, supplier: "Janhom", messageId: 42 });
    expect(recallSlice(1)?.supplier).toBe("Janhom");
    expect(recallSlice(1)?.messageId).toBe(42);
  });

  it("не отдаёт просроченную запись", () => {
    rememberSlice(1, { items: ITEMS, supplier: "Janhom", messageId: 42 });
    vi.advanceTimersByTime(SLICE_TTL_MS + 1);
    expect(recallSlice(1)).toBeNull();
  });

  it("чаты не видят кэш друг друга", () => {
    rememberSlice(1, { items: ITEMS, supplier: "A", messageId: 1 });
    expect(recallSlice(2)).toBeNull();
  });

  it("forgetSlice убирает запись", () => {
    rememberSlice(1, { items: ITEMS, supplier: "A", messageId: 1 });
    forgetSlice(1);
    expect(recallSlice(1)).toBeNull();
  });
});
