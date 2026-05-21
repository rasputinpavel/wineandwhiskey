/**
 * One-off: pull top retail customers from Loyverse receipts and produce
 * a reactivation list — name, contact, total spend, last visit, favourite
 * products / category.
 *
 * Filters:
 *   • is_b2b = false   (we want B2C only)
 *   • customer_id IS NOT NULL  (otherwise we can't reach them)
 *   • receipt_date >= today - WINDOW_DAYS  (default 365)
 *
 * Output:
 *   • Console summary
 *   • Markdown file in 10_sales/customer_reactivation/top_customers_YYYY-MM-DD.md
 *
 * Run:
 *   npx tsx 03_automation/_query_top_customers.ts
 *   WINDOW_DAYS=180 TOP_N=50 npx tsx 03_automation/_query_top_customers.ts
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
dotenv.config({ path: "/Users/pavelrasputin/Desktop/Wine_Whiskey/.env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { db: { schema: "inventory" } },
);

const WINDOW_DAYS = Number(process.env.WINDOW_DAYS ?? 365);
const TOP_N       = Number(process.env.TOP_N ?? 30);
const CAT_TOP_N   = Number(process.env.CAT_TOP_N ?? 5);

// Customers we never want to surface — case-insensitive, exact match on name.
// Yuri is the former owner; receipts under his card are not real B2C activity.
const EXCLUDED_NAMES = new Set(["yuri"]);

type Receipt = {
  id: string;
  receipt_date: string;
  receipt_type: string;
  customer_id: string | null;
  customer_name: string | null;
  total: number;
};

type Line = {
  receipt_id: string;
  sku: string | null;
  product_name: string | null;
  qty: number;
  line_total: number;
};

type Sku = {
  loyverse_product_code: string | null;
  name: string;
  category: string | null;
};

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

async function fetchAll<T>(builder: () => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await builder().range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function main() {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400 * 1000);
  console.log(`[top-customers] window: ${iso(since)} → ${iso(new Date())} (${WINDOW_DAYS}d)`);

  // 1) Receipts: B2C only, with customer_id
  console.log("[top-customers] fetching receipts ...");
  const receipts = await fetchAll<Receipt>(() =>
    supabase
      .from("loyverse_receipt")
      .select("id, receipt_date, receipt_type, customer_id, customer_name, total")
      .eq("is_b2b", false)
      .not("customer_id", "is", null)
      .gte("receipt_date", since.toISOString())
      .order("receipt_date", { ascending: false }),
  );
  console.log(`[top-customers]   ${receipts.length} receipts`);

  if (receipts.length === 0) {
    console.log("No receipts found — nothing to do.");
    return;
  }

  const receiptIds = receipts.map(r => r.id);
  const receiptById = new Map(receipts.map(r => [r.id, r]));

  // 2) Lines — chunk by IN clause (max ~1000 ids per request)
  console.log("[top-customers] fetching receipt lines ...");
  const lines: Line[] = [];
  for (let i = 0; i < receiptIds.length; i += 100) {
    const chunk = receiptIds.slice(i, i + 100);
    const { data, error } = await supabase
      .from("loyverse_receipt_line")
      .select("receipt_id, sku, product_name, qty, line_total")
      .in("receipt_id", chunk);
    if (error) throw error;
    lines.push(...((data ?? []) as Line[]));
  }
  console.log(`[top-customers]   ${lines.length} lines`);

  // 3) SKU master — for category mapping
  console.log("[top-customers] fetching sku master ...");
  const skus = await fetchAll<Sku>(() =>
    supabase.from("sku").select("loyverse_product_code, name, category"),
  );
  const catByCode = new Map<string, string>();
  const nameByCode = new Map<string, string>();
  for (const s of skus) {
    if (!s.loyverse_product_code) continue;
    if (s.category) catByCode.set(s.loyverse_product_code, s.category);
    nameByCode.set(s.loyverse_product_code, s.name);
  }
  console.log(`[top-customers]   ${skus.length} sku rows, ${catByCode.size} with category`);

  // 4) Customers contact info
  console.log("[top-customers] fetching customer contacts ...");
  const customerIds = Array.from(new Set(receipts.map(r => r.customer_id!).filter(Boolean)));
  const customerById = new Map<string, Customer>();
  for (let i = 0; i < customerIds.length; i += 100) {
    const chunk = customerIds.slice(i, i + 100);
    const { data, error } = await supabase
      .from("loyverse_customer")
      .select("id, name, email, phone")
      .in("id", chunk);
    if (error) throw error;
    for (const c of (data ?? []) as Customer[]) customerById.set(c.id, c);
  }
  console.log(`[top-customers]   ${customerById.size} customers resolved`);

  // 5) Aggregate per customer
  type ProdAgg = { name: string; qty: number; revenue: number; category: string };
  type CustAgg = {
    customer_id: string;
    name: string;
    email: string | null;
    phone: string | null;
    receipts: number;
    refund_count: number;
    total_spent: number;        // net of refunds
    last_visit: string;
    first_visit: string;
    products: Map<string, ProdAgg>; // key = sku (or product_name fallback)
    byCategory: Map<string, { qty: number; revenue: number }>;
  };

  const agg = new Map<string, CustAgg>();
  for (const r of receipts) {
    const cid = r.customer_id!;
    let a = agg.get(cid);
    if (!a) {
      const c = customerById.get(cid);
      a = {
        customer_id: cid,
        name: c?.name ?? r.customer_name ?? "(unnamed)",
        email: c?.email ?? null,
        phone: c?.phone ?? null,
        receipts: 0,
        refund_count: 0,
        total_spent: 0,
        last_visit: r.receipt_date,
        first_visit: r.receipt_date,
        products: new Map(),
        byCategory: new Map(),
      };
      agg.set(cid, a);
    }
    const isRefund = r.receipt_type === "REFUND";
    if (isRefund) a.refund_count += 1;
    else a.receipts += 1;
    // total is positive in SALE, negative in REFUND already? Loyverse stores refund as positive
    // total_money; conservatively subtract for refunds.
    a.total_spent += (isRefund ? -1 : 1) * Number(r.total ?? 0);
    if (r.receipt_date > a.last_visit) a.last_visit = r.receipt_date;
    if (r.receipt_date < a.first_visit) a.first_visit = r.receipt_date;
  }

  // 6) Attach lines to customers
  for (const l of lines) {
    const r = receiptById.get(l.receipt_id);
    if (!r || !r.customer_id) continue;
    const a = agg.get(r.customer_id);
    if (!a) continue;
    const isRefund = r.receipt_type === "REFUND";
    const sign = isRefund ? -1 : 1;
    const code = l.sku ?? "";
    const key  = code || (l.product_name ?? "(no name)");
    const cat  = (code ? catByCode.get(code) : undefined) ?? "Uncategorised";
    const niceName = (code ? nameByCode.get(code) : undefined) ?? l.product_name ?? "(no name)";

    let p = a.products.get(key);
    if (!p) { p = { name: niceName, qty: 0, revenue: 0, category: cat }; a.products.set(key, p); }
    p.qty     += sign * Number(l.qty ?? 0);
    p.revenue += sign * Number(l.line_total ?? 0);

    let c = a.byCategory.get(cat);
    if (!c) { c = { qty: 0, revenue: 0 }; a.byCategory.set(cat, c); }
    c.qty     += sign * Number(l.qty ?? 0);
    c.revenue += sign * Number(l.line_total ?? 0);
  }

  // 7) Sort & emit (excluding blocklisted names)
  const customers = [...agg.values()]
    .filter(c => !EXCLUDED_NAMES.has(c.name.trim().toLowerCase()))
    .sort((a, b) => b.total_spent - a.total_spent);
  const today = iso(new Date());

  function daysAgo(d: string): number {
    return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  }

  function fmtThb(n: number): string {
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  // ── Console summary ──────────────────────────────────────────────────────
  console.log("");
  console.log(`=== TOP ${TOP_N} CUSTOMERS — last ${WINDOW_DAYS}d ===`);
  console.log("");
  console.log("rank | spent (THB) | visits | last visit (days ago) | name");
  console.log("-----+-------------+--------+-----------------------+--------------------------");
  customers.slice(0, TOP_N).forEach((c, i) => {
    const dAgo = daysAgo(c.last_visit);
    const lastStr = `${c.last_visit.slice(0, 10)} (${dAgo}d)`;
    console.log(
      `${String(i + 1).padStart(4)} | ${fmtThb(c.total_spent).padStart(11)} | ${String(c.receipts).padStart(6)} | ${lastStr.padEnd(21)} | ${c.name}`,
    );
  });

  // Category leaders
  type CatLeader = { cat: string; customer: string; qty: number; revenue: number };
  const catBuyers = new Map<string, Array<{ cust: CustAgg; qty: number; revenue: number }>>();
  for (const c of customers) {
    for (const [cat, v] of c.byCategory) {
      if (!catBuyers.has(cat)) catBuyers.set(cat, []);
      catBuyers.get(cat)!.push({ cust: c, qty: v.qty, revenue: v.revenue });
    }
  }
  for (const arr of catBuyers.values()) arr.sort((a, b) => b.revenue - a.revenue);

  console.log("");
  console.log("=== CATEGORY LEADERS ===");
  const sortedCats = [...catBuyers.entries()]
    .map(([cat, arr]) => ({ cat, total: arr.reduce((s, x) => s + x.revenue, 0), arr }))
    .sort((a, b) => b.total - a.total);
  for (const { cat, total, arr } of sortedCats) {
    console.log("");
    console.log(`-- ${cat} — total ${fmtThb(total)} THB across ${arr.length} buyers`);
    arr.slice(0, CAT_TOP_N).forEach((x, i) => {
      console.log(`   ${i + 1}. ${fmtThb(x.revenue).padStart(8)} THB — ${x.cust.name} (${x.cust.receipts} visits, last ${daysAgo(x.cust.last_visit)}d ago)`);
    });
  }

  // ── Markdown output ──────────────────────────────────────────────────────
  const outDir = "/Users/pavelrasputin/Desktop/Wine_Whiskey/10_sales/customer_reactivation";
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `top_customers_${today}.md`);

  const lines_md: string[] = [];
  lines_md.push(`# Top customers — reactivation list`);
  lines_md.push("");
  lines_md.push(`_Generated ${today}. Window: last ${WINDOW_DAYS} days. B2C only (is_b2b=false, customer_id set)._`);
  lines_md.push("");
  lines_md.push(`Total customers in window: **${customers.length}**`);
  lines_md.push("");

  lines_md.push(`## Top ${TOP_N} by net spend`);
  lines_md.push("");
  lines_md.push(`| # | Customer | Phone | Email | Spent (THB) | Visits | Last visit | Days ago | Favourite (top 3) |`);
  lines_md.push(`|---|---|---|---|---:|---:|---|---:|---|`);
  customers.slice(0, TOP_N).forEach((c, i) => {
    const top3 = [...c.products.values()]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 3)
      .map(p => `${p.name} ×${p.qty}`)
      .join("; ");
    lines_md.push(
      `| ${i + 1} | ${c.name} | ${c.phone ?? ""} | ${c.email ?? ""} | ${fmtThb(c.total_spent)} | ${c.receipts} | ${c.last_visit.slice(0, 10)} | ${daysAgo(c.last_visit)} | ${top3} |`,
    );
  });
  lines_md.push("");

  lines_md.push(`## Category leaders (top ${CAT_TOP_N} per category)`);
  lines_md.push("");
  for (const { cat, total, arr } of sortedCats) {
    lines_md.push(`### ${cat} — ${fmtThb(total)} THB, ${arr.length} buyers`);
    lines_md.push("");
    lines_md.push(`| # | Customer | Phone | Revenue (THB) | Qty | Last visit | Days ago |`);
    lines_md.push(`|---|---|---|---:|---:|---|---:|`);
    arr.slice(0, CAT_TOP_N).forEach((x, i) => {
      lines_md.push(
        `| ${i + 1} | ${x.cust.name} | ${x.cust.phone ?? ""} | ${fmtThb(x.revenue)} | ${x.qty} | ${x.cust.last_visit.slice(0, 10)} | ${daysAgo(x.cust.last_visit)} |`,
      );
    });
    lines_md.push("");
  }

  // Per-customer detail (top N): full product breakdown
  lines_md.push(`## Per-customer detail — top ${TOP_N}`);
  lines_md.push("");
  lines_md.push(`Use this section as input for personalised reactivation messages.`);
  lines_md.push("");
  customers.slice(0, TOP_N).forEach((c, i) => {
    lines_md.push(`### ${i + 1}. ${c.name}`);
    const contact: string[] = [];
    if (c.phone) contact.push(`📱 ${c.phone}`);
    if (c.email) contact.push(`✉️ ${c.email}`);
    if (contact.length) lines_md.push(contact.join(" · "));
    lines_md.push("");
    lines_md.push(`- **Spent:** ${fmtThb(c.total_spent)} THB across ${c.receipts} visits (${c.refund_count} refunds)`);
    lines_md.push(`- **Last visit:** ${c.last_visit.slice(0, 10)} (${daysAgo(c.last_visit)} days ago)`);
    lines_md.push(`- **First visit (in window):** ${c.first_visit.slice(0, 10)}`);
    const cats = [...c.byCategory.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
    if (cats.length) {
      lines_md.push(`- **Category mix:** ${cats.map(([k, v]) => `${k} ${fmtThb(v.revenue)}฿`).join(" · ")}`);
    }
    const tops = [...c.products.values()]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);
    if (tops.length) {
      lines_md.push(`- **Top products:**`);
      for (const p of tops) {
        lines_md.push(`  - ${p.name} — ${p.qty} bot, ${fmtThb(p.revenue)} THB _(${p.category})_`);
      }
    }
    lines_md.push("");
  });

  fs.writeFileSync(outFile, lines_md.join("\n"));
  console.log("");
  console.log(`[top-customers] wrote ${outFile}`);
}

main().catch(e => { console.error(e); process.exit(1); });
