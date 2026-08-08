import { describe, it, expect } from "vitest";
import { parsePOJSON, toISODate, normalizeBuddhistDate, buildPOMessage, parsePOFromMessage, type POCard } from "./po-parse.js";

// Telegram returns message.text without the HTML bold tags — simulate that.
const asDelivered = (html: string) => html.replace(/<\/?b>/g, "");

describe("parsePOJSON", () => {
  it("parses a supplier PO", () => {
    const raw = '{"is_po": true, "supplier": "Harvest", "doc_number": "INV-8842", "order_date": "05.08.2026", "amount": "24500"}';
    expect(parsePOJSON(raw)).toEqual({
      supplier: "Harvest",
      docNumber: "INV-8842",
      orderDate: "05.08.2026",
      amount: "24500",
    });
  });

  it("strips markdown fences and currency noise from amount", () => {
    const raw = '```json\n{"is_po": true, "supplier": "Cigar Empire", "doc_number": "PO-1190", "order_date": "", "amount": "฿11,000"}\n```';
    expect(parsePOJSON(raw)).toEqual({
      supplier: "Cigar Empire",
      docNumber: "PO-1190",
      orderDate: "",
      amount: "11000",
    });
  });

  it("returns null when it is not a PO", () => {
    expect(parsePOJSON('{"is_po": false}')).toBeNull();
  });

  it("returns null when is_po is absent (safer default)", () => {
    expect(parsePOJSON('{"supplier": "X"}')).toBeNull();
  });

  it("returns null on garbage", () => {
    expect(parsePOJSON("not json")).toBeNull();
  });

  it("folds a Thai Buddhist-Era order date to Gregorian (HJ Winery)", () => {
    const raw = '{"is_po": true, "supplier": "HJ Winery", "doc_number": "HJ2608004", "order_date": "03.08.2569", "amount": "17800"}';
    expect(parsePOJSON(raw)?.orderDate).toBe("03.08.2026");
  });
});

describe("normalizeBuddhistDate", () => {
  it("converts a Buddhist-Era year to Gregorian", () => {
    expect(normalizeBuddhistDate("03.08.2569")).toBe("03.08.2026");
  });
  it("leaves a Gregorian date untouched", () => {
    expect(normalizeBuddhistDate("05.08.2026")).toBe("05.08.2026");
  });
  it("passes through empty or malformed input unchanged", () => {
    expect(normalizeBuddhistDate("")).toBe("");
    expect(normalizeBuddhistDate("5/8/26")).toBe("5/8/26");
  });
});

describe("toISODate", () => {
  it("converts DD.MM.YYYY to YYYY-MM-DD", () => {
    expect(toISODate("05.08.2026")).toBe("2026-08-05");
  });
  it("returns null for empty or malformed input", () => {
    expect(toISODate("")).toBeNull();
    expect(toISODate("5/8/26")).toBeNull();
  });
});

describe("buildPOMessage", () => {
  const base: POCard = {
    supplier: "Harvest",
    docNumber: "INV-8842",
    orderDate: "05.08.2026",
    receivedDate: "05.08.2026",
    amount: "24500",
    duplicate: false,
  };

  it("includes every field", () => {
    const msg = buildPOMessage(base);
    expect(msg).toContain("Harvest");
    expect(msg).toContain("INV-8842");
    expect(msg).toContain("05.08.2026");
    expect(msg).toContain("24500");
  });

  it("shows a duplicate warning only when flagged", () => {
    expect(buildPOMessage(base)).not.toContain("уже есть");
    expect(buildPOMessage({ ...base, duplicate: true })).toContain("уже есть");
  });
});

describe("parsePOFromMessage", () => {
  it("round-trips a card built by buildPOMessage", () => {
    const card: POCard = {
      supplier: "Italasia Trading",
      docNumber: "IV0326080074",
      orderDate: "03.08.2026",
      receivedDate: "06.08.2026",
      amount: "7049.16",
      duplicate: false,
    };
    expect(parsePOFromMessage(asDelivered(buildPOMessage(card)))).toEqual(card);
  });

  it("recovers the duplicate flag from the warning line", () => {
    const card: POCard = {
      supplier: "Harvest", docNumber: "INV-8842", orderDate: "05.08.2026",
      receivedDate: "06.08.2026", amount: "24500", duplicate: true,
    };
    expect(parsePOFromMessage(asDelivered(buildPOMessage(card)))).toEqual(card);
  });

  it("maps em-dash placeholders back to empty strings", () => {
    const card: POCard = {
      supplier: "", docNumber: "", orderDate: "",
      receivedDate: "06.08.2026", amount: "", duplicate: false,
    };
    expect(parsePOFromMessage(asDelivered(buildPOMessage(card)))).toEqual(card);
  });

  it("returns null on unrelated text", () => {
    expect(parsePOFromMessage("just some chat message")).toBeNull();
  });
});
