/**
 * rematch_unmapped.ts
 *
 * One-shot remapper for inventory.flowaccount_invoice_line rows whose
 * sku_id is NULL. Uses the shared fuzzy matcher in lib/sku_match.ts.
 *
 * Now that the same matcher runs inside sync_inventory_flow.ts on
 * ingest, this script should mostly find nothing — it's still useful
 * for back-filling history if the matcher ever gets tuned, or if a new
 * SKU was added to Loyverse after a FA invoice came in.
 *
 * Modes:
 *   --dry           preview only — print proposed matches and skip writes
 *   --threshold N   override the score threshold (default 0.65)
 *   --apply         actually write sku_id (required to persist)
 *
 * Usage:
 *   npx tsx 03_automation/rematch_unmapped.ts --dry
 *   npx tsx 03_automation/rematch_unmapped.ts --apply --threshold 0.7
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { matchSku, indexSkus, type SkuLite, type IndexedSku } from "./lib/sku_match";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { db: { schema: "inventory" } },
);

const argv = process.argv.slice(2);
const DRY       = argv.includes("--dry") || !argv.includes("--apply");
const THRESHOLD = (() => {
  const i = argv.indexOf("--threshold");
  if (i === -1) return 0.65;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.65;
})();

type UnmappedLine = { id: string; raw_text: string };

async function loadSkus(): Promise<IndexedSku[]> {
  const out: SkuLite[] = [];
  for (let cur = 0; ; cur += 1000) {
    const { data, error } = await supabase
      .from("sku").select("id, loyverse_product_code, name")
      .range(cur, cur + 999);
    if (error) throw new Error(`load sku: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as SkuLite[]));
    if (data.length < 1000) break;
  }
  return indexSkus(out);
}

async function main() {
  console.log(`\nrematch_unmapped — threshold ${THRESHOLD} ${DRY ? '(DRY-RUN)' : '(WILL APPLY)'}\n`);

  const skus = await loadSkus();
  console.log(`SKUs loaded: ${skus.length}`);

  const { data: lineRows, error: lineErr } = await supabase
    .from("flowaccount_invoice_line")
    .select("id, raw_text")
    .is("sku_id", null);
  if (lineErr) throw new Error(`load lines: ${lineErr.message}`);
  const lines = (lineRows ?? []) as UnmappedLine[];
  console.log(`Unmapped lines: ${lines.length}\n`);

  type Decision = {
    line: UnmappedLine
    sku: IndexedSku | null
    score: number
    runnerUp: { sku: IndexedSku; score: number } | null
  };
  const decisions: Decision[] = [];

  for (const line of lines) {
    const r = matchSku(line.raw_text, skus, { threshold: THRESHOLD });
    decisions.push({ line, sku: r.sku, score: r.score, runnerUp: r.runnerUp });
  }

  const matched   = decisions.filter(d => d.sku !== null);
  const ambiguous = matched.filter(d => d.runnerUp && d.score - d.runnerUp.score < 0.05);
  const skipped   = decisions.filter(d => d.sku === null);

  console.log(`Matched   : ${matched.length} (${ambiguous.length} ambiguous within 0.05 of runner-up)`);
  console.log(`Skipped   : ${skipped.length}\n`);

  console.log("== MATCHED ==");
  for (const d of matched) {
    const ambig = d.runnerUp && d.score - d.runnerUp.score < 0.05 ? " ⚠ AMBIGUOUS" : "";
    console.log(`  ${d.score.toFixed(2)}  "${d.line.raw_text}"\n         → ${d.sku!.name}${ambig}`);
    if (d.runnerUp && d.runnerUp.score > 0.4) {
      console.log(`         runner-up ${d.runnerUp.score.toFixed(2)}: ${d.runnerUp.sku.name}`);
    }
  }

  console.log("\n== SKIPPED (below threshold) ==");
  for (const d of skipped.slice(0, 30)) {
    console.log(`  ${d.score.toFixed(2)}  "${d.line.raw_text}"`);
    if (d.runnerUp) console.log(`         best: ${d.runnerUp.sku.name}`);
  }
  if (skipped.length > 30) console.log(`  … and ${skipped.length - 30} more`);

  if (DRY) {
    console.log("\nDry-run. Re-run with --apply to write changes.");
    return;
  }

  console.log("\nApplying...");
  let written = 0;
  for (const d of matched) {
    const { error } = await supabase
      .from("flowaccount_invoice_line")
      .update({ sku_id: d.sku!.id })
      .eq("id", d.line.id);
    if (error) {
      console.error(`Row ${d.line.id}: ${error.message}`);
      break;
    }
    written++;
    if (written % 20 === 0) process.stdout.write(`  ${written}/${matched.length}\r`);
  }
  console.log(`\nDone. Updated ${written} rows.`);
}

main().catch(err => { console.error(err); process.exit(1); });
