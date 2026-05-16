// Single-source aggregator for Loyverse sales with B2C / B2B channel split.
//
// Why this exists:
//   Multiple scripts (matrix, monthly margin, category breakdown, A-E
//   segmentation, B2B reserve) all need the same fact: "for each item,
//   how much was sold to B2C and to B2B over period X, with revenue,
//   cost, units, velocity". Computing this in each script independently
//   was leading to slightly different B2B classifiers, double pulls of
//   receipts, and bugs around customer name resolution. This file is
//   the only place that should fetch + classify + aggregate.

import { classifyReceipt } from "./b2b.js";

const LOYVERSE_TOKEN = process.env.LOYVERSE_API_TOKEN!;

// ─── Public types ────────────────────────────────────────────────────────

export interface ChannelStats {
  units: number;
  revenue: number;
  cost: number;
  margin: number;       // = revenue - cost
  marginPct: number;    // 0..1
  velocityPerMonth: number;
  checks: number;       // number of receipts touching this SKU in this channel
}

export interface ItemSales {
  itemId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  total: ChannelStats;
  b2c:   ChannelStats;
  b2b:   ChannelStats;
  // Per-B2B-customer breakdown — keyed by customer name from Loyverse.
  // For seeing who the regulars are and what they take.
  b2bByCustomer: Map<string, ChannelStats>;
}

export interface AggregateOptions {
  fromIso: string;
  toIso: string;
  // Pre-built maps if you already have them from elsewhere; otherwise the
  // function will fetch from Loyverse itself.
  itemMeta?: Map<string, { name: string; categoryId: string }>;
  categoryName?: Map<string, string>;
  // Optional filter: only aggregate items whose metadata passes this predicate.
  // Useful to scope to "wine only" without touching irrelevant categories.
  itemFilter?: (id: string, meta: { name: string; categoryId: string }) => boolean;
}

export interface AggregateResult {
  items: Map<string, ItemSales>;
  periodMonths: number;     // exact length of the window in months (for velocity)
  receiptsTotal: number;
  receiptsB2C: number;
  receiptsB2B: number;
}

// ─── Internal helpers ────────────────────────────────────────────────────

async function loyFetch<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const url = `https://api.loyverse.com/v1.0${path}${path.includes("?") ? "&" : "?"}limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` } });
    if (!r.ok) throw new Error(`Loyverse ${r.status}: ${path}`);
    const d = await r.json();
    out.push(...(d[key] ?? []));
    cursor = d.cursor;
  } while (cursor);
  return out;
}

async function fetchCustomerNames(ids: Set<string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all([...ids].map(async id => {
    try {
      const r = await fetch(`https://api.loyverse.com/v1.0/customers/${id}`, {
        headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` },
      });
      if (!r.ok) return;
      const c = await r.json();
      map.set(id, ((c.name ?? "").trim() || c.email || id.slice(0, 8)));
    } catch { /* drop — customer will be treated as anonymous B2C */ }
  }));
  return map;
}

function emptyStats(): ChannelStats {
  return { units: 0, revenue: 0, cost: 0, margin: 0, marginPct: 0, velocityPerMonth: 0, checks: 0 };
}

function finalizeStats(s: ChannelStats, periodMonths: number) {
  s.margin = s.revenue - s.cost;
  s.marginPct = s.revenue > 0 ? s.margin / s.revenue : 0;
  s.velocityPerMonth = periodMonths > 0 ? s.units / periodMonths : 0;
}

// ─── Main API ────────────────────────────────────────────────────────────

export async function aggregateSales(opts: AggregateOptions): Promise<AggregateResult> {
  const { fromIso, toIso } = opts;

  // 1. Resolve item metadata (cached if caller passed it in)
  let itemMeta = opts.itemMeta;
  let categoryName = opts.categoryName;
  if (!itemMeta || !categoryName) {
    const [cats, items] = await Promise.all([
      loyFetch<any>("/categories", "categories"),
      loyFetch<any>("/items", "items"),
    ]);
    categoryName = new Map(cats.map((c: any) => [c.id, c.name as string]));
    itemMeta = new Map();
    for (const it of items) {
      itemMeta.set(it.id, { name: it.item_name ?? it.name ?? "—", categoryId: it.category_id ?? "" });
    }
  }

  // 2. Fetch receipts for the window
  const minUtc = new Date(`${fromIso}T00:00:00+07:00`).toISOString();
  const maxUtc = new Date(`${toIso}T23:59:59+07:00`).toISOString();
  const receipts: any[] = await loyFetch(
    `/receipts?receipt_type=SALE&created_at_min=${minUtc}&created_at_max=${maxUtc}`,
    "receipts",
  );

  // 3. Resolve customer names (only those that appear)
  const custIds = new Set<string>();
  for (const r of receipts) if (r.customer_id) custIds.add(r.customer_id);
  const custNames = await fetchCustomerNames(custIds);

  // 4. Compute exact period length in months (for velocity)
  const days = Math.max(1, (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000 + 1);
  const periodMonths = days / 30.4375;

  // 5. Aggregate
  const items = new Map<string, ItemSales>();
  let receiptsB2C = 0, receiptsB2B = 0;

  function getOrInit(itemId: string): ItemSales | null {
    const meta = itemMeta!.get(itemId);
    if (!meta) return null;
    if (opts.itemFilter && !opts.itemFilter(itemId, meta)) return null;
    let row = items.get(itemId);
    if (!row) {
      row = {
        itemId, name: meta.name,
        categoryId: meta.categoryId,
        categoryName: categoryName!.get(meta.categoryId) ?? "—",
        total: emptyStats(), b2c: emptyStats(), b2b: emptyStats(),
        b2bByCustomer: new Map(),
      };
      items.set(itemId, row);
    }
    return row;
  }

  for (const r of receipts) {
    const customerName = r.customer_id ? (custNames.get(r.customer_id) ?? "") : "";
    const cls = classifyReceipt({ payments: r.payments, customerName });
    if (cls.isB2B) receiptsB2B++; else receiptsB2C++;

    // Per-receipt: each item line touches one channel.
    const seenInThisReceipt = new Set<string>();  // for `checks` counting (one check per SKU per receipt)
    for (const li of r.line_items ?? []) {
      const id = li.item_id as string;
      if (!id) continue;
      const row = getOrInit(id);
      if (!row) continue;
      const qty = Number(li.quantity ?? 0);
      const rev = Number(li.total_money ?? 0);
      const cost = Number(li.cost_total ?? 0);
      const channelStats = cls.isB2B ? row.b2b : row.b2c;
      channelStats.units += qty;
      channelStats.revenue += rev;
      channelStats.cost += cost;
      row.total.units += qty;
      row.total.revenue += rev;
      row.total.cost += cost;
      if (!seenInThisReceipt.has(id)) {
        channelStats.checks++;
        row.total.checks++;
        seenInThisReceipt.add(id);
      }
      // Per-customer B2B breakdown
      if (cls.isB2B && customerName) {
        let cs = row.b2bByCustomer.get(customerName);
        if (!cs) { cs = emptyStats(); row.b2bByCustomer.set(customerName, cs); }
        cs.units += qty; cs.revenue += rev; cs.cost += cost;
      }
    }
  }

  // 6. Finalize derived metrics
  for (const row of items.values()) {
    finalizeStats(row.total, periodMonths);
    finalizeStats(row.b2c, periodMonths);
    finalizeStats(row.b2b, periodMonths);
    for (const cs of row.b2bByCustomer.values()) finalizeStats(cs, periodMonths);
  }

  return {
    items,
    periodMonths,
    receiptsTotal: receipts.length,
    receiptsB2C,
    receiptsB2B,
  };
}

// Convenience: aggregate already-resolved items by category × channel.
// Returns Map<categoryName, { total, b2c, b2b, skuCount }>.
export function rollupByCategory(result: AggregateResult): Map<string, { total: ChannelStats; b2c: ChannelStats; b2b: ChannelStats; skuCount: number }> {
  const out = new Map<string, { total: ChannelStats; b2c: ChannelStats; b2b: ChannelStats; skuCount: number }>();
  for (const item of result.items.values()) {
    let row = out.get(item.categoryName);
    if (!row) {
      row = { total: emptyStats(), b2c: emptyStats(), b2b: emptyStats(), skuCount: 0 };
      out.set(item.categoryName, row);
    }
    for (const channel of ["total", "b2c", "b2b"] as const) {
      row[channel].units    += item[channel].units;
      row[channel].revenue  += item[channel].revenue;
      row[channel].cost     += item[channel].cost;
      row[channel].checks   += item[channel].checks;
    }
    row.skuCount++;
  }
  for (const row of out.values()) {
    finalizeStats(row.total, result.periodMonths);
    finalizeStats(row.b2c, result.periodMonths);
    finalizeStats(row.b2b, result.periodMonths);
  }
  return out;
}
