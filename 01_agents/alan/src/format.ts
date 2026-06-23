import type { Verdict, AnaloguesResult, Lang, ValueRead, EvidenceLevel } from "./types.js";

const MAX_SOURCES = 6;

const T = {
  en: {
    critics: "Critics", crowd: "Crowd", price: "Price", value: "Value",
    notes: "Notes", drink: "Drink", sources: "Sources", confidence: "Confidence",
    producer: "Producer", category: "Category", basis: "Based on",
    limited: "Reliable data is limited — treat this with caution.",
    noCritics: "no critic scores found", analoguesFor: "Analogues for",
    valueRead: { good: "good price", fair: "fair price", steep: "steep for what it is", unknown: "" } as Record<ValueRead, string>,
    level: { exact: "this exact wine", producer: "the producer", category: "the category", none: "very little data" } as Record<EvidenceLevel, string>,
    bottom: {
      "take-value": "take it — strong value",
      "take-quality": "take it — genuinely good",
      "overpriced": "overpriced — skip unless you love the style",
      "skip": "skip — unremarkable",
      "depends-ok": "depends — fine but not special",
      "nodata": "depends — not enough data",
    },
  },
  ru: {
    critics: "Критики", crowd: "Толпа", price: "Цена", value: "Цена/качество",
    notes: "Ноты", drink: "Пить", sources: "Источники", confidence: "Уверенность",
    producer: "Производитель", category: "Категория", basis: "Вывод по",
    limited: "Надёжных данных мало — относись осторожно.",
    noCritics: "оценок критиков не найдено", analoguesFor: "Аналоги для",
    valueRead: { good: "цена хорошая", fair: "цена нормальная", steep: "дороговато за такое", unknown: "" } as Record<ValueRead, string>,
    level: { exact: "этому вину", producer: "производителю", category: "категории", none: "крайне малому объёму данных" } as Record<EvidenceLevel, string>,
    bottom: {
      "take-value": "брать — отличная цена",
      "take-quality": "брать — действительно хорошее",
      "overpriced": "переоценено — мимо, если не любишь стиль",
      "skip": "мимо — ничем не примечательно",
      "depends-ok": "на любителя — нормальное, без вау",
      "nodata": "данных мало — однозначно не скажу",
    },
  },
} as const;

function title(v: Verdict): string {
  const i = v.identity;
  return [i.producer, i.name, i.vintage].filter(Boolean).join(" ").trim() || "Unknown wine";
}

function priceStr(v: Verdict): string {
  return v.marketPrice ? `${v.marketPrice.amount} ${v.marketPrice.currency}` : "—";
}

/** First sentence / clipped snippet, for the compact short verdict. */
function snippet(text: string, max = 160): string {
  const t = text.trim();
  if (!t) return "";
  const cut = t.slice(0, max);
  return cut.length < t.length ? cut.replace(/\s+\S*$/, "") + "…" : cut;
}

export function shortVerdict(v: Verdict, lang: Lang): string {
  const t = T[lang];
  const lines: string[] = [`🍷 ${title(v)}`];

  // Quality / positioning signal line.
  if (v.criticConsensus !== null) {
    lines.push(`${t.critics}: ${v.criticConsensus}/100 (${v.criticCount})`);
  } else if (v.producerNote || v.categoryPositioning) {
    lines.push(snippet(v.producerNote || v.categoryPositioning));
  } else {
    lines.push(`${t.critics}: ${t.noCritics}`);
  }

  // Value / price line.
  if (v.qpr) {
    lines.push(`${t.value}: ${v.qpr.rating}/10 — ${v.qpr.label} · ${priceStr(v)}`);
  } else if (v.marketPrice && t.valueRead[v.valueRead]) {
    lines.push(`${t.price}: ${priceStr(v)} — ${t.valueRead[v.valueRead]}`);
  } else if (v.marketPrice) {
    lines.push(`${t.price}: ${priceStr(v)}`);
  } else if (t.valueRead[v.valueRead]) {
    lines.push(t.valueRead[v.valueRead]);
  }

  lines.push(`👉 ${t.bottom[v.bottomLine]}`);
  lines.push(`${t.basis}: ${t.level[v.evidenceLevel]}`);
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
  else if (t.valueRead[v.valueRead]) lines.push(`${t.value}: ${t.valueRead[v.valueRead]}`);
  if (v.producerNote) lines.push(`${t.producer}: ${v.producerNote}`);
  if (v.categoryPositioning) lines.push(`${t.category}: ${v.categoryPositioning}`);
  if (v.tastingNotes) lines.push(`${t.notes}: ${v.tastingNotes}`);
  if (v.drinkingWindow) lines.push(`${t.drink}: ${v.drinkingWindow}`);
  lines.push("");
  lines.push(`👉 ${t.bottom[v.bottomLine]}`);
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
