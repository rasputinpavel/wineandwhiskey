import type { Verdict, Lang } from "./types.js";
import type { MatchProfile, RecoItem, Recommendations, StockItem, CatalogItem } from "./recommend/types.js";
import { buildProfile } from "./recommend/profile.js";
import { fetchStockCandidates } from "./recommend/sources/stock.js";
import { fetchCatalogCandidates } from "./recommend/sources/catalog.js";
import { worldTier } from "./recommend/sources/world.js";
import { rankCandidates } from "./recommend/rank.js";
import { directionForThb, pickLabel } from "./recommend/priceMatch.js";

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
  const items = await fetchStockCandidates();
  if (items.length === 0) return [];
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
  const items = await fetchCatalogCandidates(profile);
  if (items.length === 0) return [];
  const cands = items.map((it, i) => ({ ref: i, text: catalogText(it) }));
  const anchorNote = [profile.grape, profile.region].filter(Boolean).join(", ");
  const picks = await rankCandidates(profile.label, anchorNote, cands, lang);
  return picks.map((p) => {
    const it = items[p.ref];
    const dir = directionForThb(profile.marketUsd, it.priceThb);
    return { name: it.name, supplier: it.supplier, priceLabel: bahtLabel(it.priceThb), labelKey: pickLabel(dir, p.qualityVsAnchor), why: p.why };
  });
}

/** Build three-tier recommendations for an assessed wine. Tiers run in parallel;
 *  any failed/empty tier is dropped. World is a fallback that never needs Supabase. */
export async function recommend(verdict: Verdict, lang: Lang): Promise<Recommendations> {
  const profile = buildProfile(verdict);
  const [stock, catalog, world] = await Promise.allSettled([
    stockTier(profile, lang),
    catalogTier(profile, lang),
    worldTier(verdict, profile.label, lang),
  ]);
  const val = (r: PromiseSettledResult<RecoItem[]>): RecoItem[] => (r.status === "fulfilled" ? r.value : []);
  const tiers = [
    { key: "stock" as const, items: val(stock) },
    { key: "catalog" as const, items: val(catalog) },
    { key: "world" as const, items: val(world) },
  ].filter((t) => t.items.length > 0);
  return { tiers };
}
