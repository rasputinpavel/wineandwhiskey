const BASE_URL = "https://api.loyverse.com/v1.0";

interface Variant {
  variant_id: string;
  sku: string;
  default_price: number;
  cost: number;
}

interface Item {
  id: string;
  item_name: string;
  category_id: string;
  deleted_at: string | null;
  variants: Variant[];
}

interface Category {
  id: string;
  name: string;
}

interface InventoryLevel {
  variant_id: string;
  in_stock: number;
}

interface Receipt {
  receipt_number: string;
  receipt_date: string;
  total_money: number;
  line_items: { item_name: string; quantity: number; total_money: number }[];
}

// Simple in-memory cache — обновляется каждые 5 минут
let cache: { context: string; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

async function loyverseFetch<T>(path: string, key: string): Promise<T[]> {
  const token = process.env.LOYVERSE_API_TOKEN!;
  const results: T[] = [];
  let cursor: string | undefined;

  do {
    const url = `${BASE_URL}${path}?limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Loyverse API error: ${res.status} ${path}`);
    const data = await res.json();
    results.push(...(data[key] ?? []));
    cursor = data.cursor;
  } while (cursor);

  return results;
}

export async function getStoreContext(): Promise<string> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.context;

  const [items, categories, inventory] = await Promise.all([
    loyverseFetch<Item>("/items", "items"),
    loyverseFetch<Category>("/categories", "categories"),
    loyverseFetch<InventoryLevel>("/inventory", "inventory_levels"),
  ]);

  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  const inventoryMap = new Map(inventory.map((i) => [i.variant_id, i.in_stock]));

  const lines = items
    .filter((item) => !item.deleted_at && item.variants.length > 0)
    .map((item) => {
      const v = item.variants[0];
      const stock = inventoryMap.get(v.variant_id) ?? 0;
      const category = categoryMap.get(item.category_id) ?? "—";
      return `• ${item.item_name} [${category}] — цена: ${v.default_price} THB, остаток: ${stock} шт`;
    });

  const context = `КАТАЛОГ МАГАЗИНА (${lines.length} позиций):\n${lines.join("\n")}`;
  cache = { context, ts: Date.now() };
  return context;
}

// Structured catalog for write-off matching — same data as getStoreContext but
// returned as rows instead of a formatted string. Not cached here (the caller
// fetches at most once per write-off); reuses the same paginated fetch.
export async function getCatalogItems(): Promise<
  { variant_id: string; item_name: string; in_stock: number }[]
> {
  const [items, inventory] = await Promise.all([
    loyverseFetch<Item>("/items", "items"),
    loyverseFetch<InventoryLevel>("/inventory", "inventory_levels"),
  ]);
  const inventoryMap = new Map(inventory.map((i) => [i.variant_id, i.in_stock]));
  return items
    .filter((item) => !item.deleted_at && item.variants.length > 0)
    .map((item) => {
      const v = item.variants[0];
      return {
        variant_id: v.variant_id,
        item_name: item.item_name,
        in_stock: inventoryMap.get(v.variant_id) ?? 0,
      };
    });
}

export async function getRecentSales(days = 7): Promise<string> {
  const token = process.env.LOYVERSE_API_TOKEN!;
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const url = `${BASE_URL}/receipts?limit=250&created_at_min=${from}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const receipts: Receipt[] = data.receipts ?? [];

  if (receipts.length === 0) return `Продаж за последние ${days} дней не найдено.`;

  const total = receipts.reduce((sum, r) => sum + r.total_money, 0);
  const summary = `Продаж за ${days} дней: ${receipts.length} чеков, сумма: ${total.toFixed(0)} THB`;

  // Топ позиций
  const itemSales = new Map<string, { qty: number; revenue: number }>();
  for (const r of receipts) {
    for (const li of r.line_items ?? []) {
      const name = li.item_name;
      const cur = itemSales.get(name) ?? { qty: 0, revenue: 0 };
      itemSales.set(name, {
        qty: cur.qty + li.quantity,
        revenue: cur.revenue + li.total_money,
      });
    }
  }

  const top = [...itemSales.entries()]
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 10)
    .map(([name, s]) => `  ${name}: ${s.qty} шт (${s.revenue.toFixed(0)} THB)`);

  return `${summary}\n\nТоп продаж:\n${top.join("\n")}`;
}
