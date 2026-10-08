// Ретрай одного сетевого вызова. Появился после 8 октября 2026: утренний
// брифинг умер на `AbortError` — одна страница Loyverse не ответила за 15 секунд,
// повторять было некому, а `Promise.all` в briefing.ts утащил за собой все семь
// источников. Команда не получила ничего, причина осталась в логе Railway.
//
// Ретраим только то, что имеет смысл повторять: оборванный/таймаутный запрос,
// сетевую ошибку, 408/429 и 5xx. Протухший токен (401) или кривой запрос (400)
// повторять незачем — падаем сразу.

export interface RetryOptions {
  attempts?:    number;                                   // всего попыток, по умолчанию 3
  baseDelayMs?: number;                                   // пауза перед 2-й попыткой, дальше ×2
  sleep?:       (ms: number) => Promise<void>;            // подменяется в тестах
  isRetryable?: (e: unknown) => boolean;
  onRetry?:     (attempt: number, e: unknown, delayMs: number) => void;
}

const TRANSIENT_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET",
]);

const TRANSIENT_MESSAGES = /fetch failed|network|socket hang up|other side closed|terminated|timeout/i;

export function isTransient(e: unknown, depth = 0): boolean {
  const err = e as { name?: unknown; message?: unknown; status?: unknown; code?: unknown; cause?: unknown };

  const name = typeof err?.name === "string" ? err.name : "";
  if (name === "AbortError" || name === "TimeoutError") return true;

  const code = typeof err?.code === "string" ? err.code : "";
  if (TRANSIENT_CODES.has(code)) return true;

  // HTTP-статус решает сам за себя: 401/403/404 повторять бессмысленно.
  const status = typeof err?.status === "number" ? err.status : undefined;
  if (status !== undefined) return status === 408 || status === 429 || status >= 500;

  const message = typeof err?.message === "string" ? err.message : "";
  if (TRANSIENT_MESSAGES.test(message)) return true;

  if (err?.cause && err.cause !== e && depth < 3) return isTransient(err.cause, depth + 1);
  return false;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts    = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const sleep       = opts.sleep ?? defaultSleep;
  const retryable   = opts.isRetryable ?? ((e: unknown) => isTransient(e));

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === attempts || !retryable(e)) throw e;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      opts.onRetry?.(attempt, e, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastError;
}
