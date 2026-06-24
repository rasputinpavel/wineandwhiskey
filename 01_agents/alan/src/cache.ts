import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./config.js";
import type { WineEvidence } from "./types.js";

const TABLE = "alan_wine_cache";

let client: SupabaseClient | null = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

/** Look up cached evidence by normalized key. Returns null on miss / no client / error. */
export async function getCachedEvidence(key: string): Promise<WineEvidence | null> {
  if (!client || !key) return null;
  try {
    const { data, error } = await client
      .from(TABLE)
      .select("evidence")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    return data.evidence as WineEvidence;
  } catch (err) {
    console.error("cache get failed:", err);
    return null;
  }
}

/** Store evidence under the key (upsert). Best-effort; swallows errors. */
export async function putCachedEvidence(
  key: string,
  identity: unknown,
  evidence: WineEvidence,
): Promise<void> {
  if (!client || !key) return;
  try {
    await client.from(TABLE).upsert({ key, identity, evidence }, { onConflict: "key" });
  } catch (err) {
    console.error("cache put failed:", err);
  }
}
