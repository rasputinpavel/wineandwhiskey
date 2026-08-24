import { describe, it, expect } from "vitest";
import {
  hasWriteoffTrigger, parseWriteoffJSON, scoreCandidates, isConfident,
  buildWriteoffMessage, parseWriteoffFromMessage, buildWriteoffKeyboard, buildCandidatesKeyboard,
  ageLabel, formatPendingReminder,
} from "./writeoff-parse.js";

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
  it("matches the 'взяли себе' take-phrase and common списать inflections", () => {
    expect(hasWriteoffTrigger("взяли себе бутылку")).toBe(true);
    expect(hasWriteoffTrigger("спишите 3 просекко")).toBe(true);
  });
  it("does not fire on a bare 'себе' in an expense message", () => {
    expect(hasWriteoffTrigger("купил себе обед 200")).toBe(false);
    expect(hasWriteoffTrigger("такси до дома себе 150")).toBe(false);
  });
  it("fires on 'берём себе' / 'берем себе' phrasing", () => {
    expect(hasWriteoffTrigger("берём себе 2 просекко")).toBe(true);
    expect(hasWriteoffTrigger("берем себе бутылку")).toBe(true);
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

describe("isConfident", () => {
  it("is false for an empty list", () => {
    expect(isConfident([])).toBe(false);
  });
  it("is true for a single candidate", () => {
    expect(isConfident([{ variant_id: "v1", item_name: "X", in_stock: 1, score: 2 }])).toBe(true);
  });
  it("is true when the top score clears the runner-up by >=3", () => {
    expect(isConfident([
      { variant_id: "v1", item_name: "X", in_stock: 1, score: 6 },
      { variant_id: "v2", item_name: "Y", in_stock: 1, score: 2 },
    ])).toBe(true);
  });
  it("is false when the top two are close", () => {
    expect(isConfident([
      { variant_id: "v1", item_name: "X", in_stock: 1, score: 5 },
      { variant_id: "v2", item_name: "Y", in_stock: 1, score: 5 },
    ])).toBe(false);
  });
});

// Telegram delivers message.text without HTML bold tags, and with entities decoded
// back to plain characters — simulate both.
const asDelivered = (html: string) =>
  html.replace(/<\/?b>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

describe("write-off card round-trip", () => {
  it("parses back the fields it renders", () => {
    const card = { itemName: "Prosecco Miravento DOC", qty: 2, date: "21.08.2026" };
    const text = asDelivered(buildWriteoffMessage(card));
    expect(parseWriteoffFromMessage(text)).toEqual(card);
  });
  it("returns null for a non-card message", () => {
    expect(parseWriteoffFromMessage("сколько виски?")).toBeNull();
  });
  it("round-trips an item name containing an ampersand", () => {
    const card = { itemName: "Moët & Chandon Impérial", qty: 1, date: "21.08.2026" };
    const text = asDelivered(buildWriteoffMessage(card));
    expect(parseWriteoffFromMessage(text)).toEqual(card);
  });
});

describe("keyboards", () => {
  it("confirm keyboard carries the variant_id in callback data", () => {
    const kb = buildWriteoffKeyboard("v1");
    const flat = kb.inline_keyboard.flat();
    expect(flat.some((b: any) => b.callback_data === "wo_confirm:v1")).toBe(true);
    expect(flat.some((b: any) => b.callback_data === "wo_cancel")).toBe(true);
  });
  it("candidate keyboard carries qty + variant_id per row", () => {
    const kb = buildCandidatesKeyboard(
      [
        { variant_id: "v1", item_name: "Prosecco Miravento DOC", in_stock: 12, score: 5 },
        { variant_id: "v4", item_name: "Prosecco Valdobbiadene Superiore", in_stock: 3, score: 4 },
      ],
      2,
    );
    const flat = kb.inline_keyboard.flat();
    expect(flat.some((b: any) => b.callback_data === "wo_pick:2:v1")).toBe(true);
    expect(flat.some((b: any) => b.callback_data === "wo_pick:2:v4")).toBe(true);
  });
});

describe("ageLabel", () => {
  it("labels today / yesterday / N days", () => {
    expect(ageLabel("2026-08-21", "2026-08-21")).toBe("сегодня");
    expect(ageLabel("2026-08-20", "2026-08-21")).toBe("со вчера");
    expect(ageLabel("2026-08-16", "2026-08-21")).toBe("5 дней");
  });
});

describe("formatPendingReminder", () => {
  const rows = [
    { id: "a", item_name: "Prosecco Miravento DOC", qty: 2, taken_date: "2026-08-20", taken_by: "Grace", status: "pending" },
    { id: "b", item_name: "Whispering Angel Rosé", qty: 1, taken_date: "2026-08-18", taken_by: "Som", status: "pending" },
  ];
  it("lists all pending, oldest first, with age labels", () => {
    const out = formatPendingReminder(rows, "2026-08-21");
    expect(out).toContain("🍷");
    expect(out).toContain("2× Prosecco Miravento DOC");
    expect(out).toContain("со вчера");
    expect(out).toContain("1× Whispering Angel Rosé");
    expect(out).toContain("3 дня");
    // oldest (18th) listed before newer (20th)
    expect(out.indexOf("Whispering")).toBeLessThan(out.indexOf("Prosecco"));
    expect(out).toContain("/writeoffs");
  });
  it("returns empty string when nothing is pending", () => {
    expect(formatPendingReminder([], "2026-08-21")).toBe("");
  });
  it("HTML-escapes an ampersand in the item name (briefing is sent as HTML)", () => {
    const out = formatPendingReminder(
      [{ id: "c", item_name: "Moët & Chandon", qty: 1, taken_date: "2026-08-20", taken_by: "Grace", status: "pending" }],
      "2026-08-21",
    );
    expect(out).toContain("Moët &amp; Chandon");
    expect(out).not.toContain("Moët & Chandon");
  });
});
