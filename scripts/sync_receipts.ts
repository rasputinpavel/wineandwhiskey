/**
 * sync_receipts.ts
 * Pulls all sales receipts from Loyverse API and upserts into Supabase.
 *
 * Tables: receipts, receipt_items
 * Strategy: incremental — fetches from the latest receipt_date in Supabase.
 *           Pass --all to re-sync from 2024-01-01.
 *
 * Usage:
 *   npx tsx scripts/sync_receipts.ts          # incremental
 *   npx tsx scripts/sync_receipts.ts --all    # full re-sync
 *
 * First run: create tables in Supabase SQL editor:
 *
 *   create table if not exists receipts (
 *     id              bigserial primary key,
 *     receipt_number  text unique not null,
 *     receipt_date    date not null,
 *     total_money     numeric,
 *     customer_id     text,
 *     synced_at       timestamptz default now()
 *   );
 *
 *   create table if not exists receipt_items (
 *     id             bigserial primary key,
 *     receipt_number text not null references receipts(receipt_number) on delete cascade,
 *     item_name      text,
 *     sku            text,
 *     variant_id     text,
 *     quantity       numeric,
 *     price          numeric,
 *     total_money    numeric,
 *     cost           numeric,
 *     cost_total     numeric
 *   );
 *
 *   create index if not exists receipt_items_sku on receipt_items(sku);
 *   create index if not exists receipts_date    on receipts(receipt_date);
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const LOYVERSE_TOKEN   = process.env.LOYVERSE_API_TOKEN!;
const SUPABASE_URL     = process.env.SUPABASE_URL!;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY!;
const FULL_SYNC_FROM   = "2024-01-01T00:00:00.000Z";
const BATCH_SIZE       = 500;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Loyverse ──────────────────────────────────────────────────────────────

async function loyverseFetch<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const url = `https://api.loyverse.com/v1.0${path}${path.includes("?") ? "&" : "?"}limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45_000);
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` },
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`Loyverse ${r.status}: ${await r.text()}`);
      const d = await r.json();
      out.push(...(d[key] ?? []));
      cursor = d.cursor;
    } finally {
      clearTimeout(t);
    }
  } while (cursor);
  return out;
}

// ─── Supabase helpers ──────────────────────────────────────────────────────

async function getLastSyncedDate(): Promise<string> {
  const { data } = await supabase
    .from("receipts")
    .select("receipt_date")
    .order("receipt_date", { ascending: false })
    .limit(1)
    .single();

  if (data?.receipt_date) {
    // subtract 1 day to re-check partial day
    const d = new Date(data.receipt_date);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10) + "T00:00:00.000Z";
  }
  return FULL_SYNC_FROM;
}

async function upsertBatch(rows: any[], table: string, conflictCol: string) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: conflictCol });
    if (error) throw new Error(`Supabase upsert ${table}: ${error.message}`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const fullSync = process.argv.includes("--all");

  const from = fullSync ? FULL_SYNC_FROM : await getLastSyncedDate();
  const to   = new Date(Date.now() + 7 * 3600_000).toISOString(); // Bangkok now

  console.log(`\nWine & Whiskey — Receipts Sync`);
  console.log(`Mode: ${fullSync ? "full" : "incremental"} | from: ${from.slice(0, 10)}\n`);

  console.log("Fetching receipts from Loyverse...");
  const receipts = await loyverseFetch<any>(
    `/receipts?receipt_type=SALE&created_at_min=${from}&created_at_max=${to}`,
    "receipts"
  );
  console.log(`  ${receipts.length} receipts fetched.`);

  if (receipts.length === 0) {
    console.log("Nothing to sync.");
    return;
  }

  const receiptRows: any[] = [];
  const itemRows: any[]    = [];

  for (const r of receipts) {
    const receiptDate = (r.receipt_date ?? r.created_at ?? "").slice(0, 10);
    if (!receiptDate) continue;

    receiptRows.push({
      receipt_number: r.receipt_number,
      receipt_date:   receiptDate,
      total_money:    r.total_money ?? 0,
      customer_id:    r.customer_id ?? null,
      synced_at:      new Date().toISOString(),
    });

    for (const li of r.line_items ?? []) {
      itemRows.push({
        receipt_number: r.receipt_number,
        item_name:      li.item_name    ?? null,
        sku:            li.sku          ?? null,
        variant_id:     li.variant_id   ?? null,
        quantity:       li.quantity     ?? 0,
        price:          li.price        ?? 0,
        total_money:    li.total_money  ?? 0,
        cost:           li.cost         ?? 0,
        cost_total:     li.cost_total   ?? 0,
      });
    }
  }

  console.log(`Upserting ${receiptRows.length} receipts...`);
  await upsertBatch(receiptRows, "receipts", "receipt_number");

  console.log(`Upserting ${itemRows.length} receipt items...`);
  // Delete existing items for these receipts first (clean re-insert)
  const receiptNumbers = receiptRows.map(r => r.receipt_number);
  for (let i = 0; i < receiptNumbers.length; i += BATCH_SIZE) {
    const batch = receiptNumbers.slice(i, i + BATCH_SIZE);
    await supabase.from("receipt_items").delete().in("receipt_number", batch);
  }
  await upsertBatch(itemRows, "receipt_items", "id");

  console.log(`\n✓ Done. Synced ${receiptRows.length} receipts, ${itemRows.length} line items.\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
