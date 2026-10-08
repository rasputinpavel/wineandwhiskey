// Брифинг больше не «всё или ничего».
//
// 8 октября 2026 все семь источников висели в одном `Promise.all`, и одна
// просроченная страница Loyverse (`AbortError` на 15-секундном таймауте) унесла
// весь брифинг: в чат не ушло ничего, причина осталась в логе Railway.
//
// Теперь источники собираются через `Promise.allSettled`, и каждый отвечает
// только за себя: не пришли остатки — в брифинге честная строка «данных нет»,
// остальное на месте. Исключение одно — продажи за вчера: без них брифинг
// нечем наполнять, поэтому вместо выдумки команда получает короткое
// предупреждение (см. formatBriefingFailure).

import { describeError } from "./errors.js";

export const NO_DATA = "Данных нет — источник не ответил.";

export class BriefingDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BriefingDataError";
  }
}

type Reporter = (label: string, reason: unknown) => void;

// Необязательный источник: отдаёт значение или подставляет заглушку.
export function sourceValueOr<T>(
  result: PromiseSettledResult<T>,
  label: string,
  fallback: T,
  onFail?: Reporter,
): T {
  if (result.status === "fulfilled") return result.value;
  onFail?.(label, result.reason);
  return fallback;
}

// Текстовый источник для промпта — заглушка всегда одна и та же.
export function sourceValue(
  result: PromiseSettledResult<string>,
  label: string,
  onFail?: Reporter,
): string {
  return sourceValueOr(result, label, NO_DATA, onFail);
}

// Источник, без которого брифинга не бывает.
export function criticalSource<T>(result: PromiseSettledResult<T>, label: string): T {
  if (result.status === "fulfilled") return result.value;
  throw new BriefingDataError(`${label}: ${describeError(result.reason)}`);
}

// Сообщение в чат вместо тишины. Без HTML — его отправляют plain text, чтобы
// предупреждение не утонуло вторым разом на разборе разметки.
export function formatBriefingFailure(e: unknown): string {
  // У нашей же BriefingDataError имя в строке лишнее — она и так про брифинг.
  const reason = e instanceof BriefingDataError
    ? describeError(new Error(e.message), [process.env.TELEGRAM_BOT_TOKEN, process.env.ANTHROPIC_API_KEY])
    : describeError(e, [process.env.TELEGRAM_BOT_TOKEN, process.env.ANTHROPIC_API_KEY]);
  return `⚠️ Утренний брифинг не собрался: ${reason}\nПовторить вручную: /briefing`;
}
