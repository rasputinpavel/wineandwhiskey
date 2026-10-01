// Прайс-срез: бот качает файл из телеграма и отдаёт его в mission-control,
// который переиспользует прайсовый пайплайн портала (парсеры поставщиков +
// Claude-фоллбэк). Сам бот ничего не парсит и в базу ничего не пишет.

import type { SliceRow } from "./price-slice-format.js";

/** Позиция прайса как её отдаёт портал. Держим в памяти для доуточнения. */
export type SliceItem = Record<string, unknown>;

export type SliceResponse = {
  supplier_name: string;
  price_list_date: string | null;
  currency: string | null;
  total_items: number;
  matched: number;
  degraded: string[];
  rows: SliceRow[];
  items: SliceItem[];
};

export type RefineResponse = {
  total_items: number;
  matched: number;
  degraded: string[];
  rows: SliceRow[];
};

export class PriceSliceError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

const TIMEOUT_MS = 300_000;   // большой PDF через Vision идёт минутами

function portalUrl(path: string): string {
  const base = process.env.MISSION_CONTROL_URL;
  if (!base) throw new PriceSliceError("MISSION_CONTROL_URL не задан");
  return `${base.replace(/\/+$/, "")}${path}`;
}

function authHeader(): Record<string, string> {
  const secret = process.env.PRICE_SLICE_SECRET;
  if (!secret) throw new PriceSliceError("PRICE_SLICE_SECRET не задан");
  return { Authorization: `Bearer ${secret}` };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `портал ответил ${res.status}`;
  } catch {
    return `портал ответил ${res.status}`;
  }
}

/** Разбор файла + первый срез. */
export async function requestSlice(opts: {
  base64: string;
  mimeType: string;
  filename: string;
  query: string;
}): Promise<SliceResponse> {
  const form = new FormData();
  form.append("file", new Blob([Buffer.from(opts.base64, "base64")], { type: opts.mimeType }), opts.filename);
  form.append("query", opts.query);

  const res = await fetch(portalUrl("/api/public/price/slice"), {
    method: "POST",
    headers: authHeader(),
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new PriceSliceError(await readError(res), res.status);
  return (await res.json()) as SliceResponse;
}

/** Доуточнение по уже разобранным позициям — файл второй раз не парсится. */
export async function requestRefine(items: SliceItem[], query: string): Promise<RefineResponse> {
  const res = await fetch(portalUrl("/api/public/price/slice/refine"), {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ items, query }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new PriceSliceError(await readError(res), res.status);
  return (await res.json()) as RefineResponse;
}

// ─── Кэш разобранного прайса ────────────────────────────────────────────────
// В памяти процесса, как pendingPhotos и pendingWeight. Редеплой кэш теряет —
// тогда файл присылается заново, это приемлемо и проще внешнего хранилища.

export const SLICE_TTL_MS = 30 * 60 * 1000;

export type SliceCacheEntry = {
  items: SliceItem[];
  supplier: string;
  /** id сообщения со срезом: reply на него = доуточнение. */
  messageId: number;
};

const cache = new Map<number, SliceCacheEntry & { ts: number }>();

export function rememberSlice(chatId: number, entry: SliceCacheEntry): void {
  cache.set(chatId, { ...entry, ts: Date.now() });
}

export function recallSlice(chatId: number): SliceCacheEntry | null {
  const hit = cache.get(chatId);
  if (!hit) return null;
  if (Date.now() - hit.ts > SLICE_TTL_MS) {
    cache.delete(chatId);
    return null;
  }
  return hit;
}

export function forgetSlice(chatId: number): void {
  cache.delete(chatId);
}
