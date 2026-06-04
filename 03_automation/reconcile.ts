/**
 * reconcile.ts — READ-ONLY source-of-truth health check.
 *
 * For a period, compares net sales computed two ways and flags any divergence:
 *   1. LIVE   — pulled straight from Loyverse REST, classified with the shared
 *               classifyReceipt (the upstream truth).
 *   2. CACHE  — the inventory.loyverse_receipt mirror that Dashboard / Pulse /
 *               kiosk read (is_b2b precomputed at ingest).
 *
 * Convention (both sides): REFUND → −1, cancelled skipped, checks = non-refund.
 * This is what the audit fixes were supposed to make agree — run it to confirm.
 *
 * Usage:
 *   npm run reconcile                       # last full calendar month
 *   npm run reconcile -- --from 2026-05-01 --to 2026-05-31
 *   npm run reconcile -- --month 2026-05
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { loyverseFetch, fetchCustomerNames } from "./lib/loyverse.js";
import { classifyReceipt } from "./lib/b2b.js";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
  db: { schema: "inventory" },
});

// ─── Period resolution ─────────────────────────────────────────────────────
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function lastFullMonth(): { from: string; to: string } {
  const now = new Date();
  const firstThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastPrev = new Date(firstThis.getTime() - 86_400_000);
  const ym = `${lastPrev.getUTCFullYear()}-${String(lastPrev.getUTCMonth() + 1).padStart(2, "0")}`;
  return monthRange(ym);
}
function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}
const period = arg("month")
  ? monthRange(arg("month")!)
  : arg("from") && arg("to")
  ? { from: arg("from")!, to: arg("to")! }
  : lastFullMonth();

const FROM = period.from;
const TO = period.to;
const inWindow = (receiptDate: string) => {
  const d = receiptDate.slice(0, 10); // same basis as lib/dashboard.ts
  return d >= FROM && d <= TO;
};

// ─── Shape ─────────────────────────────────────────────────────────────────
type Rec = { total: number; cost: number; isRefund: boolean; isB2B: boolean };
type Agg = { revenue: number; cogs: number; checks: number; refunds: number; b2c: number; b2b: number };
const empty = (): Agg => ({ revenue: 0, cogs: 0, checks: 0, refunds: 0, b2c: 0, b2b: 0 });
function fold(map: Map<string, Rec>): Agg {
  const a = empty();
  for (const r of map.values()) {
    const sign = r.isRefund ? -1 : 1;
    a.revenue += r.total * sign;
    a.cogs += r.cost * sign;
    if (r.isRefund) a.refunds++;
    else a.checks++;
    if (r.isB2B) a.b2b += r.total * sign;
    else a.b2c += r.total * sign;
  }
  return a;
}
const thb = (n: number) => Math.round(n).toLocaleString("en-US");

async function main() {
  console.log(`\nReconcile — Loyverse LIVE vs cache (inventory.loyverse_receipt)`);
  console.log(`Period: ${FROM} → ${TO} (by receipt_date)\n`);

  // ─── LIVE ────────────────────────────────────────────────────────────────
  // Fetch a slightly wider created_at window, then filter by receipt_date.
  const minUtc = new Date(`${FROM}T00:00:00+07:00`).getTime() - 2 * 86_400_000;
  const maxUtc = new Date(`${TO}T23:59:59+07:00`).getTime() + 2 * 86_400_000;
  const liveReceipts: any[] = await loyverseFetch(
    `/receipts?created_at_min=${new Date(minUtc).toISOString()}&created_at_max=${new Date(maxUtc).toISOString()}`,
    "receipts",
  );
  const custIds = new Set<string>();
  for (const r of liveReceipts) if (r.customer_id && inWindow(r.receipt_date)) custIds.add(r.customer_id);
  const custNames = await fetchCustomerNames(custIds);

  const live = new Map<string, Rec>();
  let liveCancelled = 0;
  for (const r of liveReceipts) {
    if (!inWindow(r.receipt_date)) continue;
    if (r.cancelled_at) { liveCancelled++; continue; }
    const customerName = r.customer_id ? (custNames.get(r.customer_id) ?? "") : "";
    live.set(r.receipt_number, {
      total: Number(r.total_money ?? 0),
      cost: (r.line_items ?? []).reduce((s: number, l: any) => s + Number(l.cost_total ?? 0), 0),
      isRefund: r.receipt_type === "REFUND",
      isB2B: classifyReceipt({ payments: r.payments, customerName }).isB2B,
    });
  }

  // ─── CACHE ─────────────────────────────────────────────────────────────────
  const cache = new Map<string, Rec>();
  let pageFrom = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await sb
      .from("loyverse_receipt")
      .select("receipt_number, receipt_date, receipt_type, total, cost_total, is_b2b")
      .gte("receipt_date", `${FROM}T00:00:00`)
      .lte("receipt_date", `${TO}T23:59:59.999`)
      .range(pageFrom, pageFrom + PAGE - 1);
    if (error) throw new Error(`Supabase: ${error.message}`);
    for (const r of data ?? []) {
      if (!inWindow(r.receipt_date)) continue;
      cache.set(r.receipt_number, {
        total: Number(r.total ?? 0),
        cost: Number(r.cost_total ?? 0),
        isRefund: r.receipt_type === "REFUND",
        isB2B: !!r.is_b2b,
      });
    }
    if (!data || data.length < PAGE) break;
    pageFrom += PAGE;
  }

  // ─── Compare ───────────────────────────────────────────────────────────────
  const L = fold(live);
  const C = fold(cache);
  const row = (label: string, l: number, c: number, money = true) => {
    const d = l - c;
    const f = money ? thb : (n: number) => String(n);
    const flag = Math.abs(d) > (money ? 1 : 0) ? "  ⚠" : "  ✓";
    console.log(`  ${label.padEnd(16)} live ${f(l).padStart(12)} | cache ${f(c).padStart(12)} | Δ ${f(d).padStart(10)}${flag}`);
  };
  console.log(`Receipts: live ${live.size} · cache ${cache.size} · live cancelled skipped ${liveCancelled}\n`);
  row("Net revenue", L.revenue, C.revenue);
  row("COGS", L.cogs, C.cogs);
  row("Gross profit", L.revenue - L.cogs, C.revenue - C.cogs);
  row("  B2C revenue", L.b2c, C.b2c);
  row("  B2B revenue", L.b2b, C.b2b);
  row("Checks", L.checks, C.checks, false);
  row("Refunds", L.refunds, C.refunds, false);

  // Receipt-level divergences (what the cache that Dashboard/Pulse read is missing or got wrong).
  const missingInCache = [...live.keys()].filter((k) => !cache.has(k));
  const extraInCache = [...cache.keys()].filter((k) => !live.has(k));
  const totalMismatch: string[] = [];
  const b2bMismatch: string[] = [];
  for (const [k, lv] of live) {
    const c = cache.get(k);
    if (!c) continue;
    if (Math.abs(lv.total - c.total) > 1) totalMismatch.push(k);
    if (lv.isB2B !== c.isB2B) b2bMismatch.push(k);
  }

  console.log(`\nReceipt-level checks:`);
  const showSet = (label: string, arr: string[]) =>
    console.log(`  ${label.padEnd(34)} ${arr.length}${arr.length ? "  e.g. " + arr.slice(0, 5).join(", ") : ""}`);
  showSet("missing in cache (stale sync?)", missingInCache);
  showSet("in cache but not live", extraInCache);
  showSet("total mismatch", totalMismatch);
  showSet("is_b2b mismatch (classifier drift)", b2bMismatch);

  const clean =
    !missingInCache.length && !extraInCache.length && !totalMismatch.length && !b2bMismatch.length &&
    Math.abs(L.revenue - C.revenue) <= 1;
  console.log(`\n${clean ? "✅ Cache matches live Loyverse — source of truth is consistent." : "⚠ Divergence found — see above. If 'missing in cache', run: npm run inv:receipts"}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
