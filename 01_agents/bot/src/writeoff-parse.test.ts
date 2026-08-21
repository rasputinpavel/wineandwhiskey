import { describe, it, expect } from "vitest";
import { hasWriteoffTrigger, parseWriteoffJSON, scoreCandidates } from "./writeoff-parse.js";

describe("hasWriteoffTrigger", () => {
  it("matches write-off phrases anywhere, case-insensitive", () => {
    expect(hasWriteoffTrigger("спиши просекко 2")).toBe(true);
    expect(hasWriteoffTrigger("Взяли себе бутылку Beluga")).toBe(true);
    expect(hasWriteoffTrigger("списание: 1 Whispering Angel")).toBe(true);
    expect(hasWriteoffTrigger("СПИСАЛ два просекко")).toBe(true);
  });
  it("does not match a plain expense or a normal question", () => {
    expect(hasWriteoffTrigger("856 интернет")).toBe(false);
    expect(hasWriteoffTrigger("сколько виски на складе?")).toBe(false);
  });
  it("does not fire on words that merely contain a trigger as a substring", () => {
    expect(hasWriteoffTrigger("расписание смен на неделю")).toBe(false);
    expect(hasWriteoffTrigger("какая себестоимость у этого вина?")).toBe(false);
    expect(hasWriteoffTrigger("дай список вин")).toBe(false);
  });
  it("matches whole-word себе and common списать inflections", () => {
    expect(hasWriteoffTrigger("взяли себе бутылку")).toBe(true);
    expect(hasWriteoffTrigger("спишите 3 просекко")).toBe(true);
  });
});

describe("parseWriteoffJSON", () => {
  it("parses query + qty", () => {
    expect(parseWriteoffJSON('{"query":"Prosecco Miravento","qty":2}')).toEqual({
      query: "Prosecco Miravento", qty: 2,
    });
  });
  it("defaults qty to 1 and strips markdown fences", () => {
    expect(parseWriteoffJSON('```json\n{"query":"Beluga"}\n```')).toEqual({
      query: "Beluga", qty: 1,
    });
  });
  it("returns null on empty query or invalid JSON", () => {
    expect(parseWriteoffJSON('{"query":"","qty":3}')).toBeNull();
    expect(parseWriteoffJSON("not json")).toBeNull();
  });
  it("clamps a fractional qty up to at least 1", () => {
    expect(parseWriteoffJSON('{"query":"Beluga","qty":0.4}')).toEqual({ query: "Beluga", qty: 1 });
  });
});

const CATALOG = [
  { variant_id: "v1", item_name: "Prosecco Miravento DOC", in_stock: 12 },
  { variant_id: "v2", item_name: "Whispering Angel Rosé", in_stock: 4 },
  { variant_id: "v3", item_name: "Beluga Noble Vodka", in_stock: 7 },
  { variant_id: "v4", item_name: "Prosecco Valdobbiadene Superiore", in_stock: 3 },
];

describe("scoreCandidates", () => {
  it("ranks the closest name first", () => {
    const res = scoreCandidates("miravento", CATALOG);
    expect(res[0].variant_id).toBe("v1");
  });
  it("returns multiple candidates when the query is ambiguous (token match)", () => {
    const res = scoreCandidates("prosecco", CATALOG);
    const ids = res.map((c) => c.variant_id);
    expect(ids).toContain("v1");
    expect(ids).toContain("v4");
  });
  it("returns empty when nothing matches any token", () => {
    expect(scoreCandidates("tequila", CATALOG)).toEqual([]);
  });
  it("is case- and spacing-insensitive", () => {
    expect(scoreCandidates("  WHISPERING   angel ", CATALOG)[0].variant_id).toBe("v2");
  });
});
