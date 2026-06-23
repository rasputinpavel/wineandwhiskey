import type { Verdict, AnaloguesResult, Lang } from "./types.js";

const T = {
  en: {
    critics: "Critics", crowd: "Crowd", price: "Price", value: "Value",
    notes: "Notes", drink: "Drink", sources: "Sources", confidence: "Confidence",
    limited: "Reliable data is limited — treat this with caution.",
    noCritics: "no critic scores found", analoguesFor: "Analogues for",
  },
  ru: {
    critics: "Критики", crowd: "Толпа", price: "Цена", value: "Цена/качество",
    notes: "Ноты", drink: "Пить", sources: "Источники", confidence: "Уверенность",
    limited: "Надёжных данных мало — относись осторожно.",
    noCritics: "оценок критиков не найдено", analoguesFor: "Аналоги для",
  },
} as const;

function title(v: Verdict): string {
  const i = v.identity;
  return [i.producer, i.name, i.vintage].filter(Boolean).join(" ").trim() || "Unknown wine";
}

function priceStr(v: Verdict): string {
  return v.marketPrice ? `${v.marketPrice.amount} ${v.marketPrice.currency}` : "—";
}

export function shortVerdict(v: Verdict, lang: Lang): string {
  const t = T[lang];
  const lines: string[] = [`🍷 ${title(v)}`];
  if (v.criticConsensus !== null) {
    lines.push(`${t.critics}: ${v.criticConsensus}/100 (${v.criticCount})`);
  } else {
    lines.push(`${t.critics}: ${t.noCritics}`);
  }
  if (v.qpr) lines.push(`${t.value}: ${v.qpr.rating}/10 — ${v.qpr.label} · ${priceStr(v)}`);
  else if (v.marketPrice) lines.push(`${t.price}: ${priceStr(v)}`);
  lines.push(`👉 ${v.bottomLine}`);
  return lines.join("\n");
}

export function fullCard(v: Verdict, lang: Lang): string {
  const t = T[lang];
  const lines: string[] = [`🍷 ${title(v)}`];
  if (v.identity.region || v.identity.grape) {
    lines.push([v.identity.grape, v.identity.region].filter(Boolean).join(", "));
  }
  lines.push("");
  lines.push(v.criticConsensus !== null
    ? `${t.critics}: ${v.criticConsensus}/100 (${v.criticCount})`
    : `${t.critics}: ${t.noCritics}`);
  if (v.communityNote) lines.push(`${t.crowd}: ${v.communityNote}`);
  lines.push(`${t.price}: ${priceStr(v)}`);
  if (v.qpr) lines.push(`${t.value}: ${v.qpr.rating}/10 — ${v.qpr.label}`);
  if (v.tastingNotes) lines.push(`${t.notes}: ${v.tastingNotes}`);
  if (v.drinkingWindow) lines.push(`${t.drink}: ${v.drinkingWindow}`);
  lines.push("");
  lines.push(`👉 ${v.bottomLine}`);
  lines.push(`${t.confidence}: ${v.dataConfidence}`);
  if (v.dataConfidence === "low") lines.push(t.limited);
  if (v.sources.length) lines.push(`${t.sources}:\n${v.sources.map((s) => `• ${s}`).join("\n")}`);
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
  if (a.sources.length) lines.push(`${t.sources}:\n${a.sources.map((s) => `• ${s}`).join("\n")}`);
  return lines.join("\n");
}
