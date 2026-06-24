import type { Verdict, AnaloguesResult, Lang, ValueRead, EvidenceLevel, PriceTier } from "./types.js";
import { usdToThb, estimateThaiThb } from "./priceLocal.js";

const MAX_SOURCES = 6;

const T = {
  en: {
    critics: "Critics", crowd: "Crowd", value: "Value",
    notes: "Notes", drink: "Drink", age: "Age", sources: "Sources", confidence: "Confidence",
    producer: "Producer", category: "Category", basis: "Based on",
    origin: "Origin", thaiEst: "Thailand est.", segment: "Segment",
    limited: "Reliable data is limited — treat this with caution.",
    localPrompt: "💬 Send the bottle's price in baht and I'll tell you how good the deal is here.",
    noCritics: "no critic scores found", analoguesFor: "Analogues for",
    valueRead: { good: "good price", fair: "fair price", steep: "steep for what it is", unknown: "" } as Record<ValueRead, string>,
    tier: { entry: "entry-level", mid: "mid-range", premium: "premium", luxury: "luxury", icon: "icon/collector", unknown: "" } as Record<PriceTier, string>,
    level: { exact: "this exact wine", producer: "the producer", category: "the category", none: "very little data" } as Record<EvidenceLevel, string>,
  },
  ru: {
    critics: "Критики", crowd: "Толпа", value: "Цена/качество",
    notes: "Ноты", drink: "Пить", age: "Возраст", sources: "Источники", confidence: "Уверенность",
    producer: "Производитель", category: "Категория", basis: "Вывод по",
    origin: "На родине", thaiEst: "Ориентир по Таиланду", segment: "Сегмент",
    limited: "Надёжных данных мало — относись осторожно.",
    localPrompt: "💬 Пришли цену бутылки в батах — скажу, насколько это выгодно здесь.",
    noCritics: "оценок критиков не найдено", analoguesFor: "Аналоги для",
    valueRead: { good: "цена хорошая", fair: "цена нормальная", steep: "дороговато за такое", unknown: "" } as Record<ValueRead, string>,
    tier: { entry: "входной уровень", mid: "средний сегмент", premium: "премиум", luxury: "люкс", icon: "икона/коллекционное", unknown: "" } as Record<PriceTier, string>,
    level: { exact: "этому вину", producer: "производителю", category: "категории", none: "крайне малому объёму данных" } as Record<EvidenceLevel, string>,
  },
} as const;

function title(v: Verdict): string {
  const i = v.identity;
  return [i.producer, i.name, i.vintage].filter(Boolean).join(" ").trim() || "Unknown wine";
}

/** First message: rich digest. */
export function shortVerdict(v: Verdict, lang: Lang): string {
  const t = T[lang];
  const lines: string[] = [`🍷 ${title(v)}`];
  const sub = [v.identity.grape, v.identity.region].filter(Boolean).join(", ");
  if (sub) lines.push(sub);
  lines.push("");

  lines.push(v.criticConsensus !== null
    ? `${t.critics}: ${v.criticConsensus}/100 (${v.criticCount})`
    : `${t.critics}: ${t.noCritics}`);
  if (v.communityNote) lines.push(`${t.crowd} (Vivino): ${v.communityNote}`);
  if (v.marketUsd !== null) {
    lines.push(`${t.origin}: ${v.marketUsd} USD (~฿${usdToThb(v.marketUsd)})`);
    const est = estimateThaiThb(v.marketUsd);
    lines.push(`${t.thaiEst}: ฿${est.low}–฿${est.high}`);
  }
  if (v.qpr) lines.push(`${t.value}: ${v.qpr.rating}/10 — ${v.qpr.label}`);
  else if (t.valueRead[v.valueRead]) lines.push(`${t.value}: ${t.valueRead[v.valueRead]}`);
  if (v.priceTier !== "unknown") lines.push(`${t.segment}: ${t.tier[v.priceTier]}`);

  lines.push("");
  if (v.producerNote) lines.push(`${t.producer}: ${v.producerNote}`);
  if (v.categoryPositioning) lines.push(`${t.category}: ${v.categoryPositioning}`);
  if (v.tastingNotes) lines.push(`${t.notes}: ${v.tastingNotes}`);
  if (v.drinkingWindow) lines.push(`${t.drink}: ${v.drinkingWindow}`);
  if (v.agingNote) lines.push(`${t.age}: ${v.agingNote}`);

  if (v.punchline) { lines.push(""); lines.push(v.punchline); }
  if (v.qualityScore !== null || v.marketUsd !== null) { lines.push(""); lines.push(t.localPrompt); }
  return lines.join("\n");
}

/** "Подробнее": the full ladder brief + sources. Falls back to a structured card. */
export function fullCard(v: Verdict, lang: Lang): string {
  const t = T[lang];
  if (v.detail && v.detail.trim()) {
    let out = v.detail.trim();
    if (v.sources.length) {
      out += `\n\n${t.sources}:\n${v.sources.slice(0, MAX_SOURCES).map((s) => `• ${s}`).join("\n")}`;
    }
    return out;
  }
  // Fallback: structured card if no brief was captured.
  const lines: string[] = [`🍷 ${title(v)}`];
  const sub = [v.identity.grape, v.identity.region].filter(Boolean).join(", ");
  if (sub) lines.push(sub);
  lines.push("");
  lines.push(v.criticConsensus !== null
    ? `${t.critics}: ${v.criticConsensus}/100 (${v.criticCount})`
    : `${t.critics}: ${t.noCritics}`);
  if (v.communityNote) lines.push(`${t.crowd} (Vivino): ${v.communityNote}`);
  if (v.marketUsd !== null) {
    lines.push(`${t.origin}: ${v.marketUsd} USD (~฿${usdToThb(v.marketUsd)})`);
    const est = estimateThaiThb(v.marketUsd);
    lines.push(`${t.thaiEst}: ฿${est.low}–฿${est.high}`);
  }
  if (v.qpr) lines.push(`${t.value}: ${v.qpr.rating}/10 — ${v.qpr.label}`);
  if (v.priceTier !== "unknown") lines.push(`${t.segment}: ${t.tier[v.priceTier]}`);
  if (v.producerNote) lines.push(`${t.producer}: ${v.producerNote}`);
  if (v.categoryPositioning) lines.push(`${t.category}: ${v.categoryPositioning}`);
  if (v.tastingNotes) lines.push(`${t.notes}: ${v.tastingNotes}`);
  if (v.drinkingWindow) lines.push(`${t.drink}: ${v.drinkingWindow}`);
  if (v.agingNote) lines.push(`${t.age}: ${v.agingNote}`);
  if (v.punchline) { lines.push(""); lines.push(v.punchline); }
  lines.push(`${t.basis}: ${t.level[v.evidenceLevel]} · ${t.confidence.toLowerCase()} ${v.dataConfidence}`);
  if (v.dataConfidence === "low") lines.push(t.limited);
  if (v.sources.length) lines.push(`${t.sources}:\n${v.sources.slice(0, MAX_SOURCES).map((s) => `• ${s}`).join("\n")}`);
  return lines.join("\n");
}

export function analoguesMessage(a: AnaloguesResult, lang: Lang): string {
  const t = T[lang];
  const lines: string[] = [`🍷 ${t.analoguesFor}: ${a.forWine}`, ""];
  a.analogues.forEach((x, i) => {
    lines.push(`${i + 1}. ${x.name}${x.approxPrice ? ` (${x.approxPrice})` : ""}`);
    lines.push(`   ${x.why}`);
  });
  lines.push("");
  lines.push(`${t.confidence}: ${a.dataConfidence}`);
  if (a.dataConfidence === "low") lines.push(t.limited);
  if (a.sources.length) lines.push(`${t.sources}:\n${a.sources.slice(0, MAX_SOURCES).map((s) => `• ${s}`).join("\n")}`);
  return lines.join("\n");
}
