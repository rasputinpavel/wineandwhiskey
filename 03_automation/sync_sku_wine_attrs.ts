/**
 * sync_sku_wine_attrs.ts
 * Backfills inventory.sku wine attributes (wine_color, grape_variety, wine_country)
 * by classifying name + Loyverse category. Skips rows where `wine_attrs_source='manual'`
 * so user overrides are preserved.
 *
 * Usage:
 *   npm run sync:sku-wine                  # backfill all wine SKUs
 *   npm run sync:sku-wine -- --dry         # report only, no writes
 */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { detectGrape, detectRedCountryRegion } from "./lib/wine_detect.js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { db: { schema: "inventory" } },
);

const DRY = process.argv.includes("--dry");

// Loyverse category names → our wine_color enum.
function categoryToColor(cat: string | null): WineColor | null {
  if (!cat) return null;
  const c = cat.toLowerCase();
  if (/orange\s*wine/.test(c))    return "orange";
  if (/sparkling\s*wine|p[ée]t[\s\-]?nat|champagne|prosecco|cava|sekt|cr[eé]mant/.test(c)) return "sparkling";
  if (/rose\s*wine|ros[ée]/.test(c)) return "rose";
  if (/white\s*wine|natural\s*white/.test(c)) return "white";
  if (/red\s*wine|natural\s*red/.test(c))     return "red";
  return null;
}

type WineColor = "red" | "white" | "rose" | "sparkling" | "orange";

// Normalize Russian country labels from wine_detect → English.
const COUNTRY_RU_TO_EN: Record<string, string> = {
  "Франция": "France", "Италия": "Italy", "Испания": "Spain", "Португалия": "Portugal",
  "Аргентина": "Argentina", "Чили": "Chile", "США": "USA",
  "Австралия": "Australia", "Новая Зеландия": "New Zealand", "ЮАР": "South Africa",
  "Германия": "Germany", "Австрия": "Austria", "Грузия": "Georgia", "Молдова": "Moldova",
  "Греция": "Greece", "Венгрия": "Hungary", "Болгария": "Bulgaria",
  "Кипр": "Cyprus", "Ливан": "Lebanon",
  "Прочее / Не определено": "",
};

type SkuRow = {
  id: string;
  loyverse_product_code: string | null;
  name: string;
  category: string | null;
  wine_attrs_source: string | null;
};

async function fetchAllSkus(): Promise<SkuRow[]> {
  const all: SkuRow[] = [];
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("sku")
      .select("id,loyverse_product_code,name,category,wine_attrs_source")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...(data as SkuRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function main() {
  const skus = await fetchAllSkus();
  console.log(`[seed] fetched ${skus.length} SKU rows`);

  const report = {
    total: skus.length,
    skipped_non_wine: 0,
    skipped_manual: 0,
    seeded: 0,
    by_color: { red: 0, white: 0, sparkling: 0, rose: 0, orange: 0 },
    unmatched_grape: [] as string[],
    unmatched_country: [] as string[],
  };

  const updates: Array<{
    id: string;
    wine_color: WineColor;
    grape_variety: string | null;
    wine_country: string | null;
    wine_attrs_source: "auto";
    wine_attrs_updated_at: string;
  }> = [];

  for (const sku of skus) {
    if (sku.wine_attrs_source === "manual") { report.skipped_manual++; continue; }
    const color = categoryToColor(sku.category);
    if (!color) { report.skipped_non_wine++; continue; }

    let grape: string | null = null;
    let country: string | null = null;

    if (color === "white") {
      const g = detectGrape(sku.name);
      grape = g === "Прочее / Купаж" ? null : g;
      if (!grape) report.unmatched_grape.push(sku.name);
    } else if (color === "red" || color === "rose" || color === "orange") {
      const { country: ru } = detectRedCountryRegion(sku.name);
      const en = COUNTRY_RU_TO_EN[ru] ?? "";
      country = en || null;
      if (!country) report.unmatched_country.push(sku.name);
    } else if (color === "sparkling") {
      // Try the red-region rules anyway — they catch France/Italy/Spain too.
      const { country: ru } = detectRedCountryRegion(sku.name);
      const en = COUNTRY_RU_TO_EN[ru] ?? "";
      country = en || null;
    }

    updates.push({
      id: sku.id,
      wine_color: color,
      grape_variety: grape,
      wine_country: country,
      wine_attrs_source: "auto",
      wine_attrs_updated_at: new Date().toISOString(),
    });
    report.seeded++;
    report.by_color[color]++;
  }

  console.log(`[seed] seeded=${report.seeded} skipped_non_wine=${report.skipped_non_wine} skipped_manual=${report.skipped_manual}`);
  console.log(`[seed] by_color`, report.by_color);
  console.log(`[seed] unmatched grape: ${report.unmatched_grape.length}, unmatched country: ${report.unmatched_country.length}`);

  if (!DRY) {
    let written = 0;
    for (const u of updates) {
      const { id, ...patch } = u;
      const { error } = await supabase.from("sku").update(patch).eq("id", id);
      if (error) throw error;
      written++;
      if (written % 200 === 0) console.log(`[seed] wrote ${written}/${updates.length}`);
    }
    console.log(`[seed] wrote ${written} rows`);
  } else {
    console.log(`[seed] DRY — no writes`);
  }

  const outDir = path.join(process.cwd(), "09_data");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "sku_wine_match_report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`[seed] report → ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
