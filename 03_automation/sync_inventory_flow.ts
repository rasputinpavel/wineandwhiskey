/**
 * sync_inventory_flow.ts
 *
 * Pulls Tax Invoices + Receipts from FlowAccount → inventory schema.
 *
 * Strategy (fast, low blast radius):
 *   1. Listing — only the first few pages of FA's invoice/receipt grids
 *      (sorted newest-first). Catches brand-new invoices and recent status
 *      changes. We DO NOT walk the whole history every run.
 *   2. Stragglers — read DB for invoices we still believe are outstanding
 *      (status NOT IN Paid/Cancelled) but that weren't on the listing pages.
 *      For each, open its detail page via the saved detail_url to refresh
 *      status + line items. Typically ~10–15 rows for a stable B2B account.
 *
 * Window default: 30 days. Window only affects how the listing rows are
 * filtered — straggler refresh ignores it. Override with
 * FLOW_FROM=YYYY-MM-DD FLOW_TO=YYYY-MM-DD when you need a manual backfill.
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
  from.setDate(from.getDate() - 30);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

// First N pages of FA's grid. Sorted newest-first; 3 pages × ~20 rows = ~60
// most recent invoices. Older outstanding stuff is picked up via DB
// stragglers, so we don't need to walk the whole history.
const LISTING_PAGES = 3;

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
  // `??` doesn't catch empty strings, but workflow_dispatch passes blanks as
  // "" not undefined. Use `||` so blank inputs fall back to the default window.
  const fromIso = process.env.FLOW_FROM || from;
  const toIso   = process.env.FLOW_TO   || to;
  console.log(`[inv-flow] window ${fromIso} → ${toIso}`);

  const skus = await loadSkus();
  console.log(`[inv-flow] ${skus.length} SKUs loaded for matching`);

  const session = await openFlow();
  try {
    // ─── Phase 1: recent listing ───────────────────────────────────────
    // Just the first few pages — sorted newest-first, so this catches new
    // invoices + any recent status changes. Walking 16 pages was making
    // CI flaky and slow without buying us anything.
    const listed = await listInvoices(session, fromIso, toIso, LISTING_PAGES);
    console.log(`[inv-flow] ${listed.length} invoices on first ${LISTING_PAGES} listing page(s)`);

    // ─── Phase 2: stragglers from DB ───────────────────────────────────
    // Anything we still believe is outstanding but wasn't on those pages.
    // For each, we'll re-open its detail page below to refresh status + lines.
    const listedNumbers = new Set(listed.map(i => i.number));
    const { data: dbOutstanding } = await supabase
      .from("flowaccount_invoice")
      .select("number, customer_name, issued_at, status, total, detail_url")
      .not("status", "in", '("Paid","Cancelled")');
    const stragglers: FlowInvoice[] = (dbOutstanding ?? [])
      .filter(r => !listedNumbers.has(r.number) && !!r.detail_url)
      .map(r => ({
        number:    r.number,
        issueDate: r.issued_at,
        client:    r.customer_name,
        amount:    Number(r.total),
        status:    r.status,
        detailUrl: r.detail_url,
        linkedReceipts: [],
      }));
    console.log(`[inv-flow] ${stragglers.length} outstanding stragglers from DB to refresh`);

    const invoices = [...listed, ...stragglers];

    // Empty-listing guard. We expect Phase 1 to ALWAYS return at least one row
    // for an active account in the default 30-day window — there is always
    // something issued. If listing comes back empty, it's a DOM/auth failure
    // even when stragglers still populate (Phase 2 walks saved detail_url's
    // and won't surface anything FA changed under us). Failing here gives us a
    // red dot in the portal + flow-debug-empty-list.* artefacts in the repo
    // root, instead of silently masking a broken scraper.
    const isDefaultWindow = !process.env.FLOW_FROM && !process.env.FLOW_TO;
    if (listed.length === 0 && isDefaultWindow) {
      throw new Error(
        "FlowAccount listing scrape returned 0 rows. Likely auth / DOM failure — " +
        "FA may have changed the /invoices grid markup. Check flow-debug-empty-list.{png,html}. " +
        `(Phase 2 stragglers found ${stragglers.length}, but those don't surface new invoices.)`
      );
    }

    // ─── Phase 3: enrich only what needs it ────────────────────────────
    // Skip Paid-in-DB-and-still-Paid invoices entirely — they don't change.
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
    console.log(`[inv-flow] ${toEnrich.length} invoices need detail-page enrichment`);

    await enrichInvoicesWithItems(session, toEnrich);

    // ─── Phase 4: receipts (capped) ────────────────────────────────────
    const receipts = await listReceipts(session, fromIso, toIso, LISTING_PAGES);
    console.log(`[inv-flow] ${receipts.length} receipts on first ${LISTING_PAGES} listing page(s)`);

    await syncInvoices(invoices, skus);
    await syncReceipts(invoices, receipts);
    console.log(`[inv-flow] done — ${listed.length} listed + ${stragglers.length} stragglers, ${receipts.length} receipts`);
  } finally {
    await closeFlow(session);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
