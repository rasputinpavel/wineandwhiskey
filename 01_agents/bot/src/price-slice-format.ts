// Отрисовка среза прайса для телеграма: читаемый список в чат и CSV-вложение
// с полной таблицей. Чистые функции — вся работа с сетью живёт в price-slice.ts.

export type SliceRow = {
  producer: string | null;
  name: string;
  region: string | null;
  country: string | null;
  year: number | null;
  price: number | null;
  volume: string | null;
  match: "explicit" | "inferred";
  note: string | null;
};

const CSV_HEADER = ["производитель", "название", "регион", "год", "цена", "объём", "пометка"];

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV для Excel: BOM и CRLF, иначе тайский Excel ломает кириллицу и строки.
 * Цена — числом без разделителей разрядов, чтобы считалась формулами.
 */
export function buildSliceCsv(rows: SliceRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push([
      csvCell(r.producer),
      csvCell(r.name),
      csvCell(r.region ?? r.country),
      csvCell(r.year),
      csvCell(r.price),
      csvCell(r.volume),
      csvCell(r.match === "inferred" ? (r.note ?? "по апелласьону") : (r.note ?? null)),
    ].join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function baht(n: number): string {
  return "฿" + n.toLocaleString("en-US");
}

function ruDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

export type SliceMessageInput = {
  supplier: string;
  priceListDate: string | null;
  rows: SliceRow[];
  totalItems: number;
  matched: number;
  degraded: string[];
  limit: number;
};

/**
 * Список в чат, parse_mode HTML. По две строки на вино — так читается с телефона
 * без горизонтального скролла, в отличие от моноширинной таблицы в пять колонок.
 */
export function formatSliceMessage(input: SliceMessageInput): string {
  const { supplier, rows, totalItems, matched, degraded, limit } = input;
  const date = ruDate(input.priceListDate);
  const head = `<b>${esc(supplier)}</b>${date ? ` · прайс от ${date}` : ""}`;

  if (matched === 0) {
    return `${head}\nПо запросу ничего не нашёл. В прайсе ${totalItems} позиций — попробуй переформулировать.`;
  }

  const prices = rows.map((r) => r.price).filter((p): p is number => p !== null);
  const span = prices.length > 0
    ? `, ${baht(Math.min(...prices))}–${baht(Math.max(...prices))}`
    : "";

  const lines = [head, `Нашёл ${matched} позиций${span}`, ""];

  rows.slice(0, limit).forEach((r, i) => {
    const title = [r.producer, r.name].filter(Boolean).map((s) => esc(s!)).join(" · ");
    const facts = [
      [r.region, r.country].filter(Boolean).map((s) => esc(s!)).join(", ") || null,
      r.year !== null ? String(r.year) : null,
      r.price !== null ? baht(r.price) : null,
    ].filter(Boolean).join(" · ");
    const mark = r.match === "inferred" ? `  ◦ ${esc(r.note ?? "по апелласьону")}` : "";
    lines.push(`${i + 1}. ${title}`);
    lines.push(`   ${facts}${mark}`);
  });

  if (matched > limit) lines.push("", `…и ещё ${matched - limit} — в файле`);
  if (degraded.length > 0) lines.push("", `⚠️ не сработало: ${degraded.map(esc).join(", ")}`);

  return lines.join("\n");
}

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Имя CSV: запрос_поставщик_дата — чтобы в «Загрузках» было понятно, что это. */
export function sliceFileName(query: string, supplier: string, isoDate: string): string {
  const parts = [slug(query), slug(supplier), isoDate].filter((p) => p !== "");
  return `${parts.join("_")}.csv`;
}

/**
 * Дата по Бангкоку в ISO. Своя, а не bangkokDate() из expenses.ts: та отдаёт
 * ДД.ММ.ГГГГ, и в имени файла такая дата сортируется неправильно.
 */
export function bangkokIsoDate(now = Date.now()): string {
  return new Date(now + 7 * 3600_000).toISOString().slice(0, 10);
}
