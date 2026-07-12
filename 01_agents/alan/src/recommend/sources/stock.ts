import { inventoryDb } from "../store.js";
import type { StockItem } from "../types.js";

interface Row {
  name: string;
  grape_variety: string | null;
  wine_country: string | null;
  default_price: number | null;
  wine_color: string | null;
  on_hand: number;
}

/** Pure: map a v_sku_breakdown row to a StockItem. */
export function toStockItem(r: Row): StockItem {
  return {
    name: r.name,
    grape: r.grape_variety ?? "",
    country: r.wine_country ?? "",
    priceThb: r.default_price,
  };
}

/** All wine currently in stock (on_hand > 0, has a wine_color). [] on error / no client. */
export async function fetchStockCandidates(): Promise<StockItem[]> {
  if (!inventoryDb) return [];
  const { data, error } = await inventoryDb
    .from("v_sku_breakdown")
    .select("name,grape_variety,wine_country,default_price,wine_color,on_hand")
    .gt("on_hand", 0)
    .not("wine_color", "is", null)
    .limit(500);
  if (error || !data) {
    if (error) console.error("stock fetch failed:", error.message);
    return [];
  }
  return (data as Row[]).map(toStockItem);
}
