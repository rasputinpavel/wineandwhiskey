/**
 * sync_inventory_flow.ts
 *
 * Pulls Tax Invoices + Receipts from FlowAccount → inventory schema.
 *
 * Window: by default last 90 days (cover normal payment terms + buffer).
 * Override via FLOW_FROM=YYYY-MM-DD FLOW_TO=YYYY-MM-DD.
 *
 * Matching:
 *   - Each invoice line item is matched to inventory.sku by the shared
 *     fuzzy matcher in lib/sku_match.ts (token-set Jaccard + containment
 *     + Levenshtein-1 typo tolerance, volumes preserved as canonical
 *     vol<ml> tokens). Threshold 0.65. Lines below threshold get
 *     sku_id NULL and surface on /admin/unmapped.
 *   - B2B customer is matched/created by flowaccount_name (substring match
 *     against existing rows; new names are inserted with payment_terms_days=0
 *     so they show up for review).
 *
 * Usage: npx tsx 03_automation/sync_inventory_flow.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  openFlow, closeFlow,
  listInvoices, listReceipts,
  enrichInvoicesWithItems,
  type FlowInvoice, type FlowReceipt,
} from "./lib/flow";
import { matchSku, indexSkus, type IndexedSku, type SkuLite } from "./lib/sku_match";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { db: { schema: "inventory" } },
);

function defaultWindow(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 90);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

async function logStart(source: string) {
  const { data } = await supabase
    .from("sync_log")
    .insert({ source, started_at: new Date().toISOString() })
    .select("id")
    .single();
  return data!.id as string;
}
async function logFinish(id: string, ok: boolean, error: string | null, rowsIn: number, rowsOut: number) {
  await supabase
    .from("sync_log")
    .update({ finished_at: new Date().toISOString(), ok, error, rows_in: rowsIn, rows_out: rowsOut })
    .eq("id", id);
}

// ─── B2B customer registry helpers ─────────────────────────────────────

async function ensureB2bCustomer(name: string, cache: Map<string, string>): Promise<string> {
  const key = name.trim();
  const hit = cache.get(key.toLowerCase());
  if (hit) return hit;
  // Try to find existing by case-insensitive flowaccount_name.
  const { data: existing } = await supabase
    .from("b2b_customer")
    .select("id, flowaccount_name")
    .ilike("flowaccount_name", key)
    .maybeSingle();
  if (existing?.id) {
    cache.set(key.toLowerCase(), existing.id);
    return existing.id;
  }
  // Insert new.
  const { data: inserted, error } = await supabase
    .from("b2b_customer")
    .insert({ flowaccount_name: key, payment_terms_days: 0 })
    .select("id")
    .single();
  if (error) throw new Error(`b2b_customer insert "${key}": ${error.message}`);
  cache.set(key.toLowerCase(), inserted!.id);
  return inserted!.id;
}

// ─── SKU loading ───────────────────────────────────────────────────────

// Supabase caps select() at 1000 rows by default — paginate via .range()
// until we drain. We have ~2900 SKUs; with one page we'd silently miss 2/3
// of the catalog and break matching for anything past the first 1000.
async function loadSkus(): Promise<IndexedSku[]> {
  const out: SkuLite[] = [];
  for (let cur = 0; ; cur += 1000) {
    const { data, error } = await supabase
      .from("sku")
      .select("id, loyverse_product_code, name")
      .range(cur, cur + 999);
    if (error) throw new Error(`sku load: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as SkuLite[]));
    if (data.length < 1000) break;
  }
  return indexSkus(out);
}

// ─── Sync ──────────────────────────────────────────────────────────────

async function syncInvoices(invoices: FlowInvoice[], skus: IndexedSku[]) {
  const runId = await logStart("flowaccount_invoices");
  let written = 0;
  try {
    const customerCache = new Map<string, string>();

    for (const inv of invoices) {
      const customer_id = await ensureB2bCustomer(inv.client, customerCache);

      const { data: row, error } = await supabase
        .from("flowaccount_invoice")
        .upsert(
          {
            number: inv.number,
            customer_id,
            customer_name: inv.client,
            issued_at: inv.issueDate,
            due_at: null,                 // FlowAccount doesn't expose due date in list view
            status: inv.status,
            total: inv.amount,
            detail_url: inv.detailUrl,
            scraped_at: new Date().toISOString(),
          },
          { onConflict: "number" },
        )
        .select("id")
        .single();
      if (error) throw new Error(`invoice ${inv.number}: ${error.message}`);
      const invoice_id = row!.id as string;

      // Replace lines only when we actually re-read the detail page this run.
      // `lineItems === undefined` means we deliberately skipped enrich (already
      // Paid + already in DB) — keep existing lines untouched.
      if (inv.lineItems !== undefined) {
        await supabase.from("flowaccount_invoice_line").delete().eq("invoice_id", invoice_id);
        const lines = inv.lineItems.map(li => ({
          invoice_id,
          sku_id: matchSku(li.name, skus).sku?.id ?? null,
          raw_text: li.name,
          qty: li.quantity,
          amount: li.amount,
        }));
        if (lines.length) {
          const { error: lineErr } = await supabase.from("flowaccount_invoice_line").insert(lines);
          if (lineErr) throw new Error(`lines ${inv.number}: ${lineErr.message}`);
        }
      }
      written++;
    }
    await logFinish(runId, true, null, invoices.length, written);
  } catch (e: any) {
    await logFinish(runId, false, String(e?.message ?? e), invoices.length, written);
    throw e;
  }
}

async function syncReceipts(invoices: FlowInvoice[], receipts: FlowReceipt[]) {
  const runId = await logStart("flowaccount_receipts");
  let written = 0;
  try {
    // Build invoice number → id index from what we just wrote.
    const { data: invs } = await supabase
      .from("flowaccount_invoice")
      .select("id, number")
      .in("number", invoices.map(i => i.number));
    const byNumber = new Map((invs ?? []).map(i => [i.number, i.id]));

    for (const r of receipts) {
      const { data: row, error } = await supabase
        .from("flowaccount_receipt")
        .upsert(
          {
            number: r.number,
            customer_name: r.client,
            paid_at: r.date,
            amount: r.amount,
            scraped_at: new Date().toISOString(),
          },
          { onConflict: "number" },
        )
        .select("id")
        .single();
      if (error) throw new Error(`receipt ${r.number}: ${error.message}`);

      // Refresh receipt↔invoice link table for this receipt.
      await supabase.from("flowaccount_receipt_invoice").delete().eq("receipt_id", row!.id);
      const links = r.appliedInvoices
        .map(num => byNumber.get(num))
        .filter((id): id is string => !!id)
        .map(invoice_id => ({ receipt_id: row!.id, invoice_id }));
      if (links.length) {
        await supabase.from("flowaccount_receipt_invoice").insert(links);
      }
      written++;
    }
    await logFinish(runId, true, null, receipts.length, written);
  } catch (e: any) {
    await logFinish(runId, false, String(e?.message ?? e), receipts.length, written);
    throw e;
  }
}

async function main() {
  const { from, to } = defaultWindow();
  const fromIso = process.env.FLOW_FROM ?? from;
  const toIso   = process.env.FLOW_TO   ?? to;
  console.log(`[inv-flow] window ${fromIso} → ${toIso}`);

  const skus = await loadSkus();
  console.log(`[inv-flow] ${skus.length} SKUs loaded for matching`);

  const session = await openFlow();
  try {
    const invoices = await listInvoices(session, fromIso, toIso);

    // Listing can return 0 rows for two reasons:
    //   (a) genuinely no invoices in the window — rare but valid, e.g. a
    //       narrow workflow_dispatch range.
    //   (b) the page didn't render — session expired mid-run, DOM changed,
    //       Angular still loading. CI used to silently log ok=true rows_in=0
    //       in this case; we now fail loud so debug screenshots upload.
    // (a) is hard to distinguish, so we trust the default 90-day window:
    // there are always recent B2B invoices, so 0 rows in 90 days = (b).
    const isDefaultWindow = !process.env.FLOW_FROM && !process.env.FLOW_TO;
    if (invoices.length === 0 && isDefaultWindow) {
      throw new Error(
        "FlowAccount listing returned 0 invoices for the default 90-day window — " +
        "DOM probably didn't render (session bounced through workspace picker, or ngx-datatable not yet loaded). " +
        "Check debug-*.png artifacts."
      );
    }

    // Skip detail-page enrichment for invoices that were already Paid in our
    // DB and are still Paid in the listing — they don't change, and detail
    // scraping is the slow part (~30s per invoice). For the rest (new,
    // outstanding, or status-changed) we fetch line items as before.
    const { data: existingRows } = await supabase
      .from("flowaccount_invoice")
      .select("number, status")
      .in("number", invoices.map(i => i.number));
    const dbStatusByNumber = new Map((existingRows ?? []).map(r => [r.number, r.status]));

    const toEnrich = invoices.filter(i => {
      const dbStatus = dbStatusByNumber.get(i.number);
      if (!dbStatus)             return true;   // brand new
      if (dbStatus !== "Paid")   return true;   // was outstanding — re-check status + lines
      if (i.status !== "Paid")   return true;   // was Paid, now not — refresh
      return false;                              // already Paid, still Paid → skip
    });
    console.log(`[inv-flow] ${invoices.length} invoices listed, ${toEnrich.length} need detail-page enrichment`);

    await enrichInvoicesWithItems(session, toEnrich);
    const receipts = await listReceipts(session, fromIso, toIso);
    await syncInvoices(invoices, skus);
    await syncReceipts(invoices, receipts);
    console.log(`[inv-flow] done — ${invoices.length} invoices, ${receipts.length} receipts`);
  } finally {
    await closeFlow(session);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
