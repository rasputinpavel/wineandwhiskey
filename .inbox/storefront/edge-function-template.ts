// Supabase Edge Function — enriches `products` with Vivino data from price-service.
//
// Place at: supabase/functions/enrich-products-vivino/index.ts (in phuket-sip-reserve).
//
// Required env (set in Lovable Cloud → Edge functions):
//   VIVINO_LOOKUP_URL    e.g. https://price-service.up.railway.app/api/public/vivino/lookup
//   VIVINO_LOOKUP_KEY    same as STOREFRONT_API_KEY on the price-service Railway env
//   SUPABASE_URL         injected by Supabase
//   SUPABASE_SERVICE_ROLE_KEY  injected by Supabase
//
// Invocation:
//   POST /functions/v1/enrich-products-vivino
//     Body: { product_ids?: string[], force?: boolean, limit?: number }
//   - no body: process up to LIMIT products without vivino_enriched_at
//   - product_ids: process exactly those (skip TTL guard if force=true)
//   - force=true: re-fetch even if previously enriched
//
// Schedule via Supabase scheduled triggers (e.g. daily at 03:00 UTC) for steady-state,
// and call directly from your Loyverse-sync function for newly inserted products.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// -- assumed `products` schema (adapt column names if yours differ) --
type ProductRow = {
  id: string;
  name: string;                 // raw Loyverse item name, e.g. "Ant Moore Sauvignon Blanc 2022 750ml"
  winery?: string | null;       // optional, if you store it separately
  year?: number | null;         // optional, if pre-parsed
  vivino_enriched_at: string | null;
  vivino_lookup_attempted_at: string | null;
};

type LookupHit = {
  match: null | {
    rating: number | null;
    reviews_count: number | null;
    image_url: string | null;
    country: string | null;
    grape: string | null;
    description: string | null;
    wine_type: string | null;
    year: number | null;
    alcohol: number | null;
    body: string | null;
    flavors: string[] | null;
    food_pairings: string[] | null;
    region: string | null;
    vivino_url: string | null;
  };
  confidence?: number;
  reason?: string;
  topScore?: number;
};

const VIVINO_LOOKUP_URL = Deno.env.get("VIVINO_LOOKUP_URL");
const VIVINO_LOOKUP_KEY = Deno.env.get("VIVINO_LOOKUP_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const REENRICH_TTL_DAYS = 30;
const DEFAULT_LIMIT = 100;
const PARALLEL = 4; // concurrent lookup calls — keep low to be polite to the upstream

// ----------------------------------------------------------------------------
// Loyverse name parser — pulls out year + volume, returns clean wine name.
// Examples:
//   "Ant Moore Sauvignon Blanc 2022 750ml"   → { name: "Ant Moore Sauvignon Blanc", year: 2022 }
//   "Catena Malbec 2019"                       → { name: "Catena Malbec",            year: 2019 }
//   "Penfolds Bin 28"                          → { name: "Penfolds Bin 28",          year: null }
// ----------------------------------------------------------------------------
const VOLUME_RX = /\b\d+(?:[.,]\d+)?\s*(?:ml|cl|l)\b/gi;
const YEAR_RX = /\b(19|20)\d{2}\b/;

function parseLoyverseName(raw: string): { name: string; year: number | null } {
  const yearMatch = raw.match(YEAR_RX);
  const year = yearMatch ? Number(yearMatch[0]) : null;
  const cleaned = raw
    .replace(VOLUME_RX, " ")
    .replace(YEAR_RX, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { name: cleaned, year };
}

// ----------------------------------------------------------------------------
// Lookup — calls price-service API.
// ----------------------------------------------------------------------------
async function lookupVivino(
  name: string,
  year: number | null,
  winery: string | null,
): Promise<LookupHit> {
  const url = new URL(VIVINO_LOOKUP_URL!);
  url.searchParams.set("name", name);
  if (winery) url.searchParams.set("winery", winery);
  if (year) url.searchParams.set("year", String(year));

  const res = await fetch(url, {
    headers: { "x-api-key": VIVINO_LOOKUP_KEY! },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`vivino lookup failed: HTTP ${res.status} ${text}`);
  }
  return await res.json();
}

// ----------------------------------------------------------------------------
// Enrich one row: parse name, lookup, write columns.
// ----------------------------------------------------------------------------
async function enrichProduct(supabase: SupabaseClient, p: ProductRow): Promise<"enriched" | "miss" | "error"> {
  const { name, year } = parseLoyverseName(p.name);
  const yearForLookup = p.year ?? year;
  const winery = p.winery ?? null;

  let hit: LookupHit;
  try {
    hit = await lookupVivino(name, yearForLookup, winery);
  } catch (e) {
    console.error(`[enrich:${p.id}] lookup error:`, (e as Error).message);
    await supabase
      .from("products")
      .update({ vivino_lookup_attempted_at: new Date().toISOString() })
      .eq("id", p.id);
    return "error";
  }

  const now = new Date().toISOString();

  if (!hit.match) {
    // Persist the negative result so we don't retry on every cron tick.
    await supabase
      .from("products")
      .update({ vivino_lookup_attempted_at: now })
      .eq("id", p.id);
    console.log(`[enrich:${p.id}] miss (${hit.reason ?? "?"}, top=${hit.topScore ?? 0})`);
    return "miss";
  }

  const m = hit.match;
  const update = {
    vivino_rating: m.rating,
    vivino_reviews_count: m.reviews_count,
    vivino_image_url: m.image_url,
    vivino_url: m.vivino_url,
    vivino_country: m.country,
    vivino_region: m.region,
    vivino_grape: m.grape,
    vivino_wine_type: m.wine_type,
    vivino_alcohol: m.alcohol,
    vivino_body: m.body,
    vivino_year: m.year,
    vivino_flavors: m.flavors,
    vivino_food_pairings: m.food_pairings,
    vivino_description: m.description,
    vivino_confidence: hit.confidence ?? null,
    vivino_enriched_at: now,
    vivino_lookup_attempted_at: now,
  };
  const { error } = await supabase.from("products").update(update).eq("id", p.id);
  if (error) {
    console.error(`[enrich:${p.id}] update failed:`, error.message);
    return "error";
  }
  console.log(`[enrich:${p.id}] ok (rating=${m.rating}, conf=${hit.confidence})`);
  return "enriched";
}

// ----------------------------------------------------------------------------
// HTTP handler.
// ----------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (!VIVINO_LOOKUP_URL || !VIVINO_LOOKUP_KEY) {
    return new Response(JSON.stringify({ error: "VIVINO_LOOKUP_URL/KEY env not set" }), { status: 503 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Supabase env not injected" }), { status: 503 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: { product_ids?: string[]; force?: boolean; limit?: number } = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { /* allow empty body */ }
  }

  // Build query.
  const limit = Math.min(Math.max(1, body.limit ?? DEFAULT_LIMIT), 500);
  let q = supabase
    .from("products")
    .select("id, name, winery, year, vivino_enriched_at, vivino_lookup_attempted_at");

  if (body.product_ids && body.product_ids.length > 0) {
    q = q.in("id", body.product_ids);
  } else {
    if (!body.force) {
      // Skip rows we tried recently (regardless of hit/miss). We must use
      // vivino_lookup_attempted_at here, not vivino_enriched_at — misses
      // have only the former set, so filtering on enriched_at would re-pick
      // the same miss-batch on every run and never advance the cursor.
      const cutoff = new Date(Date.now() - REENRICH_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
      q = q.or(`vivino_lookup_attempted_at.is.null,vivino_lookup_attempted_at.lt.${cutoff}`);
    }
    // Process oldest-first so the cursor sweeps the whole catalog before
    // looping back to recheck.
    q = q.order("vivino_lookup_attempted_at", { ascending: true, nullsFirst: true }).limit(limit);
  }

  const { data, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const rows = (data ?? []) as ProductRow[];
  const counts = { total: rows.length, enriched: 0, miss: 0, error: 0 };

  // Simple pool with `PARALLEL` workers.
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const idx = cursor++;
      const r = rows[idx];
      const out = await enrichProduct(supabase, r);
      counts[out]++;
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, () => worker()));

  return new Response(JSON.stringify({ ok: true, ...counts }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
