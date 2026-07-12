import type { Verdict, Lang } from "./types.js";
import type { MatchProfile, RecoItem, Recommendations, StockItem, CatalogItem } from "./recommend/types.js";
import { buildProfile } from "./recommend/profile.js";
import { fetchStockCandidates } from "./recommend/sources/stock.js";
import { fetchCatalogCandidates } from "./recommend/sources/catalog.js";
import { worldTier } from "./recommend/sources/world.js";
import { rankCandidates } from "./recommend/rank.js";
import { directionForThb, pickLabel, anchorThb, sortByPriceProximity } from "./recommend/priceMatch.js";

/** "฿890" (rounded, grouped) or "" when price unknown. */
function bahtLabel(thb: number | null): string {
  return thb !== null ? `฿${Math.round(thb).toLocaleString("en-US")}` : "";
}

function stockText(it: StockItem): string {
  const grape = it.grape ? ` — ${it.grape}` : "";
  const price = it.priceThb !== null ? ` — ฿${Math.round(it.priceThb)}` : "";
  return `${it.name}${grape}${price}`;
}

function catalogText(it: CatalogItem): string {
  const grape = it.grape ? ` — ${it.grape}` : "";
  const price = it.priceThb !== null ? ` — ฿${Math.round(it.priceThb)}` : "";
  const vivino = it.vivinoRating !== null ? ` — Vivino ${it.vivinoRating}` : "";
  return `${it.name}${grape}${price}${vivino} [${it.supplier}]`;
}

async function stockTier(profile: MatchProfile, lang: Lang): Promise<RecoItem[]> {
  const all = await fetchStockCandidates();
  if (all.length === 0) return [];
  // Bias the LLM toward price-relevant stock: nearest to the anchor first, cap the pool.
  const items = sortByPriceProximity(all, anchorThb(profile.marketUsd)).slice(0, 50);
  const cands = items.map((it, i) => ({ ref: i, text: stockText(it) }));
  const anchorNote = [profile.grape, profile.region].filter(Boolean).join(", ");
  const picks = await rankCandidates(profile.label, anchorNote, cands, lang);
  return picks.map((p) => {
    const it = items[p.ref];
    const dir = directionForThb(profile.marketUsd, it.priceThb);
    return { name: it.name, priceLabel: bahtLabel(it.priceThb), labelKey: pickLabel(dir, p.qualityVsAnchor), why: p.why };
  });
}

async function catalogTier(profile: MatchProfile, lang: Lang): Promise<RecoItem[]> {
  const pool = await fetchCatalogCandidates(profile);
  if (pool.length === 0) return [];
  const items = sortByPriceProximity(pool, anchorThb(profile.marketUsd)).slice(0, 40);
  const cands = items.map((it, i) => ({ ref: i, text: catalogText(it) }));
  const anchorNote = [profile.grape, profile.region].filter(Boolean).join(", ");
  const picks = await rankCandidates(profile.label, anchorNote, cands, lang);
  return picks.map((p) => {
    const it = items[p.ref];
    const dir = directionForThb(profile.marketUsd, it.priceThb);
    return { name: it.name, supplier: it.supplier, priceLabel: bahtLabel(it.priceThb), labelKey: pickLabel(dir, p.qualityVsAnchor), why: p.why };
  });
}

/** Our-assortment recommendations for an assessed wine: in-stock + supplier catalog.
 *  Tiers run in parallel; any failed/empty tier is dropped. World analogues are a
 *  separate on-demand step (see worldAnalogues) — our stock and suppliers come first. */
export async function recommend(verdict: Verdict, lang: Lang): Promise<Recommendations> {
  const profile = buildProfile(verdict);
  const [stock, catalog] = await Promise.allSettled([
    stockTier(profile, lang),
    catalogTier(profile, lang),
  ]);
  const val = (r: PromiseSettledResult<RecoItem[]>): RecoItem[] => (r.status === "fulfilled" ? r.value : []);
  const tiers = [
    { key: "stock" as const, items: val(stock) },
    { key: "catalog" as const, items: val(catalog) },
  ].filter((t) => t.items.length > 0);
  return { tiers };
}

/** World analogues on demand (separate "Мировые аналоги" button). Web search only —
 *  never touches Supabase. Returns an empty tier list when nothing turns up. */
export async function worldAnalogues(verdict: Verdict, lang: Lang): Promise<Recommendations> {
  const label = buildProfile(verdict).label;
  let items: RecoItem[] = [];
  try {
    items = await worldTier(verdict, label, lang);
  } catch (err) {
    console.error("world analogues failed:", err);
  }
  return { tiers: items.length ? [{ key: "world", items }] : [] };
}
