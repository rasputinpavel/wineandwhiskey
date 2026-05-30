/**
 * sync_inventory_loyverse.ts
 *
 * Pulls products + stock from Loyverse → inventory schema in Supabase.
 *
 * Usage: npx tsx 03_automation/sync_inventory_loyverse.ts
 *
 * Writes:
 *   inventory.sku             — upsert by loyverse_variant_id
 *   inventory.loyverse_stock  — upsert by (sku_id, store_id)
 *   inventory.sync_log        — one row per source per run
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const LOYVERSE_TOKEN = process.env.LOYVERSE_API_TOKEN!;
if (!LOYVERSE_TOKEN) throw new Error("LOYVERSE_API_TOKEN missing");

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { db: { schema: "inventory" } },
);

type LoyverseItem = {
  id: string;
  item_name: string;
  category_id: string | null;
  variants: Array<{
    variant_id: string;
    sku: string | null;
    default_price: number | null;
  }>;
  track_stock: boolean;
};

type LoyverseInventoryLevel = {
  variant_id: string;
  store_id: string;
  in_stock: number;
};

async function logRun(source: string, started: Date) {
  const { data } = await supabase
    .from("sync_log")
    .insert({ source, started_at: started.toISOString() })
    .select("id")
    .single();
  return data!.id as string;
}

async function finishRun(id: string, ok: boolean, error: string | null, rowsIn: number, rowsOut: number) {
  await supabase
    .from("sync_log")
    .update({ finished_at: new Date().toISOString(), ok, error, rows_in: rowsIn, rows_out: rowsOut })
    .eq("id", id);
}

async function loyverseFetch<T>(path: string, qs: Record<string, string> = {}): Promise<T> {
  const url = new URL(`https://api.loyverse.com/v1.0${path}`);
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` } });
  if (!r.ok) throw new Error(`Loyverse ${path} → ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function fetchAllItems(): Promise<LoyverseItem[]> {
  const all: LoyverseItem[] = [];
  let cursor: string | undefined;
  for (;;) {
    const qs: Record<string, string> = { limit: "250" };
    if (cursor) qs.cursor = cursor;
    const page = await loyverseFetch<{ items: LoyverseItem[]; cursor?: string }>("/items", qs);
    all.push(...(page.items ?? []));
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  return all;
}

async function fetchAllInventory(): Promise<LoyverseInventoryLevel[]> {
  const all: LoyverseInventoryLevel[] = [];
  let cursor: string | undefined;
  for (;;) {
    const qs: Record<string, string> = { limit: "250" };
    if (cursor) qs.cursor = cursor;
    const page = await loyverseFetch<{ inventory_levels: LoyverseInventoryLevel[]; cursor?: string }>(
      "/inventory",
      qs,
    );
    all.push(...(page.inventory_levels ?? []));
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  return all;
}

async function syncProducts(): Promise<{ rowsIn: number; rowsOut: number }> {
  const runId = await logRun("loyverse_products", new Date());
  try {
    // Pull category id→name map first so we denormalise into sku.category
    // (was storing the raw UUID before — useless for filtering).
    const categoryName = new Map<string, string>();
    {
      let cursor: string | undefined = undefined;
      for (let page = 0; page < 20; page++) {
        const qs = new URLSearchParams({ limit: "250" });
        if (cursor) qs.set("cursor", cursor);
        const data: { categories: Array<{ id: string; name: string }>; cursor?: string } =
          await loyverseFetch("/categories", qs);
        for (const c of data.categories) categoryName.set(c.id, c.name);
        if (!data.cursor) break;
        cursor = data.cursor;
      }
      console.log(`[loyverse] ${categoryName.size} categories`);
    }

    const items = await fetchAllItems();
    console.log(`[loyverse] ${items.length} items`);

    const rows: Array<{
      loyverse_variant_id: string;
      loyverse_item_id: string;
      loyverse_product_code: string | null;
      name: string;
      category: string | null;
      default_price: number | null;
      is_inventory_tracked: boolean;
      updated_at: string;
    }> = [];

    for (const it of items) {
      const catName = it.category_id ? (categoryName.get(it.category_id) ?? null) : null;
      for (const v of it.variants ?? []) {
        rows.push({
          loyverse_variant_id: v.variant_id,
          loyverse_item_id: it.id,
          loyverse_product_code: v.sku ?? null,
          name: it.item_name,
          category: catName,
          default_price: v.default_price ?? null,
          is_inventory_tracked: !!it.track_stock,
          updated_at: new Date().toISOString(),
        });
      }
    }

    // Upsert in chunks (Supabase recommends ≤1000 rows per call).
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const { error } = await supabase
        .from("sku")
        .upsert(rows.slice(i, i + chunkSize), { onConflict: "loyverse_variant_id" });
      if (error) throw new Error(`sku upsert: ${error.message}`);
    }

    await finishRun(runId, true, null, items.length, rows.length);
    return { rowsIn: items.length, rowsOut: rows.length };
  } catch (e: any) {
    await finishRun(runId, false, String(e?.message ?? e), 0, 0);
    throw e;
  }
}

async function syncStock(): Promise<{ rowsIn: number; rowsOut: number }> {
  const runId = await logRun("loyverse_stock", new Date());
  try {
    const levels = await fetchAllInventory();
    console.log(`[loyverse] ${levels.length} inventory levels`);

    // Map variant_id → sku.id. Must paginate: PostgREST caps SELECT at 1000
    // rows by default, and the unpaginated version silently dropped ~⅔ of
    // SKUs from the map → stock for those SKUs never got upserted and went
    // stale for days.
    const variantToId = new Map<string, string>();
    for (let cur = 0; ; cur += 1000) {
      const { data, error } = await supabase
        .from("sku")
        .select("id, loyverse_variant_id")
        .range(cur, cur + 999);
      if (error) throw new Error(`sku lookup: ${error.message}`);
      if (!data?.length) break;
      for (const s of data) variantToId.set(s.loyverse_variant_id, s.id);
      if (data.length < 1000) break;
    }

    const rows = [];
    let skipped = 0;
    for (const lvl of levels) {
      const sku_id = variantToId.get(lvl.variant_id);
      if (!sku_id) { skipped++; continue; }
      rows.push({
        sku_id,
        store_id: lvl.store_id,
        qty: Number(lvl.in_stock ?? 0),
        fetched_at: new Date().toISOString(),
      });
    }
    if (skipped) console.log(`[loyverse] ${skipped} levels skipped (no matching sku)`);

    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const { error } = await supabase
        .from("loyverse_stock")
        .upsert(rows.slice(i, i + chunkSize), { onConflict: "sku_id,store_id" });
      if (error) throw new Error(`stock upsert: ${error.message}`);
    }

    await finishRun(runId, true, null, levels.length, rows.length);
    return { rowsIn: levels.length, rowsOut: rows.length };
  } catch (e: any) {
    await finishRun(runId, false, String(e?.message ?? e), 0, 0);
    throw e;
  }
}

async function main() {
  const t0 = Date.now();
  const p = await syncProducts();
  console.log(`[loyverse] products: ${p.rowsOut} variants in ${Math.round((Date.now()-t0)/1000)}s`);
  const t1 = Date.now();
  const s = await syncStock();
  console.log(`[loyverse] stock: ${s.rowsOut} levels in ${Math.round((Date.now()-t1)/1000)}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
