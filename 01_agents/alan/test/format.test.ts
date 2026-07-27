import { describe, it, expect } from "vitest";
import { shortVerdict, fullCard, analoguesMessage, typeEmoji } from "../src/format.js";
import type { Verdict, AnaloguesResult } from "../src/types.js";
import { recommendationsMessage } from "../src/format.js";
import type { Recommendations } from "../src/recommend/types.js";

const verdict: Verdict = {
  identity: { producer: "Pitars", name: "Genesi", vintage: "", region: "Friuli-Venezia Giulia", grape: "Glera", type: "sparkling", idConfidence: "high" },
  criticConsensus: null, criticCount: 0,
  communityNote: "3.9/5 (1200 reviews)",
  marketPrice: { amount: 6.5, currency: "USD", context: "avg" },
  qpr: { rating: 9, label: "Outstanding value" },
  bottomLine: "take-value",
  tastingNotes: "honest commercial fizz",
  drinkingWindow: "drink now",
  agingNote: "Glera — пьётся молодым; 2023 в поре",
  producerNote: "Pitars — solid commercial house, not cult",
  categoryPositioning: "entry Prosecco DOC Extra Dry",
  evidenceLevel: "producer",
  valueRead: "good",
  priceTier: "entry",
  qualityScore: 84,
  marketUsd: 6.5,
  punchline: "Пятничный пузырь, не event — но берём.",
  detail: "Сорт × страна: Glera = Просекко.\nВердикт. Берём.",
  dataConfidence: "high",
  sources: ["https://a.com", "https://b.com"],
};

describe("shortVerdict (summary)", () => {
  it("shows title, grape/region, origin USD, segment and the punchline", () => {
    const s = shortVerdict(verdict, "ru");
    expect(s).toContain("Pitars Genesi");
    expect(s).toContain("Glera, Friuli-Venezia Giulia");
    expect(s).toContain("6.5 USD");
    expect(s).toContain("входной уровень");
    expect(s).toContain("Пятничный пузырь");
    expect(s).toContain("батах"); // local price invite
  });
  it("shows the aging conclusion", () => {
    expect(shortVerdict(verdict, "ru")).toContain("пьётся молодым");
  });
  it("shows 'no critic scores' when consensus is null and crowd otherwise", () => {
    const s = shortVerdict(verdict, "ru");
    expect(s).toContain("оценок критиков не найдено");
    expect(s).toContain("Толпа (Vivino): 3.9/5");
  });
  it("warns when the read is a vintage fallback, naming the dropped year", () => {
    const s = shortVerdict({ ...verdict, vintageFallback: "2021" }, "ru");
    expect(s).toContain("2021");
    expect(s).toContain("вино в целом");
  });
  it("shows no vintage warning on a normal verdict", () => {
    expect(shortVerdict(verdict, "ru")).not.toContain("вино в целом");
  });
});

describe("typeEmoji", () => {
  it("maps each wine type to a glyph, red as the default", () => {
    expect(typeEmoji("red")).toBe("🍷");
    expect(typeEmoji("white")).toBe("🥂");
    expect(typeEmoji("sparkling")).toBe("🍾");
    expect(typeEmoji("rosé")).toBe("🌸");
    expect(typeEmoji("")).toBe("🍷");
    expect(typeEmoji("something-weird")).toBe("🍷");
  });
});

describe("shortVerdict color", () => {
  const white: Verdict = {
    ...verdict,
    identity: { ...verdict.identity, type: "white", grape: "Sauvignon Blanc", region: "Pessac-Léognan" },
  };
  it("leads with the type emoji, not a hardcoded red glass", () => {
    expect(shortVerdict(white, "ru").startsWith("🥂")).toBe(true);
  });
  it("names the color in the subtitle so a white is never read as red", () => {
    const s = shortVerdict(white, "ru");
    expect(s).toContain("Белое");
    expect(s).toContain("Sauvignon Blanc, Pessac-Léognan");
  });
  it("uses the English color word for en", () => {
    expect(shortVerdict(white, "en")).toContain("White");
  });
});

describe("fullCard (details)", () => {
  it("returns the ladder brief plus sources when detail is present", () => {
    const c = fullCard(verdict, "ru");
    expect(c).toContain("Сорт × страна");
    expect(c).toContain("Вердикт. Берём.");
    expect(c).toContain("https://a.com");
  });
  it("falls back to a structured card when there is no brief", () => {
    const c = fullCard({ ...verdict, detail: "" }, "ru");
    expect(c).toContain("Pitars Genesi");
    expect(c).toContain("Производитель:");
  });
});

describe("analoguesMessage", () => {
  it("lists each analogue with its reason", () => {
    const a: AnaloguesResult = {
      forWine: "Pitars Genesi",
      analogues: [
        { name: "Wine A", why: "same style, similar price", approxPrice: "$7" },
        { name: "Wine B", why: "comparable fizz", approxPrice: "$8" },
      ],
      dataConfidence: "medium",
      sources: ["https://a.com"],
    };
    const m = analoguesMessage(a, "en");
    expect(m).toContain("Wine A");
    expect(m).toContain("same style");
    expect(m).toContain("Wine B");
  });
});

describe("recommendationsMessage", () => {
  const recs: Recommendations = {
    tiers: [
      { key: "stock", items: [
        { name: "Baron Philippe Cab", priceLabel: "฿890", labelKey: "value", why: "Тот же плотный каб, проще." },
      ] },
      { key: "catalog", items: [
        { name: "Errazuriz Max Reserva", supplier: "IWS", priceLabel: "฿1,200", labelKey: "peer", why: "" },
      ] },
    ],
  };

  it("renders tier titles, prices, supplier and label", () => {
    const msg = recommendationsMessage(recs, "ru");
    expect(msg).toContain("🍷 В наличии у нас");
    expect(msg).toContain("Baron Philippe Cab — ฿890 · дешевле и почти так же");
    expect(msg).toContain("Тот же плотный каб, проще.");
    expect(msg).toContain("📦 Можем привезти (поставщики)");
    expect(msg).toContain("Errazuriz Max Reserva — ฿1,200 (IWS) · ровня");
  });

  it("returns an honest empty message when no tiers", () => {
    const msg = recommendationsMessage({ tiers: [] }, "ru");
    expect(msg).toContain("похожего не нашёл");
  });
});
