/**
 * rematch_unmapped.ts
 *
 * One-shot remapper for inventory.flowaccount_invoice_line rows whose
 * sku_id is NULL. Uses token-set Jaccard similarity over normalized names
 * (volumes/years/punctuation stripped) — much better than the original
 * substring matcher in sync_inventory_flow.ts.
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

type Sku = { id: string; name: string; tokens: string[] };
type UnmappedLine = { id: string; raw_text: string };

// ── Normalization ───────────────────────────────────────────────────────

// Keep volumes (0.7L vs 1L distinguish vodka SKUs) and years (vintages
// distinguish same-name wines). Strip only punctuation, then normalize
// the volume tokens to a canonical form so "0.7L", "0,7l", "70cl" all
// map to the same token.
const STOP = new Set(["bottle", "btl", "pcs", "ea"]);

// Match volumes BEFORE punctuation strip, so "0.7L" / "0,7L" / "70cl" /
// "700ml" / "1L" all canonicalise to a single "vol<ml>" pseudo-token.
// Number must NOT have a unit-less leading digit (so "0.75" stays — too
// ambiguous; could be a year fragment or volume).
const VOLUME_RE = /(\d+(?:[.,]\d+)?)\s*(l|ml|cl)\b/gi;

function normalize(s: string): string[] {
  let str = s.toLowerCase();
  str = str.replace(VOLUME_RE, (_m, num: string, unit: string) => {
    const n = Number(num.replace(',', '.'));
    const ml = unit === 'l' ? n * 1000 : unit === 'cl' ? n * 10 : n;
    return ` vol${Math.round(ml)} `;
  });
  // Now strip remaining punctuation and tokenize.
  str = str.replace(/[",.()&/\\:;]/g, ' ');
  const tokens: string[] = [];
  for (const raw of str.split(/[\s'\-]+/)) {
    if (raw.length < 2) continue;
    if (STOP.has(raw)) continue;
    tokens.push(raw);
  }
  return Array.from(new Set(tokens));
}

// Volume / numeric tokens must match exactly — "vol700" vs "vol1000" are
// different SKUs, not typos.
function isExactOnly(tok: string): boolean {
  return tok.startsWith('vol') || /^\d/.test(tok);
}

// Levenshtein with early exit — used for "Palazzio" ≈ "Palazzo" typos.
function lev1(a: string, b: string): boolean {
  if (a === b) return true;
  if (isExactOnly(a) || isExactOnly(b)) return false;  // volumes / digits never fuzzy-match
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length < 4 || b.length < 4) return false;  // require length to avoid noise
  // classic edit-distance DP, bounded to 1
  const m = a.length, n = b.length;
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  let cur:  number[] = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > 1) return false;
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[n] <= 1;
}

// Greedy fuzzy intersection: each B-token used at most once. Counts both
// exact equals and tokens within Levenshtein-1 (typo tolerance).
function fuzzyInter(A: string[], B: string[]): number {
  const used = new Array<boolean>(B.length).fill(false);
  let inter = 0;
  for (const a of A) {
    let hit = -1;
    for (let i = 0; i < B.length; i++) {
      if (!used[i] && a === B[i]) { hit = i; break; }
    }
    if (hit === -1) {
      for (let i = 0; i < B.length; i++) {
        if (!used[i] && lev1(a, B[i])) { hit = i; break; }
      }
    }
    if (hit !== -1) { used[hit] = true; inter++; }
  }
  return inter;
}

// Score = max(Jaccard, Containment).
// Jaccard punishes extra words on either side; containment (inter / min)
// rewards "shorter is fully contained in longer" — important for FA strings
// like "Palazzio Grimani Extra Dry Black Label" matching shorter Loyverse
// "Palazzo Grimani Black Label".
function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const inter = fuzzyInter(a, b);
  const union = a.length + b.length - inter;
  const jacc  = union === 0 ? 0 : inter / union;
  const cont  = inter / Math.min(a.length, b.length);
  return Math.max(jacc, cont);
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nrematch_unmapped — threshold ${THRESHOLD} ${DRY ? '(DRY-RUN)' : '(WILL APPLY)'}\n`);

  // Supabase caps select() at 1000 rows by default — we have ~2862 SKUs,
  // so paginate via .range() until we drain.
  const skus: Sku[] = [];
  for (let cur = 0; ; cur += 1000) {
    const { data, error } = await supabase
      .from("sku").select("id, name")
      .range(cur, cur + 999);
    if (error) throw new Error(`load sku: ${error.message}`);
    if (!data?.length) break;
    for (const r of data as any[]) {
      skus.push({ id: r.id, name: r.name, tokens: normalize(r.name) });
    }
    if (data.length < 1000) break;
  }
  console.log(`SKUs loaded: ${skus.length}`);

  const { data: lineRows, error: lineErr } = await supabase
    .from("flowaccount_invoice_line")
    .select("id, raw_text")
    .is("sku_id", null);
  if (lineErr) throw new Error(`load lines: ${lineErr.message}`);
  const lines: UnmappedLine[] = (lineRows ?? []) as UnmappedLine[];
  console.log(`Unmapped lines: ${lines.length}\n`);

  type Decision = {
    line: UnmappedLine
    best: Sku | null
    score: number
    runnerUp: { sku: Sku; score: number } | null
  };
  const decisions: Decision[] = [];

  for (const line of lines) {
    const lineTokens = normalize(line.raw_text);
    let best: Sku | null = null;
    let bestScore = 0;
    let runnerUp: { sku: Sku; score: number } | null = null;

    for (const sku of skus) {
      const s = jaccard(lineTokens, sku.tokens);
      if (s > bestScore) {
        if (best) runnerUp = { sku: best, score: bestScore };
        best = sku;
        bestScore = s;
      } else if (!runnerUp || s > runnerUp.score) {
        runnerUp = { sku, score: s };
      }
    }

    decisions.push({ line, best, score: bestScore, runnerUp });
  }

  // Group by outcome.
  const matched   = decisions.filter(d => d.score >= THRESHOLD && d.best);
  const ambiguous = matched.filter(d => d.runnerUp && d.score - d.runnerUp.score < 0.05);
  const skipped   = decisions.filter(d => d.score < THRESHOLD);

  console.log(`Matched   : ${matched.length} (${ambiguous.length} ambiguous within 0.05 of runner-up)`);
  console.log(`Skipped   : ${skipped.length}\n`);

  console.log("== MATCHED ==");
  for (const d of matched) {
    const ambig = d.runnerUp && d.score - d.runnerUp.score < 0.05 ? " ⚠ AMBIGUOUS" : "";
    console.log(`  ${d.score.toFixed(2)}  "${d.line.raw_text}"\n         → ${d.best!.name}${ambig}`);
    if (d.runnerUp && d.runnerUp.score > 0.4) {
      console.log(`         runner-up ${d.runnerUp.score.toFixed(2)}: ${d.runnerUp.sku.name}`);
    }
  }

  console.log("\n== SKIPPED (below threshold) ==");
  for (const d of skipped.slice(0, 30)) {
    console.log(`  ${d.score.toFixed(2)}  "${d.line.raw_text}"`);
    if (d.best) console.log(`         best so far: ${d.best.name}`);
  }
  if (skipped.length > 30) console.log(`  … and ${skipped.length - 30} more`);

  if (DRY) {
    console.log("\nDry-run. Re-run with --apply to write changes.");
    return;
  }

  // Write one row at a time — supabase-js doesn't support batched per-row
  // UPDATEs without REST workarounds, and we only have ~100 rows here.
  console.log("\nApplying...");
  let written = 0;
  for (const d of matched) {
    const { error } = await supabase
      .from("flowaccount_invoice_line")
      .update({ sku_id: d.best!.id })
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
