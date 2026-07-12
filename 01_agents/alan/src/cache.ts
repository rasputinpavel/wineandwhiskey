import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./config.js";
import type { WineEvidence } from "./types.js";

const TABLE = "alan_wine_cache";

let client: SupabaseClient | null = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

// ─── Fuzzy key matching ─────────────────────────────────────────────────────
// The cache key is producer+name+vintage from the identify step, which carries OCR /
// spelling noise ("cellars" vs "cellers" for the same producer). An exact-key miss on a
// wine we already know re-runs the whole research. A fuzzy fallback bridges that noise —
// but ONLY within the same vintage year(s), so 2018 and 2019 of one wine never merge.

/** Levenshtein edit distance between two strings. */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/** 0–1 similarity: 1 = identical, lower = more edits relative to the longer string. */
function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - editDistance(a, b) / max;
}

/** The 4-digit years in a key, sorted, as a comparable signature ("" if none). */
function yearSig(key: string): string {
  return (key.match(/\b\d{4}\b/g) ?? []).sort().join(",");
}

/** Closest key to `target` among `keys` that shares the same vintage year(s) and clears
 *  the similarity threshold. null when none qualifies. Exported for testing. */
export function bestFuzzyKey(target: string, keys: string[], threshold = 0.9): string | null {
  const ty = yearSig(target);
  let best: string | null = null;
  let bestSim = threshold;
  for (const k of keys) {
    if (k === target || yearSig(k) !== ty) continue;
    const s = similarity(k, target);
    if (s >= bestSim) { bestSim = s; best = k; }
  }
  return best;
}

async function fetchRow(key: string): Promise<{ evidence: WineEvidence; brief: string } | null> {
  const { data, error } = await client!
    .from(TABLE)
    .select("evidence, brief")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  return { evidence: data.evidence as WineEvidence, brief: (data.brief as string) ?? "" };
}

/** Look up cached evidence + brief by normalized key. On an exact miss, falls back to the
 *  closest same-vintage key (bridges OCR/spelling noise). Returns null on miss / no client / error. */
export async function getCached(key: string): Promise<{ evidence: WineEvidence; brief: string } | null> {
  if (!client || !key) return null;
  try {
    const exact = await fetchRow(key);
    if (exact) return exact;
    // Fuzzy fallback: scan existing keys for a near-identical, same-vintage one.
    const { data: rows, error } = await client.from(TABLE).select("key");
    if (error || !rows) return null;
    const alt = bestFuzzyKey(key, (rows as { key: string }[]).map((r) => r.key));
    return alt ? await fetchRow(alt) : null;
  } catch (err) {
    console.error("cache get failed:", err);
    return null;
  }
}

/** Store evidence + brief under the key (upsert). Best-effort; swallows errors. */
export async function putCached(
  key: string,
  identity: unknown,
  evidence: WineEvidence,
  brief: string,
): Promise<void> {
  if (!client || !key) return;
  try {
    await client.from(TABLE).upsert({ key, identity, evidence, brief }, { onConflict: "key" });
  } catch (err) {
    console.error("cache put failed:", err);
  }
}
