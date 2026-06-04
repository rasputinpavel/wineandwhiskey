// Loyverse tools — вызываются Claude'ом через tool use

import { createClient } from "@supabase/supabase-js";

const BASE_URL = "https://api.loyverse.com/v1.0";

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

function token() {
  return process.env.LOYVERSE_API_TOKEN!;
}

async function loyverseFetch<T>(path: string, key: string): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;
  do {
    const url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000); // 15 сек на запрос
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token()}` },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Loyverse ${res.status}: ${path}`);
      const data = await res.json();
      results.push(...(data[key] ?? []));
      cursor = data.cursor;
    } finally {
      clearTimeout(timeout);
    }
  } while (cursor);
  return results;
}

// --- Tool: получить продажи за период ---
export async function getSales(dateFrom: string, dateTo: string): Promise<string> {
  const from = new Date(dateFrom).toISOString();
  const to = new Date(dateTo + "T23:59:59").toISOString();

  const receipts: any[] = await loyverseFetch(
    `/receipts?receipt_type=SALE&created_at_min=${from}&created_at_max=${to}`,
    "receipts"
  );

  if (receipts.length === 0) return `За период ${dateFrom} — ${dateTo} продаж не найдено.`;

  // Loyverse ignores receipt_type=SALE and returns REFUND rows too. Net them
  // out (REFUND → −1) and drop cancelled receipts so revenue/GP/checks match
  // the native Dashboard (see lib/dashboard.ts). Refunds aren't transactions.
  let totalRevenue = 0;
  let totalCost = 0;
  let checks = 0;

  const itemSales = new Map<string, { qty: number; revenue: number; cost: number }>();
  for (const r of receipts) {
    if (r.cancelled_at) continue;                       // voided — never a sale
    const sign = r.receipt_type === "REFUND" ? -1 : 1;  // refunds reduce net sales
    if (sign > 0) checks++;
    totalRevenue += r.total_money * sign;
    for (const li of r.line_items ?? []) {
      const name = li.item_name;
      const cur = itemSales.get(name) ?? { qty: 0, revenue: 0, cost: 0 };
      const lineCost = (li.cost_total ?? 0) * sign;
      totalCost += lineCost;
      itemSales.set(name, {
        qty: cur.qty + li.quantity * sign,
        revenue: cur.revenue + li.total_money * sign,
        cost: cur.cost + lineCost,
      });
    }
  }

  const grossProfit = totalRevenue - totalCost;
  const margin = totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : "0";

  const top = [...itemSales.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 10)
    .map(([name, s]) => {
      const gp = s.revenue - s.cost;
      const gpMargin = s.revenue > 0 ? ((gp / s.revenue) * 100).toFixed(0) : "0";
      return `  • ${name}: ${s.qty} шт — ${s.revenue.toFixed(0)} THB (GP: ${gp.toFixed(0)} THB, ${gpMargin}%)`;
    });

  return [
    `Период: ${dateFrom} — ${dateTo}`,
    `Чеков: ${checks}`,
    `Выручка: ${totalRevenue.toFixed(0)} THB`,
    `Себестоимость: ${totalCost.toFixed(0)} THB`,
    `Gross Profit: ${grossProfit.toFixed(0)} THB (маржа ${margin}%)`,
    ``,
    `Топ по выручке:`,
    ...top,
  ].join("\n");
}

// --- Tool: получить остатки ---
export async function getInventory(filter?: string): Promise<string> {
  const [items, categories, inventory] = await Promise.all([
    loyverseFetch<any>("/items", "items"),
    loyverseFetch<any>("/categories", "categories"),
    loyverseFetch<any>("/inventory", "inventory_levels"),
  ]);

  const catMap = new Map(categories.map((c: any) => [c.id, c.name]));
  const invMap = new Map(inventory.map((i: any) => [i.variant_id, i.in_stock]));

  let list = items
    .filter((item: any) => !item.deleted_at && item.variants.length > 0)
    .map((item: any) => {
      const v = item.variants[0];
      const stock = invMap.get(v.variant_id) ?? 0;
      const category = catMap.get(item.category_id) ?? "—";
      return { name: item.item_name, category, price: v.default_price, stock };
    });

  if (filter) {
    const f = filter.toLowerCase();
    list = list.filter(
      (i: any) => i.name.toLowerCase().includes(f) || i.category.toLowerCase().includes(f)
    );
  }

  if (list.length === 0) return `Товары по запросу "${filter}" не найдены.`;

  const lines = list
    .sort((a: any, b: any) => a.stock - b.stock)
    .map((i: any) => `  • ${i.name} [${i.category}] — ${i.price} THB, остаток: ${i.stock} шт`);

  return `Найдено ${list.length} позиций:\n${lines.join("\n")}`;
}

// Категории по типу — для правильного подсчёта бутылок
const WINE_CATS = new Set([
  "Red Wine", "White Wine", "Rose Wine", "Orange Wine",
  "Sparkling Wine", "Fortified Wine", "Sherry wine", "Pét-Nat", "Natural Wine",
]);
const SPIRITS_CATS = new Set([
  "Whiskey", "Rum", "Gin", "Vodka", "Cognac Armagnac",
  "Tequila", "Calvados & Sidr", "Grappa", "Liquor", "Sake",
]);
const BEER_CATS = new Set(["Beer"]);
// Не бутылки — всегда исключаем
const EXCLUDE_CATS = new Set(["Accessories", "Food", "Cigar", "Cigar Accessories"]);

// Объём в названии → скорее всего напиток
const VOLUME_RE = /\b\d+\s*(ml|мл|л|l|cl)\b|\b(750|700|500|375|1000|1500|3000)\b/i;

// Ключевые слова для классификации по названию
const WINE_KEYWORDS = /cabernet|sauvignon|chardonnay|merlot|pinot|riesling|syrah|grenache|malbec|viognier|chenin|gewurz|semillon|nebbiolo|sangiovese|tempranillo|moscato|muscat|chablis|burgundy|bordeaux|chianti|prosecco|champagne|cava|cremant|brut|blanc|rouge|rosé|rose|wine|вино|шампан/i;
const SPIRITS_KEYWORDS = /whisky|whiskey|bourbon|scotch|vodka|водка|gin|джин|rum|ром|tequila|текила|mezcal|cognac|коньяк|armagnac|armagnac|brandy|calvados|grappa|sake|саке|lagoda|absolut|grey goose|beluga|jameson|jack daniel|hennessy|martell|remy|johnnie|glenfiddich|macallan|highland|islay/i;

function classifyByName(name: string): "wine" | "spirits" | "bottle" | null {
  if (!VOLUME_RE.test(name)) return null; // нет объёма — не бутылка
  if (WINE_KEYWORDS.test(name)) return "wine";
  if (SPIRITS_KEYWORDS.test(name)) return "spirits";
  return "bottle"; // объём есть, тип неясен
}

// --- Tool: сводка по остаткам на складе ---
export async function getInventorySummary(): Promise<string> {
  const [items, categories, inventory] = await Promise.all([
    loyverseFetch<any>("/items", "items"),
    loyverseFetch<any>("/categories", "categories"),
    loyverseFetch<any>("/inventory", "inventory_levels"),
  ]);

  const catMap = new Map(categories.map((c: any) => [c.id, c.name]));
  const invMap = new Map(inventory.map((i: any) => [i.variant_id, i.in_stock]));

  let wine = 0;
  let spirits = 0;
  let beer = 0;
  let otherBottles = 0; // объём в названии, тип неясен
  const wineByType = new Map<string, number>();
  const spiritsByType = new Map<string, number>();

  for (const item of items) {
    if (item.deleted_at || !item.variants.length) continue;
    const v = item.variants[0];
    const stock = invMap.get(v.variant_id) ?? 0;
    if (stock <= 0) continue;

    const cat = catMap.get(item.category_id) ?? "—";
    if (EXCLUDE_CATS.has(cat)) continue;

    if (WINE_CATS.has(cat)) {
      wine += stock;
      wineByType.set(cat, (wineByType.get(cat) ?? 0) + stock);
    } else if (SPIRITS_CATS.has(cat)) {
      spirits += stock;
      spiritsByType.set(cat, (spiritsByType.get(cat) ?? 0) + stock);
    } else if (BEER_CATS.has(cat)) {
      beer += stock;
    } else {
      // Категория неизвестная — определяем по названию
      const nameType = classifyByName(item.item_name);
      if (nameType === "wine") {
        wine += stock;
        wineByType.set(cat, (wineByType.get(cat) ?? 0) + stock);
      } else if (nameType === "spirits") {
        spirits += stock;
        spiritsByType.set(cat, (spiritsByType.get(cat) ?? 0) + stock);
      } else if (nameType === "bottle") {
        otherBottles += stock;
      }
      // null → не похоже на бутылку, пропускаем
    }
  }

  const total = wine + spirits + beer + otherBottles;

  const wineLines = [...wineByType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, qty]) => `  • ${cat}: ${qty}`);

  const spiritsLines = [...spiritsByType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, qty]) => `  • ${cat}: ${qty}`);

  const lines = [
    `Всего бутылок: ${total}`,
    ``,
    `Вино: ${wine}`,
    ...wineLines,
    ``,
    `Крепкий алкоголь: ${spirits}`,
    ...spiritsLines,
  ];

  if (beer > 0) lines.push(``, `Пиво: ${beer}`);
  if (otherBottles > 0) lines.push(``, `Напитки (тип не определён по названию): ${otherBottles}`);

  return lines.join("\n");
}

// --- Tool: найти поставщика по названию вина ---
export async function getSupplier(query: string): Promise<string> {
  const [allItems, allSuppliers] = await Promise.all([
    loyverseFetch<any>("/items", "items"),
    loyverseFetch<any>("/suppliers", "suppliers"),
  ]);

  const supplierMap = new Map(allSuppliers.map((s: any) => [s.id, s]));
  const q = query.toLowerCase();

  const matches = allItems.filter(
    (item: any) => !item.deleted_at && item.item_name.toLowerCase().includes(q)
  );

  if (matches.length === 0) return `Товары по запросу "${query}" не найдены в Loyverse.`;

  const lines = matches.map((item: any) => {
    const supplier = item.primary_supplier_id
      ? supplierMap.get(item.primary_supplier_id)
      : null;
    const supplierInfo = supplier
      ? `${supplier.name}${supplier.phone_number ? `, ${supplier.phone_number}` : ""}${supplier.email ? `, ${supplier.email}` : ""}`
      : "поставщик не указан";
    return `  • ${item.item_name} → ${supplierInfo}`;
  });

  return `Найдено ${matches.length} позиций:\n${lines.join("\n")}`;
}

// --- Tool: purchase orders из Supabase ---
export async function getPurchaseOrders(params: {
  supplier?: string;
  date_from?: string;
  date_to?: string;
  include_items?: boolean;
  limit?: number;
}): Promise<string> {
  if (!supabase) return "Supabase не подключён — добавьте SUPABASE_URL и SUPABASE_SERVICE_KEY в окружение бота.";

  const { supplier, date_from, date_to, include_items = false, limit = 10 } = params;

  let query = supabase
    .from("purchase_orders")
    .select(include_items ? "*, purchase_order_items(*)" : "*")
    .order("order_date", { ascending: false })
    .limit(limit);

  if (supplier) query = query.ilike("supplier", `%${supplier}%`);
  if (date_from) query = query.gte("order_date", date_from);
  if (date_to)   query = query.lte("order_date", date_to);

  const { data, error } = await query;
  if (error) return `Ошибка Supabase: ${error.message}`;
  if (!data || data.length === 0) return "Purchase orders не найдены по заданным критериям.";

  const f = (n: number | null) => n != null ? Math.round(n).toLocaleString("ru-RU") + " ฿" : "—";

  const lines: string[] = [`Найдено заказов: ${data.length}\n`];
  for (const po of (data as any[])) {
    lines.push(`${po.po_number}  ${po.order_date ?? "—"}  ${po.supplier ?? "—"}  ${po.status ?? "—"}  ${f(po.total_thb)}`);
    if (include_items && Array.isArray((po as any).purchase_order_items)) {
      for (const item of (po as any).purchase_order_items) {
        lines.push(`  • ${item.product_name} — ${item.qty_ordered ?? "?"} шт × ${f(item.cost_price)} = ${f(item.line_total)}`);
      }
    }
  }
  return lines.join("\n");
}

// --- Tool: история закупок по товару ---
export async function getPurchaseHistory(query: string): Promise<string> {
  if (!supabase) return "Supabase не подключён.";

  const { data, error } = await supabase
    .from("purchase_order_items")
    .select("product_name, sku, qty_ordered, cost_price, line_total, purchase_orders(order_date, supplier)")
    .ilike("product_name", `%${query}%`)
    .order("product_name");

  if (error) return `Ошибка: ${error.message}`;
  if (!data || data.length === 0) return `Закупок по запросу "${query}" не найдено.`;

  // Группируем по product_name → supplier
  const byProduct = new Map<string, Map<string, { qty: number; total: number; prices: number[]; dates: string[] }>>();

  for (const item of data) {
    const product  = item.product_name ?? "—";
    const po       = (item.purchase_orders as any) ?? {};
    const supplier = po.supplier ?? "—";
    const date     = po.order_date ?? "";
    const price    = item.cost_price ?? 0;
    const qty      = item.qty_ordered ?? 0;
    const total    = item.line_total ?? 0;

    if (!byProduct.has(product)) byProduct.set(product, new Map());
    const suppMap = byProduct.get(product)!;
    if (!suppMap.has(supplier)) suppMap.set(supplier, { qty: 0, total: 0, prices: [], dates: [] });
    const s = suppMap.get(supplier)!;
    s.qty += qty;
    s.total += total;
    if (price > 0) s.prices.push(price);
    if (date) s.dates.push(date);
  }

  const lines: string[] = [];

  for (const [product, suppMap] of byProduct) {
    lines.push(`📦 ${product}`);
    const sorted = [...suppMap.entries()].sort((a, b) => b[1].total - a[1].total);
    for (const [supplier, s] of sorted) {
      const avgPrice  = s.prices.length > 0 ? Math.round(s.prices.reduce((a, b) => a + b) / s.prices.length) : null;
      const lastDate  = s.dates.sort().at(-1) ?? "—";
      const totalQty  = Math.round(s.qty);
      const avgStr    = avgPrice != null ? `, ср. цена ${avgPrice} ฿` : "";
      lines.push(`  • ${supplier} — ${totalQty} шт${avgStr}, последний заказ: ${lastDate}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

// --- Tool: товары с низким остатком ---
export async function getLowStock(threshold = 5): Promise<string> {
  const [items, categories, inventory] = await Promise.all([
    loyverseFetch<any>("/items", "items"),
    loyverseFetch<any>("/categories", "categories"),
    loyverseFetch<any>("/inventory", "inventory_levels"),
  ]);

  const catMap = new Map(categories.map((c: any) => [c.id, c.name]));
  const invMap = new Map(inventory.map((i: any) => [i.variant_id, i.in_stock]));

  const low = items
    .filter((item: any) => !item.deleted_at && item.variants.length > 0)
    .map((item: any) => {
      const v = item.variants[0];
      const stock = invMap.get(v.variant_id) ?? 0;
      const category = catMap.get(item.category_id) ?? "—";
      return { name: item.item_name, category, stock };
    })
    .filter((i: any) => i.stock <= threshold)
    .sort((a: any, b: any) => a.stock - b.stock);

  if (low.length === 0) return `Товаров с остатком ≤${threshold} шт не найдено.`;

  const lines = low.map((i: any) => `  • ${i.name} [${i.category}] — ${i.stock} шт`);
  return `Товаров с низким остатком (≤${threshold} шт): ${low.length}\n\n${lines.join("\n")}`;
}
