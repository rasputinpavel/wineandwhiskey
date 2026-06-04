// Single shared Loyverse REST client for the automation scripts.
//
// Why this exists: ~15 scripts each reimplemented loyverseFetch + pagination,
// and only sync_loyverse_receipts.ts carried the transient-error retry, so the
// rest hard-failed when Loyverse occasionally returns an empty/garbled body on
// a 2xx or a transient 429/5xx. This is the one place that talks to /v1.0.

const LOYVERSE_TOKEN = process.env.LOYVERSE_API_TOKEN!;
const BASE = "https://api.loyverse.com/v1.0";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// GET one URL with exponential-backoff retry on transient failures.
export async function loyverseGet(url: string): Promise<any> {
  const MAX = 5;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` } });
      const body = await r.text();
      if (!r.ok) {
        const err = new Error(`Loyverse ${r.status}: ${body.slice(0, 200)}`);
        // 429/5xx — transient, retry; other 4xx — fatal, don't retry.
        if (r.status !== 429 && r.status < 500) throw Object.assign(err, { fatal: true });
        throw err;
      }
      if (!body.trim()) throw new Error("Loyverse returned an empty body on 2xx");
      return JSON.parse(body);
    } catch (e) {
      lastErr = e;
      if ((e as any)?.fatal || attempt === MAX) break;
      const wait = 500 * 2 ** (attempt - 1); // 0.5s, 1s, 2s, 4s
      console.warn(`[loyverse]   retry ${attempt}/${MAX - 1} after error: ${String((e as any)?.message ?? e)} (wait ${wait}ms)`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// Paginate a Loyverse collection endpoint, returning all rows under `key`.
export async function loyverseFetch<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const d = await loyverseGet(url);
    out.push(...(d[key] ?? []));
    cursor = d.cursor;
  } while (cursor);
  return out;
}

// Resolve customer id → display name for the given ids (best-effort; failures
// drop to anonymous so callers treat them as walk-in B2C).
export async function fetchCustomerNames(ids: Iterable<string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all([...new Set(ids)].map(async (id) => {
    try {
      const c = await loyverseGet(`${BASE}/customers/${id}`);
      map.set(id, ((c.name ?? "").trim() || c.email || id.slice(0, 8)));
    } catch { /* drop — anonymous B2C */ }
  }));
  return map;
}
