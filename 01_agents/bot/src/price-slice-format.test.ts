import { describe, it, expect } from "vitest";
import {
  buildSliceCsv, formatSliceMessage, sliceFileName, bangkokIsoDate, type SliceRow,
} from "./price-slice-format.js";

function row(over: Partial<SliceRow>): SliceRow {
  return {
    producer: null, name: "Wine", region: null, country: null,
    year: null, price: null, volume: null, match: "explicit", note: null,
    ...over,
  };
}

describe("buildSliceCsv", () => {
  it("начинается с BOM и шапки, строки через CRLF", () => {
    const csv = buildSliceCsv([row({ producer: "Louis Jadot", name: "Bourgogne", price: 1180 })]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\r\n")[0]).toBe(
      "﻿производитель,название,регион,год,цена,объём,пометка");
    expect(csv.split("\r\n")[1]).toBe("Louis Jadot,Bourgogne,,,1180,,");
  });

  it("экранирует запятые и кавычки", () => {
    const csv = buildSliceCsv([row({ name: 'Wine, "Reserve"' })]);
    expect(csv).toContain('"Wine, ""Reserve"""');
  });

  it("цену пишет числом без разделителей разрядов", () => {
    const csv = buildSliceCsv([row({ price: 12450 })]);
    expect(csv).toContain(",12450,");
  });

  it("доборную строку помечает в колонке пометка", () => {
    const csv = buildSliceCsv([row({ match: "inferred", note: "Chablis" })]);
    expect(csv.trimEnd().endsWith("Chablis")).toBe(true);
  });

  it("пустой срез — только шапка", () => {
    expect(buildSliceCsv([]).split("\r\n").filter(Boolean)).toHaveLength(1);
  });
});

describe("formatSliceMessage", () => {
  const rows = Array.from({ length: 14 }, (_, i) =>
    row({ producer: `P${i}`, name: `Wine ${i}`, price: 400 + i * 100, country: "FR" }));

  it("показывает поставщика, счёт и вилку цен", () => {
    const msg = formatSliceMessage({
      supplier: "Janhom", priceListDate: "2026-09-12",
      rows, totalItems: 214, matched: 14, degraded: [], limit: 10,
    });
    expect(msg).toContain("Janhom");
    expect(msg).toContain("12.09.2026");
    expect(msg).toContain("14 позиций");
    expect(msg).toContain("฿400");
    expect(msg).toContain("฿1,700");
  });

  it("обрезает до limit и пишет остаток", () => {
    const msg = formatSliceMessage({
      supplier: "Janhom", priceListDate: null,
      rows, totalItems: 214, matched: 14, degraded: [], limit: 10,
    });
    expect(msg).toContain("Wine 9");
    expect(msg).not.toContain("Wine 10");
    expect(msg).toContain("ещё 4");
  });

  it("помечает доборные строки", () => {
    const msg = formatSliceMessage({
      supplier: "X", priceListDate: null, limit: 10, totalItems: 10, matched: 1, degraded: [],
      rows: [row({ name: "Chablis", match: "inferred", note: "Chablis" })],
    });
    expect(msg).toContain("◦ Chablis");
  });

  it("экранирует HTML в данных прайса", () => {
    const msg = formatSliceMessage({
      supplier: "A & B <Co>", priceListDate: null, limit: 10, totalItems: 1, matched: 1, degraded: [],
      rows: [row({ name: "Wine <1>" })],
    });
    expect(msg).toContain("A &amp; B &lt;Co&gt;");
    expect(msg).toContain("Wine &lt;1&gt;");
  });

  it("пустой срез объясняет, что прайс прочитан", () => {
    const msg = formatSliceMessage({
      supplier: "Janhom", priceListDate: null, rows: [],
      totalItems: 214, matched: 0, degraded: [], limit: 10,
    });
    expect(msg).toContain("ничего не нашёл");
    expect(msg).toContain("214");
  });

  it("сломавшийся шаг показывает честно", () => {
    const msg = formatSliceMessage({
      supplier: "X", priceListDate: null, limit: 10, totalItems: 5, matched: 1,
      degraded: ["добор по апелласьону"], rows: [row({})],
    });
    expect(msg).toContain("добор по апелласьону");
  });
});

describe("sliceFileName", () => {
  it("склеивает запрос, поставщика и дату", () => {
    expect(sliceFileName("все шардоне", "Janhom Wine", "2026-10-01"))
      .toBe("vse-shardone_janhom-wine_2026-10-01.csv");
  });

  it("подчищает мусорные символы", () => {
    expect(sliceFileName("шардоне < 600!", "A/B", "2026-10-01"))
      .toBe("shardone-600_a-b_2026-10-01.csv");
  });
});

describe("bangkokIsoDate", () => {
  it("отдаёт ISO-дату", () => {
    expect(bangkokIsoDate(Date.UTC(2026, 9, 1, 5, 0, 0))).toBe("2026-10-01");
  });

  it("учитывает смещение Бангкока (+7): поздний вечер UTC — уже следующий день", () => {
    expect(bangkokIsoDate(Date.UTC(2026, 9, 1, 18, 0, 0))).toBe("2026-10-02");
  });
});
