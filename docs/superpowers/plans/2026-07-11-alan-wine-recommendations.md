# Alan Wine Recommendations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand "Похожие у нас" button to the Alan Telegram bot that, for the last-assessed wine, recommends similar wines across three tiers — in-stock (Loyverse), supplier catalog (`wine_items`), and the world (existing analogues) — each item tagged «ровня / дешевле и почти так же / апгрейд».

**Architecture:** New `src/recommend/` module in `01_agents/alan`. It builds a `MatchProfile` from the existing `Verdict` (no extra LLM call), reads stock and catalog **directly from Supabase** (same project/key already used by `cache.ts`), narrows candidates by attributes, then an LLM re-rank picks the closest by style while **code computes the price direction deterministically**. Three tiers run in parallel (`Promise.allSettled`); empty/failed tiers are skipped; the world tier is a fallback that never depends on Supabase.

**Tech Stack:** TypeScript (ESM, NodeNext), grammY (Telegram), `@supabase/supabase-js`, `@anthropic-ai/sdk` (Haiku for re-rank), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-alan-wine-recommendations-design.md`

---

## Conventions (read first)

- All imports use the `.js` extension even for `.ts` files (NodeNext ESM), matching existing code.
- Run tests from `01_agents/alan`: `npm test` (Vitest). A single file: `npx vitest run test/<file>.test.ts`.
- Types live in `src/recommend/types.ts`; `Lang`/`Verdict` come from `src/types.ts`.
- Supabase creds come from `config.ts` (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) — already set on Railway (the cache works in prod). No new env vars.
- Follow the codebase norm: **unit-test pure functions**; do NOT unit-test the Supabase fetch or the LLM re-rank (consistent with `sources/websearch.ts`, which has no unit test). The pure row-mappers and label logic ARE tested.

## File Structure

Create under `01_agents/alan/src/recommend/`:

- `types.ts` — all recommend-domain types.
- `profile.ts` — `Verdict → MatchProfile` + `normalizeType()` (pure).
- `priceMatch.ts` — `priceDirection`, `pickLabel`, `thaiAnchorUsd`, `catalogPriceRangeThb`, `directionForThb`, `parseUsd` (pure).
- `store.ts` — Supabase clients (`catalogDb` = public, `inventoryDb` = inventory schema).
- `sources/stock.ts` — `toStockItem()` (pure) + `fetchStockCandidates()`.
- `sources/catalog.ts` — `toCatalogItem()` (pure) + `fetchCatalogCandidates()`.
- `sources/world.ts` — `worldTier()` wrapper over existing `findAnalogues`.
- `rank.ts` — `rankCandidates()` (LLM structured re-rank).
- `../recommend.ts` — orchestrator `recommend(verdict, lang)`.

Modify:
- `src/priceLocal.ts` — export `THAI_IMPORT_MULT` (currently a private const).
- `src/format.ts` — add `recommendationsMessage()`.
- `src/index.ts` — second inline button + `bot.callbackQuery("similar", …)`.

Tests:
- `test/recommend.profile.test.ts`, `test/recommend.priceMatch.test.ts`, extend `test/format.test.ts`.

---

### Task 1: Export `THAI_IMPORT_MULT` from priceLocal

**Files:**
- Modify: `01_agents/alan/src/priceLocal.ts:5`

- [ ] **Step 1: Make the constant exported**

In `src/priceLocal.ts`, change line 5 from:

```ts
const THAI_IMPORT_MULT = 2.4;      // typical Thai imported-wine markup over origin price
```

to:

```ts
export const THAI_IMPORT_MULT = 2.4;  // typical Thai imported-wine markup over origin price
```

- [ ] **Step 2: Verify nothing else breaks**

Run: `npx tsc --noEmit` (from `01_agents/alan`)
Expected: no new errors (only pre-existing ones, if any).

- [ ] **Step 3: Commit**

```bash
git add 01_agents/alan/src/priceLocal.ts
git commit -m "refactor(alan): export THAI_IMPORT_MULT for reuse"
```

---

### Task 2: Recommend-domain types

**Files:**
- Create: `01_agents/alan/src/recommend/types.ts`

- [ ] **Step 1: Write the types file**

```ts
export type TierKey = "stock" | "catalog" | "world";
export type LabelKey = "value" | "peer" | "upgrade";
export type PriceDirection = "cheaper" | "same" | "pricier" | "unknown";
export type QualityVsAnchor = "lower" | "similar" | "higher";

/** Everything the matcher needs about the scanned wine, built from a Verdict. */
export interface MatchProfile {
  label: string;            // "Producer Name Vintage" — for prompts/echo
  type: string;             // normalized catalog type: red|white|rose|sparkling|orange|"" (fortified/unknown → "")
  grape: string;            // "" if unknown
  region: string;           // hint for the LLM only ("" if unknown)
  qualityScore: number | null;
  marketUsd: number | null; // world origin price in USD
}

/** A wine currently in stock (from inventory.v_sku_breakdown). */
export interface StockItem {
  name: string;
  grape: string;
  country: string;
  priceThb: number | null;
}

/** A wine from a supplier price list (from public.wine_items). */
export interface CatalogItem {
  name: string;
  supplier: string;
  grape: string;
  country: string;
  region: string;
  year: number | null;
  priceThb: number | null;
  vivinoRating: number | null;
}

/** One selection returned by the LLM re-rank, referencing a candidate by index. */
export interface RankPick {
  ref: number;
  why: string;
  qualityVsAnchor: QualityVsAnchor;
}

/** A finished recommendation line ready to render. */
export interface RecoItem {
  name: string;
  supplier?: string;   // present for the catalog tier
  priceLabel: string;  // "฿890" | "~$25" | ""
  labelKey: LabelKey;
  why: string;
}

export interface RecoTier {
  key: TierKey;
  items: RecoItem[];
}

export interface Recommendations {
  tiers: RecoTier[];   // only non-empty tiers, in display order stock→catalog→world
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add 01_agents/alan/src/recommend/types.ts
git commit -m "feat(alan): recommend-domain types"
```

---

### Task 3: `buildProfile` + `normalizeType`

**Files:**
- Create: `01_agents/alan/src/recommend/profile.ts`
- Test: `01_agents/alan/test/recommend.profile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildProfile, normalizeType } from "../src/recommend/profile.js";
import type { Verdict } from "../src/types.js";

const verdict: Verdict = {
  identity: { producer: "MontGras", name: "Day One", vintage: "2020", region: "Colchagua", grape: "Cabernet Sauvignon", type: "red", idConfidence: "high" },
  criticConsensus: 90, criticCount: 2, communityNote: "", marketPrice: null,
  qpr: null, bottomLine: "take-quality", tastingNotes: "", drinkingWindow: "",
  agingNote: "", producerNote: "", categoryPositioning: "", evidenceLevel: "exact",
  valueRead: "good", priceTier: "mid", qualityScore: 90, marketUsd: 20,
  punchline: "", detail: "", dataConfidence: "high", sources: [],
};

describe("normalizeType", () => {
  it("maps rosé (accented) and rose to 'rose'", () => {
    expect(normalizeType("rosé")).toBe("rose");
    expect(normalizeType("Rose")).toBe("rose");
  });
  it("passes through known catalog types", () => {
    expect(normalizeType("red")).toBe("red");
    expect(normalizeType("SPARKLING")).toBe("sparkling");
  });
  it("returns '' for fortified/unknown (no type filter)", () => {
    expect(normalizeType("fortified")).toBe("");
    expect(normalizeType("")).toBe("");
  });
});

describe("buildProfile", () => {
  it("derives the match profile from a verdict", () => {
    const p = buildProfile(verdict);
    expect(p.label).toBe("MontGras Day One 2020");
    expect(p.type).toBe("red");
    expect(p.grape).toBe("Cabernet Sauvignon");
    expect(p.region).toBe("Colchagua");
    expect(p.qualityScore).toBe(90);
    expect(p.marketUsd).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/recommend.profile.test.ts`
Expected: FAIL — cannot find module `../src/recommend/profile.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Verdict } from "../types.js";
import { identityLabel } from "../identify.js";
import type { MatchProfile } from "./types.js";

/** Map a display wine type to the catalog's `wine_type` enum. Fortified/unknown → ""
 *  (no type filter — the catalog has no fortified bucket). */
export function normalizeType(t: string): string {
  const s = t.trim().toLowerCase();
  if (s === "rosé" || s === "rose") return "rose";
  if (s === "red" || s === "white" || s === "sparkling" || s === "orange") return s;
  return "";
}

/** Build the matcher's anchor profile from an assembled verdict. No LLM call. */
export function buildProfile(v: Verdict): MatchProfile {
  return {
    label: identityLabel(v.identity),
    type: normalizeType(v.identity.type),
    grape: v.identity.grape.trim(),
    region: v.identity.region.trim(),
    qualityScore: v.qualityScore,
    marketUsd: v.marketUsd,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/recommend.profile.test.ts`
Expected: PASS (5 assertions across 3+1 tests).

- [ ] **Step 5: Commit**

```bash
git add 01_agents/alan/src/recommend/profile.ts test/recommend.profile.test.ts
git commit -m "feat(alan): buildProfile + normalizeType (Verdict → MatchProfile)"
```

---

### Task 4: Deterministic price math (`priceMatch.ts`)

**Files:**
- Create: `01_agents/alan/src/recommend/priceMatch.ts`
- Test: `01_agents/alan/test/recommend.priceMatch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  priceDirection, pickLabel, thaiAnchorUsd, catalogPriceRangeThb, directionForThb, parseUsd,
} from "../src/recommend/priceMatch.js";

describe("priceDirection", () => {
  it("classifies by ratio", () => {
    expect(priceDirection(100, 50)).toBe("cheaper");   // 0.5
    expect(priceDirection(100, 100)).toBe("same");     // 1.0
    expect(priceDirection(100, 120)).toBe("same");     // 1.2 (≤1.25)
    expect(priceDirection(100, 200)).toBe("pricier");  // 2.0
  });
  it("returns 'unknown' when either side is null/zero", () => {
    expect(priceDirection(null, 50)).toBe("unknown");
    expect(priceDirection(100, null)).toBe("unknown");
    expect(priceDirection(0, 50)).toBe("unknown");
  });
});

describe("pickLabel", () => {
  it("cheaper + comparable quality → value", () => {
    expect(pickLabel("cheaper", "similar")).toBe("value");
    expect(pickLabel("cheaper", "higher")).toBe("value");
  });
  it("pricier + higher quality → upgrade", () => {
    expect(pickLabel("pricier", "higher")).toBe("upgrade");
  });
  it("everything else → peer", () => {
    expect(pickLabel("same", "similar")).toBe("peer");
    expect(pickLabel("cheaper", "lower")).toBe("peer");
    expect(pickLabel("pricier", "similar")).toBe("peer");
    expect(pickLabel("unknown", "similar")).toBe("peer");
  });
});

describe("thaiAnchorUsd", () => {
  it("scales world price by the Thai import multiplier", () => {
    expect(thaiAnchorUsd(20)).toBeCloseTo(48); // 20 × 2.4
    expect(thaiAnchorUsd(null)).toBeNull();
    expect(thaiAnchorUsd(0)).toBeNull();
  });
});

describe("catalogPriceRangeThb", () => {
  it("returns a wide THB corridor when marketUsd is known", () => {
    const r = catalogPriceRangeThb(20)!;
    expect(r.minThb).toBeGreaterThan(0);
    expect(r.maxThb).toBeGreaterThan(r.minThb);
  });
  it("returns null when marketUsd is unknown", () => {
    expect(catalogPriceRangeThb(null)).toBeNull();
  });
});

describe("directionForThb", () => {
  it("compares a THB candidate against the Thai-adjusted anchor", () => {
    // anchor world $20 → Thai anchor $48 ≈ ฿1714. A ฿700 bottle ≈ $19.6 → ratio ~0.41 → cheaper.
    expect(directionForThb(20, 700)).toBe("cheaper");
    // ฿1700 ≈ $47.6 → ratio ~0.99 → same.
    expect(directionForThb(20, 1700)).toBe("same");
    expect(directionForThb(null, 700)).toBe("unknown");
    expect(directionForThb(20, null)).toBe("unknown");
  });
});

describe("parseUsd", () => {
  it("extracts a USD number from an approx-price string", () => {
    expect(parseUsd("~$25")).toBe(25);
    expect(parseUsd("$1,200")).toBe(1200);
    expect(parseUsd("around 18 USD")).toBe(18);
    expect(parseUsd("n/a")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/recommend.priceMatch.test.ts`
Expected: FAIL — cannot find module `../src/recommend/priceMatch.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { thbToUsd, usdToThb, THAI_IMPORT_MULT } from "../priceLocal.js";
import type { PriceDirection, QualityVsAnchor, LabelKey } from "./types.js";

/** Compare two USD prices → cheaper / same / pricier. 'unknown' if either is missing. */
export function priceDirection(anchorUsd: number | null, candidateUsd: number | null): PriceDirection {
  if (anchorUsd === null || candidateUsd === null || !(anchorUsd > 0) || !(candidateUsd > 0)) return "unknown";
  const ratio = candidateUsd / anchorUsd;
  if (ratio < 0.8) return "cheaper";
  if (ratio <= 1.25) return "same";
  return "pricier";
}

/** Combine the (code-computed) price direction with the (LLM-judged) quality to a label. */
export function pickLabel(dir: PriceDirection, quality: QualityVsAnchor): LabelKey {
  if (dir === "cheaper" && (quality === "similar" || quality === "higher")) return "value";
  if (dir === "pricier" && quality === "higher") return "upgrade";
  return "peer";
}

/** Expected Thailand-market price (USD) for a wine whose world origin price is marketUsd. */
export function thaiAnchorUsd(marketUsd: number | null): number | null {
  return marketUsd !== null && marketUsd > 0 ? marketUsd * THAI_IMPORT_MULT : null;
}

/** Rough THB corridor for the catalog prefilter (wide on purpose — precision is the
 *  label step's job). null → no price filter (marketUsd unknown). */
export function catalogPriceRangeThb(marketUsd: number | null): { minThb: number; maxThb: number } | null {
  if (!(marketUsd !== null && marketUsd > 0)) return null;
  return {
    minThb: Math.round(usdToThb(marketUsd) * 0.7),
    maxThb: Math.round(usdToThb(marketUsd * THAI_IMPORT_MULT) * 1.6),
  };
}

/** Price direction for a Thailand-market (THB-priced) candidate vs the scanned wine. */
export function directionForThb(marketUsd: number | null, priceThb: number | null): PriceDirection {
  const candidateUsd = priceThb !== null ? thbToUsd(priceThb) : null;
  return priceDirection(thaiAnchorUsd(marketUsd), candidateUsd);
}

/** Best-effort USD number from a free-text approx price ("~$25", "$1,200", "18 USD"). */
export function parseUsd(approx: string): number | null {
  const m = approx.replace(/[,\s]/g, "").match(/\$?(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/recommend.priceMatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 01_agents/alan/src/recommend/priceMatch.ts test/recommend.priceMatch.test.ts
git commit -m "feat(alan): deterministic price direction + label logic"
```

---

### Task 5: Supabase clients (`store.ts`)

**Files:**
- Create: `01_agents/alan/src/recommend/store.ts`

- [ ] **Step 1: Write the clients**

Mirrors `src/cache.ts` (same URL/key) but adds an inventory-schema client. Returns `null` when creds are absent so callers degrade gracefully.

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "../config.js";

function make(schema?: string): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
    ...(schema ? { db: { schema } } : {}),
  });
}

/** public schema — supplier price lists (wine_items). */
export const catalogDb = make();

/** inventory schema — Loyverse on-hand (v_sku_breakdown). */
export const inventoryDb = make("inventory");
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 01_agents/alan/src/recommend/store.ts
git commit -m "feat(alan): Supabase clients for stock + catalog reads"
```

---

### Task 6: Stock source (`sources/stock.ts`)

**Files:**
- Create: `01_agents/alan/src/recommend/sources/stock.ts`
- Test: `01_agents/alan/test/recommend.profile.test.ts` (append a `toStockItem` block — pure mapper only)

- [ ] **Step 1: Write the failing test (append to existing profile test file)**

Add to `test/recommend.profile.test.ts`:

```ts
import { toStockItem } from "../src/recommend/sources/stock.js";

describe("toStockItem", () => {
  it("maps a v_sku_breakdown row, coalescing nulls", () => {
    const it = toStockItem({
      name: "Baron Philippe Cab Sauv", grape_variety: "Cabernet Sauvignon",
      wine_country: "Chile", default_price: 890, wine_color: "red", on_hand: 6,
    });
    expect(it).toEqual({ name: "Baron Philippe Cab Sauv", grape: "Cabernet Sauvignon", country: "Chile", priceThb: 890 });
  });
  it("coalesces null grape/country to empty string", () => {
    const it = toStockItem({ name: "X", grape_variety: null, wine_country: null, default_price: null, wine_color: "white", on_hand: 1 });
    expect(it).toEqual({ name: "X", grape: "", country: "", priceThb: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/recommend.profile.test.ts`
Expected: FAIL — cannot find module `../src/recommend/sources/stock.js`.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/recommend.profile.test.ts`
Expected: PASS (new `toStockItem` block green).

- [ ] **Step 5: Commit**

```bash
git add 01_agents/alan/src/recommend/sources/stock.ts test/recommend.profile.test.ts
git commit -m "feat(alan): stock candidate source (v_sku_breakdown)"
```

---

### Task 7: Catalog source (`sources/catalog.ts`)

**Files:**
- Create: `01_agents/alan/src/recommend/sources/catalog.ts`
- Test: `01_agents/alan/test/recommend.priceMatch.test.ts` (append a `toCatalogItem` block — pure mapper only)

- [ ] **Step 1: Write the failing test (append to existing priceMatch test file)**

Add to `test/recommend.priceMatch.test.ts`:

```ts
import { toCatalogItem } from "../src/recommend/sources/catalog.js";

describe("toCatalogItem", () => {
  it("maps a wine_items row, coalescing nulls", () => {
    const it = toCatalogItem({
      name: "Errazuriz Max Reserva", supplier_name: "IWS", grape_variety: "Cabernet Sauvignon",
      country: "Chile", region: "Aconcagua", year: 2021, price: 1200, vivino_rating: 4.1,
    });
    expect(it).toEqual({
      name: "Errazuriz Max Reserva", supplier: "IWS", grape: "Cabernet Sauvignon",
      country: "Chile", region: "Aconcagua", year: 2021, priceThb: 1200, vivinoRating: 4.1,
    });
  });
  it("coalesces null text fields to empty string", () => {
    const it = toCatalogItem({ name: "X", supplier_name: null, grape_variety: null, country: null, region: null, year: null, price: null, vivino_rating: null });
    expect(it).toEqual({ name: "X", supplier: "", grape: "", country: "", region: "", year: null, priceThb: null, vivinoRating: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/recommend.priceMatch.test.ts`
Expected: FAIL — cannot find module `../src/recommend/sources/catalog.js`.

- [ ] **Step 3: Write the implementation**

```ts
import { catalogDb } from "../store.js";
import { catalogPriceRangeThb } from "../priceMatch.js";
import type { CatalogItem, MatchProfile } from "../types.js";

interface Row {
  name: string;
  supplier_name: string | null;
  grape_variety: string | null;
  country: string | null;
  region: string | null;
  year: number | null;
  price: number | null;
  vivino_rating: number | null;
}

/** Pure: map a wine_items row to a CatalogItem. */
export function toCatalogItem(r: Row): CatalogItem {
  return {
    name: r.name,
    supplier: r.supplier_name ?? "",
    grape: r.grape_variety ?? "",
    country: r.country ?? "",
    region: r.region ?? "",
    year: r.year,
    priceThb: r.price,
    vivinoRating: r.vivino_rating,
  };
}

/** Prefiltered supplier-catalog candidates: category=wine, same type, grape match,
 *  price corridor; best-rated first, capped at 50. [] on error / no client. */
export async function fetchCatalogCandidates(p: MatchProfile): Promise<CatalogItem[]> {
  if (!catalogDb) return [];
  let q = catalogDb
    .from("wine_items")
    .select("name,supplier_name,grape_variety,country,region,year,price,vivino_rating")
    .eq("category", "wine")
    .order("vivino_rating", { ascending: false, nullsFirst: false })
    .limit(50);
  if (p.type) q = q.eq("wine_type", p.type);
  if (p.grape) q = q.ilike("grape_variety", `%${p.grape}%`);
  const range = catalogPriceRangeThb(p.marketUsd);
  if (range) q = q.gte("price", range.minThb).lte("price", range.maxThb);
  const { data, error } = await q;
  if (error || !data) {
    if (error) console.error("catalog fetch failed:", error.message);
    return [];
  }
  return (data as Row[]).map(toCatalogItem);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/recommend.priceMatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 01_agents/alan/src/recommend/sources/catalog.ts test/recommend.priceMatch.test.ts
git commit -m "feat(alan): supplier-catalog candidate source (wine_items prefilter)"
```

---

### Task 8: LLM re-rank (`rank.ts`)

**Files:**
- Create: `01_agents/alan/src/recommend/rank.ts`

No unit test (LLM call — consistent with `sources/websearch.ts`). Contract is exercised by the orchestrator.

- [ ] **Step 1: Write the re-ranker**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, MODEL_CHEAP } from "../config.js";
import type { Lang } from "../types.js";
import type { RankPick } from "./types.js";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const RANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ref: { type: "number" },
          why: { type: "string" },
          qualityVsAnchor: { type: "string", enum: ["lower", "similar", "higher"] },
        },
        required: ["ref", "why", "qualityVsAnchor"],
      },
    },
  },
  required: ["picks"],
} as const;

/** Pick up to 3 candidates closest in STYLE to the anchor wine. Returns [] on any
 *  failure/refusal. `candidates[i].ref` is the caller's index back into the full data. */
export async function rankCandidates(
  anchorLabel: string,
  anchorNote: string,
  candidates: { ref: number; text: string }[],
  lang: Lang,
): Promise<RankPick[]> {
  if (candidates.length === 0) return [];
  const list = candidates.map((c) => `${c.ref}. ${c.text}`).join("\n");
  const system = [
    "You match wines. Given an ANCHOR wine and a numbered CANDIDATE list, pick up to 3",
    "candidates closest to the anchor in STYLE (grape, body, sweetness, region character)",
    "and overall quality level. Choose ONLY from the list. If nothing is a real match,",
    "return an empty picks array — do not stretch. For each pick: ref = the candidate's",
    "number exactly as shown; why = ONE short line; qualityVsAnchor = the candidate's",
    `quality relative to the anchor (lower/similar/higher). Write "why" in`,
    `${lang === "ru" ? "Russian" : "English"}. Never invent wines not in the list.`,
  ].join(" ");
  const user = `ANCHOR: ${anchorLabel}${anchorNote ? ` (${anchorNote})` : ""}\n\nCANDIDATES:\n${list}`;

  const params = {
    model: MODEL_CHEAP,
    max_tokens: 1500,
    system,
    output_config: { format: { type: "json_schema", schema: RANK_SCHEMA } },
    messages: [{ role: "user", content: user }],
  } as any;

  try {
    const resp = await anthropic.messages.create(params);
    if (resp.stop_reason === "refusal") return [];
    const txt = resp.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();
    const parsed = JSON.parse(txt) as { picks: RankPick[] };
    const valid = new Set(candidates.map((c) => c.ref));
    return parsed.picks.filter((p) => valid.has(p.ref)).slice(0, 3);
  } catch (err) {
    console.error("rank failed:", err);
    return [];
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 01_agents/alan/src/recommend/rank.ts
git commit -m "feat(alan): LLM re-rank of similar-wine candidates"
```

---

### Task 9: World tier wrapper (`sources/world.ts`)

**Files:**
- Create: `01_agents/alan/src/recommend/sources/world.ts`

No unit test (wraps the web-search `findAnalogues`).

- [ ] **Step 1: Write the wrapper**

Reuses the existing analogues pipeline, then labels each item by parsed USD vs the wine's world price. World analogues are already "similar quality level" by construction, so quality defaults to `similar` and the label is driven by price direction.

```ts
import { buildQuery } from "../../input.js";
import { findAnalogues } from "../../pipeline.js";
import { priceDirection, pickLabel, parseUsd } from "../priceMatch.js";
import type { Verdict, Lang } from "../../types.js";
import type { RecoItem } from "../types.js";

/** World-tier recommendations via the existing analogues web search. [] on failure. */
export async function worldTier(verdict: Verdict, label: string, lang: Lang): Promise<RecoItem[]> {
  try {
    const query = buildQuery({ text: label, lang });
    query.intent = "analogues";
    const res = await findAnalogues(query);
    return res.analogues.slice(0, 3).map((a) => {
      const usd = parseUsd(a.approxPrice);
      const dir = priceDirection(verdict.marketUsd, usd);
      return {
        name: a.name,
        priceLabel: usd !== null ? `~$${Math.round(usd)}` : a.approxPrice,
        labelKey: pickLabel(dir, "similar"),
        why: a.why,
      };
    });
  } catch (err) {
    console.error("world tier failed:", err);
    return [];
  }
}
```

Note: `buildQuery` is `{ text: string; images?: WineImage[]; lang?: Lang }` (verified) — `images` is optional, so the call above is correct as written.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 01_agents/alan/src/recommend/sources/world.ts
git commit -m "feat(alan): world tier over existing analogues search"
```

---

### Task 10: Orchestrator (`recommend.ts`)

**Files:**
- Create: `01_agents/alan/src/recommend.ts`

No unit test (composition over network/LLM). The pure pieces it uses are already tested.

- [ ] **Step 1: Write the orchestrator**

```ts
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
  const picks = await rankCandidates(profile.label, profile.grape, cands, lang);
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
  const picks = await rankCandidates(profile.label, profile.grape, cands, lang);
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 01_agents/alan/src/recommend.ts
git commit -m "feat(alan): three-tier recommendation orchestrator"
```

---

### Task 11: Render the message (`format.ts`)

**Files:**
- Modify: `01_agents/alan/src/format.ts` (add export)
- Test: `01_agents/alan/test/format.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to test/format.test.ts)**

```ts
import { recommendationsMessage } from "../src/format.js";
import type { Recommendations } from "../src/recommend/types.js";

describe("recommendationsMessage", () => {
  const recs: Recommendations = {
    tiers: [
      { key: "stock", items: [
        { name: "Baron Philippe Cab", priceLabel: "฿890", labelKey: "value", why: "Тот же плотный каб, проще." },
      ] },
      { key: "catalog", items: [
        { name: "Errazuriz Max Reserva", supplier: "IWS", priceLabel: "฿1,200", labelKey: "peer", why: "" },
      ] },
    ],
  };

  it("renders tier titles, prices, supplier and label", () => {
    const msg = recommendationsMessage(recs, "ru");
    expect(msg).toContain("🍷 В наличии у нас");
    expect(msg).toContain("Baron Philippe Cab — ฿890 · дешевле и почти так же");
    expect(msg).toContain("Тот же плотный каб, проще.");
    expect(msg).toContain("📦 Можем привезти (поставщики)");
    expect(msg).toContain("Errazuriz Max Reserva — ฿1,200 (IWS) · ровня");
  });

  it("returns an honest empty message when no tiers", () => {
    const msg = recommendationsMessage({ tiers: [] }, "ru");
    expect(msg).toContain("Похожего не нашёл");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/format.test.ts`
Expected: FAIL — `recommendationsMessage` is not exported.

- [ ] **Step 3: Add the implementation to `src/format.ts`**

Append at the end of `src/format.ts`. Add the `Recommendations` type import at the top — `import type { Recommendations } from "./recommend/types.js";` (`Lang` is already imported in `format.ts`, reuse it):

```ts
const TIER_TITLE = {
  stock:   { ru: "🍷 В наличии у нас",              en: "🍷 In stock" },
  catalog: { ru: "📦 Можем привезти (поставщики)",  en: "📦 Can order (suppliers)" },
  world:   { ru: "🌍 В мире есть (ориентир)",       en: "🌍 Out in the world (reference)" },
} as const;

const RECO_LABEL = {
  value:   { ru: "дешевле и почти так же", en: "cheaper, nearly as good" },
  peer:    { ru: "ровня",                  en: "peer" },
  upgrade: { ru: "апгрейд",                en: "upgrade" },
} as const;

/** Render three-tier recommendations as plain text (no Markdown), Alan's format. */
export function recommendationsMessage(recs: Recommendations, lang: Lang): string {
  if (recs.tiers.length === 0) {
    return lang === "ru"
      ? "Похожего не нашёл — ни в наличии, ни у поставщиков, ни в мире."
      : "Found nothing similar — not in stock, at suppliers, or out in the world.";
  }
  const out: string[] = [];
  for (const tier of recs.tiers) {
    out.push(TIER_TITLE[tier.key][lang]);
    for (const it of tier.items) {
      const price = it.priceLabel ? ` — ${it.priceLabel}` : "";
      const supplier = it.supplier ? ` (${it.supplier})` : "";
      out.push(`• ${it.name}${price}${supplier} · ${RECO_LABEL[it.labelKey][lang]}`);
      if (it.why) out.push(`  ${it.why}`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}
```

Note: `format.ts` already imports `Lang` from `./types.js` (verified); reuse it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 01_agents/alan/src/format.ts test/format.test.ts
git commit -m "feat(alan): render three-tier recommendations message"
```

---

### Task 12: Wire the button into the bot (`index.ts`)

**Files:**
- Modify: `01_agents/alan/src/index.ts` (imports, keyboard at ~123, new callback handler)

- [ ] **Step 1: Add imports**

In `src/index.ts`, extend the format import on line 6 and add the orchestrator import:

Change line 6 from:
```ts
import { shortVerdict, fullCard, analoguesMessage } from "./format.js";
```
to:
```ts
import { shortVerdict, fullCard, analoguesMessage, recommendationsMessage } from "./format.js";
```

Add after line 11 (`import { localPriceVerdict } from "./priceLocal.js";`):
```ts
import { recommend } from "./recommend.js";
```

- [ ] **Step 2: Add the second inline button**

In `handleQuery` (around lines 122-124), replace:
```ts
    const kb = new InlineKeyboard().text(
      query.lang === "ru" ? "Подробнее" : "Details", "details");
```
with:
```ts
    const kb = new InlineKeyboard()
      .text(query.lang === "ru" ? "Подробнее" : "Details", "details")
      .text(query.lang === "ru" ? "Похожие у нас" : "Similar in stock", "similar");
```

- [ ] **Step 3: Add the callback handler**

After the existing `bot.callbackQuery("details", …)` block (ends at line 230), add:

```ts
bot.callbackQuery("similar", async (ctx) => {
  await ctx.answerCallbackQuery();
  const key = userKey(ctx);
  const entry = sessions.get(key);
  if (!entry) {
    await ctx.reply(
      DEFAULT_LANG === "ru"
        ? "Сессия истекла, пришли вино заново."
        : "Session expired, send the wine again.");
    return;
  }
  const working = await ctx.reply(entry.lang === "ru" ? "Подбираю похожее…" : "Finding similar wines…");
  try {
    const recs = await recommend(entry.verdict, entry.lang);
    await dropProgress(ctx, working.message_id);
    await sendLong(ctx, recommendationsMessage(recs, entry.lang));
  } catch (err) {
    console.error("similar failed:", err);
    await dropProgress(ctx, working.message_id);
    await ctx.reply(FAIL[entry.lang]);
  }
});
```

- [ ] **Step 4: Typecheck + full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck clean; all tests pass (existing + new profile/priceMatch/format).

- [ ] **Step 5: Commit**

```bash
git add 01_agents/alan/src/index.ts
git commit -m "feat(alan): 'Похожие у нас' button + similar callback handler"
```

---

### Task 13: Manual smoke test + docs

**Files:**
- Modify: `01_agents/alan/README.md` (document the feature)

- [ ] **Step 1: Local smoke test (requires env)**

With `ALAN_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` in the environment `config.ts` loads (`../.env.local`):

Run: `npm run dev`
In Telegram: send a wine (photo or name), wait for the verdict, tap **«Похожие у нас»**.
Expected: a three-tier message (tiers with no matches are omitted). If Supabase is unreachable, the stock/catalog tiers drop and only «🌍 В мире есть» shows.

- [ ] **Step 2: Verify the data path independently (optional sanity check)**

Confirms the bot's key can read both sources (already verified during planning, re-check if stock/catalog tiers come back empty unexpectedly):

```bash
curl -s -o /dev/null -w "wine_items %{http_code}\n" \
  "$SUPABASE_URL/rest/v1/wine_items?select=id&category=eq.wine&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
curl -s -o /dev/null -w "v_sku_breakdown %{http_code}\n" \
  "$SUPABASE_URL/rest/v1/v_sku_breakdown?select=sku_id&on_hand=gt.0&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Accept-Profile: inventory"
```
Expected: both `200`.

- [ ] **Step 3: Document the feature in README**

Add under "## How it works" in `01_agents/alan/README.md`:

```markdown
## Similar wines ("Похожие у нас")
After a verdict, the **Похожие у нас** button recommends similar wines in three tiers:
in-stock (Loyverse `inventory.v_sku_breakdown`), supplier catalog (`public.wine_items`),
and the world (existing analogues search). Attribute prefilter → LLM re-rank; price
direction and the ровня/дешевле/апгрейд label are computed deterministically in code.
Reads Supabase directly with the bot's existing `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`
(same project as mission-control). Code lives in `src/recommend/`.
```

- [ ] **Step 4: Commit**

```bash
git add 01_agents/alan/README.md
git commit -m "docs(alan): document 'Похожие у нас' recommendations"
```

- [ ] **Step 5: Push (deploys to Railway on main)**

```bash
git push origin main
```

---

## Self-Review

**Spec coverage:**
- Triple tier (stock → catalog → world) → Tasks 6, 7, 9, 10. ✓
- «Оба + пометка» labels (ровня/дешевле/апгрейд) → Task 4 (`pickLabel`) + Task 11 (render). ✓
- On-demand button trigger → Task 12. ✓
- Approach A (attribute prefilter + LLM re-rank, code owns price) → Tasks 4, 7, 8, 10. ✓
- Direct Supabase access (updated decision) → Tasks 5, 6, 7. ✓
- Parallel tiers, skip empty/failed, world fallback → Task 10 (`Promise.allSettled` + filter). ✓
- Honest "nothing found" → Task 11. ✓
- No cache / no embeddings / no auto-trigger (YAGNI) → not implemented, by design. ✓
- Currency normalization THB↔USD → Tasks 1, 4. ✓
- Testing pure logic only → Tasks 3, 4, 6, 7, 11. ✓

**Placeholder scan:** none — every step has concrete code or exact commands.

**Type consistency:** `MatchProfile`, `StockItem`, `CatalogItem`, `RankPick`, `RecoItem`, `RecoTier`, `Recommendations`, `LabelKey`, `PriceDirection`, `QualityVsAnchor` defined in Task 2 and used consistently. `buildProfile`, `normalizeType`, `priceDirection`, `pickLabel`, `directionForThb`, `catalogPriceRangeThb`, `parseUsd`, `thaiAnchorUsd`, `toStockItem`, `toCatalogItem`, `fetchStockCandidates`, `fetchCatalogCandidates`, `rankCandidates`, `worldTier`, `recommend`, `recommendationsMessage` — names match across tasks. Re-rank returns `ref` indices validated against the candidate set (Task 8) and mapped back in Task 10.

**Open items:** none — `buildQuery` signature (`images` optional) and `format.ts` `Lang` import both verified during planning.
