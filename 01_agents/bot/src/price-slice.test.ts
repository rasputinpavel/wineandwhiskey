import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  rememberSlice, recallSlice, forgetSlice, SLICE_TTL_MS, parsePriceCaption,
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

describe("parsePriceCaption", () => {
  it("ловит /price — команды в подписях телеграм не разбирает, поэтому это наш путь", () => {
    expect(parsePriceCaption("/price найди все шардоне")).toBe("найди все шардоне");
  });

  it("ловит /price@имя_бота (в группах телеграм дописывает имя)", () => {
    expect(parsePriceCaption("/price@wwbot все шардоне")).toBe("все шардоне");
  });

  it("ловит слово «прайс» с любым разделителем", () => {
    expect(parsePriceCaption("прайс: все шардоне")).toBe("все шардоне");
    expect(parsePriceCaption("прайс все шардоне")).toBe("все шардоне");
    expect(parsePriceCaption("Прайс — шардоне до 600")).toBe("шардоне до 600");
  });

  it("триггер без запроса — пустая строка, а не null", () => {
    expect(parsePriceCaption("/price")).toBe("");
    expect(parsePriceCaption("прайс")).toBe("");
  });

  it("не цепляет слово, которое лишь начинается на «прайс»", () => {
    expect(parsePriceCaption("прайсовая ведомость за июль")).toBeNull();
  });

  it("чужая подпись — null, файл уходит в PO-сканер как раньше", () => {
    expect(parsePriceCaption("счёт от поставщика")).toBeNull();
    expect(parsePriceCaption("")).toBeNull();
    expect(parsePriceCaption(undefined)).toBeNull();
  });
});
