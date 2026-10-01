// Turning a caught exception into one line the staff can paste back to us.
//
// Every handler used to answer "Ошибка при обработке фото." and swallow the
// real cause into console.error — readable only in the Railway log, which
// nobody in the shop has. Two different failures (Telegram file download vs.
// the Claude call) looked identical in the chat, so every incident started
// with guessing. The message now carries the reason.

// Anything that must never reach a Telegram message, even if a library put it
// into an error text: the bot token (digits:base64ish) and Anthropic keys.
const SECRET_PATTERNS = [
  /\b\d{8,}:[A-Za-z0-9_-]{30,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
];

const MAX_LEN = 300;

// One short line: name, HTTP status when the error carries one, and message.
// `secrets` are extra literal values to redact (env vars the caller knows it
// passed into the failing call).
export function describeError(e: unknown, secrets: (string | undefined)[] = []): string {
  const err = e as { name?: unknown; message?: unknown; status?: unknown; error_code?: unknown };

  const name    = typeof err?.name === "string" ? err.name : "";
  const status  = err?.status ?? err?.error_code;
  const message = typeof err?.message === "string" && err.message ? err.message : String(e);

  const head = [name, status != null ? `HTTP ${status}` : ""].filter(Boolean).join(" ");
  const line = head ? `${head}: ${message}` : message;

  return truncate(redact(line, secrets), MAX_LEN);
}

function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join("***");
  }
  for (const re of SECRET_PATTERNS) out = out.replace(re, "***");
  return out;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
