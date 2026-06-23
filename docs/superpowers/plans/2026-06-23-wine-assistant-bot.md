# Wine Assistant Bot («Алан») Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Telegram bot — a realist sommelier named Алан — that gives an honest, data-grounded assessment of any wine (from a label photo, typed name, or voice note) and suggests global analogues.

**Architecture:** Approach C (Hybrid). A grammy bot receives photo/text/voice, normalizes the input, then runs a two-step LLM pipeline behind a `WineDataSource` seam: (1) **research** — one Claude call with the Anthropic server-side `web_search`/`web_fetch` tools gathers critic scores, market prices, and community sentiment with citations; (2) **structure** — a second Claude structured-output call extracts raw `WineEvidence`. Deterministic code then normalizes critic scales to 100-pt, computes a quality-to-price (QPR) verdict, and assembles a short verdict + "Подробнее" full card. Analogues reuse the same research seam. Honesty is enforced by the system prompt + output contract (always show confidence and sources; never fabricate).

**Tech Stack:** Node + TypeScript (ESM, NodeNext), grammy, `@anthropic-ai/sdk` (Claude Opus 4.8, adaptive thinking, server-side web search), `openai` (Whisper for voice), `dotenv`, `vitest` for unit tests. Deploys to Railway. Reuses patterns from `01_agents/bot/` and `01_agents/barrymore/`.

**Key API facts (verified against the `claude-api` skill, 2026-06-23):**
- Main model: `claude-opus-4-8`. Cheap fallback: `claude-haiku-4-5`.
- Adaptive thinking: `thinking: { type: "adaptive" }`. Depth via `output_config: { effort: "..." }`. Do **not** send `budget_tokens`/`temperature` (400 on Opus 4.8).
- Server-side web tools: `{ type: "web_search_20260209", name: "web_search" }` and `{ type: "web_fetch_20260209", name: "web_fetch" }`. Dynamic filtering is built into this version on Opus 4.8 — do NOT also add the standalone `code_execution` tool. The server runs its own loop; if it hits the iteration limit the response has `stop_reason: "pause_turn"` — re-send `[user, assistant(response.content)]` to resume (cap continuations).
- Vision: base64 image content block `{ type: "image", source: { type: "base64", media_type, data } }`.
- Structured output: `output_config: { format: { type: "json_schema", schema } }`. Incompatible with citations — so the **research** call (which uses web search/citations) returns free-form text, and the separate **structure** call (no tools) uses `output_config.format`.
- Stream when `max_tokens` is large; for these calls `max_tokens: 8000` non-streaming is fine.

---

## File Structure

```
01_agents/alan/
  package.json              Task 1
  tsconfig.json             Task 1
  vitest.config.ts          Task 1
  README.md                 Task 15
  src/
    config.ts               Task 2  — env + constants (models, TTL, default lang)
    types.ts                Task 2  — shared types (WineQuery, WineEvidence, Verdict, …)
    lang.ts                 Task 3  — detect reply language from text
    normalize.ts            Task 4  — critic-scale → 100-pt + Bayesian aggregate
    qpr.ts                  Task 5  — quality-to-price ratio → 1–10 verdict
    assess.ts               Task 6  — assemble Verdict from WineEvidence (deterministic)
    sommelier-prompt.ts     Task 7  — system prompt (the honesty contract) + JSON schemas
    sources/
      types.ts              Task 8  — WineDataSource interface + Research types
      websearch.ts          Task 8  — WebSearchSource (Claude + server-side web search)
    structure.ts            Task 9  — Claude structured-output: research text → WineEvidence / Analogues
    pipeline.ts             Task 10 — orchestrates research → structure → assess per intent
    format.ts               Task 11 — Verdict/Analogues → Telegram short + full card
    voice.ts                Task 12 — Whisper transcription (adapted from barrymore)
    input.ts                Task 12 — normalize photo/text/voice → WineQuery
    session.ts              Task 13 — in-memory session store with TTL
    index.ts                Task 14 — grammy wiring (handlers, "Подробнее" button)
  test/
    lang.test.ts            Task 3
    normalize.test.ts       Task 4
    qpr.test.ts             Task 5
    assess.test.ts          Task 6
    format.test.ts          Task 11
    session.test.ts         Task 13
```

Each module has one responsibility. The pure modules (lang, normalize, qpr, assess, format, session) are unit-tested with vitest. The LLM/Telegram modules (websearch, structure, pipeline, voice, input, index) are integration-wired with real code and verified by a manual end-to-end run in Task 15 (no live-API unit tests).

---

### Task 1: Scaffold the `alan` package

**Files:**
- Create: `01_agents/alan/package.json`
- Create: `01_agents/alan/tsconfig.json`
- Create: `01_agents/alan/vitest.config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "alan-bot",
  "version": "1.0.0",
  "description": "Алан — винный помощник Wine & Whiskey",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "dotenv": "^16.4.0",
    "grammy": "^1.30.0",
    "openai": "^6.34.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (matches the ESM/NodeNext setup the other bots use)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 4: Install dependencies, upgrading the Anthropic SDK to latest**

Run (from `01_agents/alan/`):
```bash
npm install
npm install @anthropic-ai/sdk@latest
```
Expected: `node_modules/` created; `@anthropic-ai/sdk` resolves to a current version (≥ 0.60) that supports `web_search_20260209` and adaptive thinking. The older `^0.39.0` pin in the other bots predates server-side web search — this package intentionally upgrades, and being a separate `package.json` it does not affect them.

- [ ] **Step 5: Verify the toolchain runs**

Run: `npx vitest run`
Expected: vitest starts and reports "No test files found" (no tests yet) — confirms the runner works.

- [ ] **Step 6: Commit**

```bash
git add 01_agents/alan/package.json 01_agents/alan/tsconfig.json 01_agents/alan/vitest.config.ts 01_agents/alan/package-lock.json
git commit -m "chore(alan): scaffold wine assistant bot package"
```

---

### Task 2: Shared types and config

**Files:**
- Create: `01_agents/alan/src/types.ts`
- Create: `01_agents/alan/src/config.ts`

- [ ] **Step 1: Create `src/types.ts`**

```typescript
export type Lang = "ru" | "en";

export type Intent = "assess" | "analogues";

/** Normalized user input, language-detected, ready for the pipeline. */
export interface WineQuery {
  text: string;          // typed text, voice transcript, or photo caption ("" if none)
  imageBase64?: string;  // PNG/JPEG label photo, base64 (no data: prefix)
  imageMediaType?: "image/png" | "image/jpeg" | "image/webp";
  lang: Lang;
  intent: Intent;
}

export type CriticScale = "100pt" | "20pt" | "5star";

export interface CriticScore {
  source: string;        // e.g. "Decanter", "James Suckling"
  rawScore: number;      // as published, on `scale`
  scale: CriticScale;
}

export interface CommunityRating {
  value: number;         // as published
  scale: "5star" | "100pt";
  count: number;         // number of reviews (0 if unknown)
}

export interface PriceObservation {
  amount: number;        // numeric
  currency: string;      // ISO-ish, e.g. "USD", "THB", "EUR"
  context: string;       // e.g. "Wine-Searcher average", "retailer X"
}

/** Raw, source-attributed evidence extracted from research. The model fills this;
 *  all scoring math happens in code (normalize.ts / qpr.ts / assess.ts). */
export interface WineEvidence {
  identity: {
    producer: string;
    name: string;
    vintage: string;     // "" if NV/unknown
    region: string;      // "" if unknown
    grape: string;       // "" if unknown
    type: string;        // "red" | "white" | "sparkling" | "rosé" | "fortified" | "" 
    idConfidence: "high" | "medium" | "low";
  };
  criticScores: CriticScore[];
  communityRating: CommunityRating | null;
  priceObservations: PriceObservation[];
  tastingNotes: string;  // short, factual
  drinkingWindow: string; // "" if unknown
  dataConfidence: "high" | "medium" | "low"; // overall confidence in the evidence
  sources: string[];     // URLs or named sources
}

export interface AnalogueItem {
  name: string;          // producer + wine
  why: string;           // one-line reasoning for the match
  approxPrice: string;   // "" if unknown
}

export interface AnaloguesResult {
  forWine: string;       // the wine we matched against
  analogues: AnalogueItem[];
  dataConfidence: "high" | "medium" | "low";
  sources: string[];
}

/** The honest verdict assembled deterministically from WineEvidence. */
export interface Verdict {
  identity: WineEvidence["identity"];
  criticConsensus: number | null;   // 0–100 Bayesian aggregate, null if no critics
  criticCount: number;
  communityNote: string;            // human phrasing of crowd signal, "" if none
  marketPrice: PriceObservation | null;
  qpr: { rating: number; label: string } | null; // 1–10 + label, null if price/quality missing
  bottomLine: string;               // "take" | "skip" | "overpriced" | "depends" → human label
  tastingNotes: string;
  drinkingWindow: string;
  dataConfidence: WineEvidence["dataConfidence"];
  sources: string[];
}
```

- [ ] **Step 2: Create `src/config.ts`**

```typescript
import dotenv from "dotenv";
dotenv.config({ path: "../.env.local" });

import type { Lang } from "./types.js";

export const TELEGRAM_TOKEN = process.env.ALAN_BOT_TOKEN!;
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

export const MODEL_MAIN = "claude-opus-4-8";
export const MODEL_CHEAP = "claude-haiku-4-5";

/** Reply language when the message carries no detectable text (e.g. bare photo). */
export const DEFAULT_LANG: Lang = "ru";

/** Session time-to-live (ms) — drops follow-up context after inactivity. */
export const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

export function assertEnv(): void {
  const missing = [
    ["ALAN_BOT_TOKEN", TELEGRAM_TOKEN],
    ["ANTHROPIC_API_KEY", ANTHROPIC_API_KEY],
    ["OPENAI_API_KEY", OPENAI_API_KEY],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). `types.ts` and `config.ts` compile.

- [ ] **Step 4: Commit**

```bash
git add 01_agents/alan/src/types.ts 01_agents/alan/src/config.ts
git commit -m "feat(alan): shared types and config"
```

---

### Task 3: Language detection

**Files:**
- Create: `01_agents/alan/src/lang.ts`
- Test: `01_agents/alan/test/lang.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { detectLang } from "../src/lang.js";

describe("detectLang", () => {
  it("detects Russian from Cyrillic", () => {
    expect(detectLang("что это за вино", "en")).toBe("ru");
  });
  it("detects English from Latin", () => {
    expect(detectLang("what is this wine", "ru")).toBe("en");
  });
  it("uses fallback when text is empty", () => {
    expect(detectLang("", "ru")).toBe("ru");
    expect(detectLang("   ", "en")).toBe("en");
  });
  it("treats majority-Cyrillic mixed text as Russian", () => {
    expect(detectLang("это Chateau Margaux 2015", "en")).toBe("ru");
  });
  it("treats a wine name with no Cyrillic as English", () => {
    expect(detectLang("Chateau Margaux 2015", "ru")).toBe("en");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lang.test.ts`
Expected: FAIL — "Failed to resolve import ... src/lang.js" / `detectLang is not a function`.

- [ ] **Step 3: Write `src/lang.ts`**

```typescript
import type { Lang } from "./types.js";

/** Detect reply language. Russian if Cyrillic letters outnumber Latin ones;
 *  otherwise English. Falls back to `fallback` when there are no letters. */
export function detectLang(text: string, fallback: Lang): Lang {
  const cyrillic = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cyrillic === 0 && latin === 0) return fallback;
  return cyrillic >= latin ? "ru" : "en";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lang.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add 01_agents/alan/src/lang.ts 01_agents/alan/test/lang.test.ts
git commit -m "feat(alan): reply-language detection"
```

---

### Task 4: Critic-scale normalization and aggregation

**Files:**
- Create: `01_agents/alan/src/normalize.ts`
- Test: `01_agents/alan/test/normalize.test.ts`

Methodology (from the research, Wine-Searcher model): convert every critic score to the 100-pt scale (20-pt ×5; 5-star → `80 + (stars-1)/4*20` so 5★=100, 4★=80, 3★=60), then take a Bayesian aggregate that pulls a small number of scores toward a neutral prior (so one lone 99-pt rave doesn't read as consensus). Prior mean 90, prior weight 3.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { toHundred, bayesianAggregate } from "../src/normalize.js";
import type { CriticScore } from "../src/types.js";

describe("toHundred", () => {
  it("passes through 100-pt", () => {
    expect(toHundred({ source: "x", rawScore: 92, scale: "100pt" })).toBe(92);
  });
  it("converts 20-pt by ×5", () => {
    expect(toHundred({ source: "x", rawScore: 18, scale: "20pt" })).toBe(90);
    expect(toHundred({ source: "x", rawScore: 19, scale: "20pt" })).toBe(95);
  });
  it("maps 5-star onto 80–100", () => {
    expect(toHundred({ source: "x", rawScore: 5, scale: "5star" })).toBe(100);
    expect(toHundred({ source: "x", rawScore: 4, scale: "5star" })).toBe(80);
    expect(toHundred({ source: "x", rawScore: 3, scale: "5star" })).toBe(60);
  });
});

describe("bayesianAggregate", () => {
  it("returns null for no scores", () => {
    expect(bayesianAggregate([])).toBeNull();
  });
  it("pulls a single extreme score toward the prior", () => {
    const scores: CriticScore[] = [{ source: "a", rawScore: 99, scale: "100pt" }];
    // (90*3 + 99*1) / 4 = 92.25 → 92
    expect(bayesianAggregate(scores)).toBe(92);
  });
  it("converges toward the mean as evidence accumulates", () => {
    const scores: CriticScore[] = [
      { source: "a", rawScore: 95, scale: "100pt" },
      { source: "b", rawScore: 93, scale: "100pt" },
      { source: "c", rawScore: 94, scale: "100pt" },
      { source: "d", rawScore: 96, scale: "100pt" },
      { source: "e", rawScore: 95, scale: "100pt" },
      { source: "f", rawScore: 94, scale: "100pt" },
    ];
    // (90*3 + 567) / 9 = 93 → 93
    expect(bayesianAggregate(scores)).toBe(93);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/normalize.test.ts`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Write `src/normalize.ts`**

```typescript
import type { CriticScore } from "./types.js";

const PRIOR_MEAN = 90;
const PRIOR_WEIGHT = 3;

/** Convert one critic score to the 100-point scale. */
export function toHundred(s: CriticScore): number {
  switch (s.scale) {
    case "100pt": return s.rawScore;
    case "20pt":  return s.rawScore * 5;
    case "5star": return 80 + ((s.rawScore - 1) / 4) * 20;
  }
}

/** Quantity-weighted Bayesian aggregate on the 100-pt scale, rounded to an int.
 *  Returns null when there are no scores. */
export function bayesianAggregate(scores: CriticScore[]): number | null {
  if (scores.length === 0) return null;
  const sum = scores.reduce((acc, s) => acc + toHundred(s), 0);
  const agg = (PRIOR_MEAN * PRIOR_WEIGHT + sum) / (PRIOR_WEIGHT + scores.length);
  return Math.round(agg);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/normalize.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add 01_agents/alan/src/normalize.ts 01_agents/alan/test/normalize.test.ts
git commit -m "feat(alan): critic-scale normalization + Bayesian aggregate"
```

---

### Task 5: Quality-to-price verdict

**Files:**
- Create: `01_agents/alan/src/qpr.ts`
- Test: `01_agents/alan/test/qpr.test.ts`

Methodology (from the research, The Wine Independent QPR template, adapted): map a 100-pt quality score and a USD price to a 1–10 value rating. Higher quality earns a bonus; cheaper earns more. The result is bucketed into a 1–10 rating with a label. Currency is normalized to USD by the caller before this runs (see assess.ts); qpr works in USD.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { qprRating } from "../src/qpr.js";

describe("qprRating", () => {
  it("rates a cheap high-scorer near the top", () => {
    const r = qprRating(92, 15); // excellent wine, cheap
    expect(r.rating).toBeGreaterThanOrEqual(8);
    expect(r.label).toBeTruthy();
  });
  it("rates an expensive mediocre wine near the bottom", () => {
    const r = qprRating(86, 60); // unremarkable, pricey
    expect(r.rating).toBeLessThanOrEqual(3);
  });
  it("clamps into the 1–10 range", () => {
    expect(qprRating(100, 5).rating).toBeLessThanOrEqual(10);
    expect(qprRating(80, 500).rating).toBeGreaterThanOrEqual(1);
  });
  it("treats a non-positive price as unknown (null)", () => {
    expect(qprRating(92, 0)).toBeNull();
    expect(qprRating(92, -5)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/qpr.test.ts`
Expected: FAIL — `qprRating` not found.

- [ ] **Step 3: Write `src/qpr.ts`**

```typescript
export interface Qpr {
  rating: number; // 1–10
  label: string;
}

const LABELS: Record<number, string> = {
  10: "Bargain of a lifetime",
  9: "Outstanding value",
  8: "Excellent value",
  7: "Very good value",
  6: "Good value",
  5: "Fair value",
  4: "Slightly pricey",
  3: "Pricey for what it is",
  2: "Expensive for what it is",
  1: "Forget it",
};

/** Quality (0–100) + price (USD) → 1–10 value rating. Returns null if price unknown. */
export function qprRating(quality: number, priceUsd: number): Qpr | null {
  if (!(priceUsd > 0)) return null;

  // Base: quality points above the 80-pt "drinkable" floor, per dollar.
  const base = Math.max(0, quality - 80) / priceUsd;     // e.g. 12 pts / $15 = 0.8
  // Quality bonus rewards genuinely high scores regardless of price.
  const bonus = quality >= 96 ? 3 : quality >= 90 ? 1.5 : quality >= 87 ? 0.5 : 0;

  const raw = base * 8 + bonus;                          // tuned so cheap-90s land ~8–9
  const rating = Math.min(10, Math.max(1, Math.round(raw)));
  return { rating, label: LABELS[rating] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/qpr.test.ts`
Expected: PASS (4 tests). (If the first case lands below 8, the multiplier `* 8` is the tuning knob — raise it; the test encodes the intended behavior.)

- [ ] **Step 5: Commit**

```bash
git add 01_agents/alan/src/qpr.ts 01_agents/alan/test/qpr.test.ts
git commit -m "feat(alan): quality-to-price (QPR) verdict"
```

---

### Task 6: Assemble the honest Verdict from evidence

**Files:**
- Create: `01_agents/alan/src/assess.ts`
- Test: `01_agents/alan/test/assess.test.ts`

`assess.ts` is deterministic: it takes `WineEvidence` + a USD-conversion function and produces a `Verdict`. It applies normalize/qpr, derives the bottom line, and enforces honesty rules (no QPR when price unknown; no critic consensus when no critics; community note phrased as crowd-not-critic).

Currency note: for MVP, convert to USD with a small static table; unknown currencies are treated as "price unknown" (qpr null) rather than guessed. The rate table is a config constant and intentionally approximate — it only feeds the value bucket, which is coarse.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { assembleVerdict } from "../src/assess.js";
import type { WineEvidence } from "../src/types.js";

const base: WineEvidence = {
  identity: { producer: "Test", name: "Red", vintage: "2018", region: "", grape: "", type: "red", idConfidence: "high" },
  criticScores: [
    { source: "Decanter", rawScore: 93, scale: "100pt" },
    { source: "Suckling", rawScore: 18, scale: "20pt" }, // → 90
  ],
  communityRating: { value: 4.1, scale: "5star", count: 1200 },
  priceObservations: [{ amount: 15, currency: "USD", context: "avg" }],
  tastingNotes: "dark fruit, soft tannins",
  drinkingWindow: "2024–2030",
  dataConfidence: "high",
  sources: ["https://example.com"],
};

describe("assembleVerdict", () => {
  it("computes critic consensus and QPR for complete evidence", () => {
    const v = assembleVerdict(base);
    expect(v.criticConsensus).not.toBeNull();
    expect(v.criticCount).toBe(2);
    expect(v.qpr).not.toBeNull();
    expect(v.marketPrice?.currency).toBe("USD");
    expect(v.sources).toEqual(["https://example.com"]);
  });

  it("omits QPR when no price is known", () => {
    const v = assembleVerdict({ ...base, priceObservations: [] });
    expect(v.qpr).toBeNull();
    expect(v.bottomLine).toBeTruthy(); // still gives a bottom line from quality alone
  });

  it("omits critic consensus when there are no critics", () => {
    const v = assembleVerdict({ ...base, criticScores: [] });
    expect(v.criticConsensus).toBeNull();
    expect(v.criticCount).toBe(0);
  });

  it("never invents sources or notes on thin evidence", () => {
    const v = assembleVerdict({
      ...base,
      criticScores: [], communityRating: null, priceObservations: [],
      tastingNotes: "", drinkingWindow: "", dataConfidence: "low", sources: [],
    });
    expect(v.criticConsensus).toBeNull();
    expect(v.qpr).toBeNull();
    expect(v.communityNote).toBe("");
    expect(v.sources).toEqual([]);
    expect(v.dataConfidence).toBe("low");
  });

  it("flags an overpriced wine in the bottom line", () => {
    const v = assembleVerdict({
      ...base,
      criticScores: [{ source: "Decanter", rawScore: 86, scale: "100pt" }],
      priceObservations: [{ amount: 80, currency: "USD", context: "avg" }],
    });
    expect(v.bottomLine.toLowerCase()).toContain("overpriced");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/assess.test.ts`
Expected: FAIL — `assembleVerdict` not found.

- [ ] **Step 3: Write `src/assess.ts`**

```typescript
import type { WineEvidence, Verdict, PriceObservation } from "./types.js";
import { bayesianAggregate } from "./normalize.js";
import { qprRating } from "./qpr.js";

/** Approximate FX to USD — coarse on purpose; only feeds the value bucket. */
const USD_RATE: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, THB: 0.028, RUB: 0.011, AUD: 0.66, NZD: 0.61,
};

function toUsd(p: PriceObservation): number | null {
  const rate = USD_RATE[p.currency.toUpperCase()];
  return rate ? p.amount * rate : null;
}

/** Pick the most representative price: prefer an "average"/"market" observation,
 *  else the median of all convertible observations. */
function pickPrice(obs: PriceObservation[]): PriceObservation | null {
  if (obs.length === 0) return null;
  const avg = obs.find((o) => /aver|market|search/i.test(o.context));
  if (avg && toUsd(avg) !== null) return avg;
  const convertible = obs.filter((o) => toUsd(o) !== null);
  if (convertible.length === 0) return null;
  const sorted = [...convertible].sort((a, b) => toUsd(a)! - toUsd(b)!);
  return sorted[Math.floor(sorted.length / 2)];
}

export function assembleVerdict(e: WineEvidence): Verdict {
  const criticConsensus = bayesianAggregate(e.criticScores);
  const marketPrice = pickPrice(e.priceObservations);
  const priceUsd = marketPrice ? toUsd(marketPrice) : null;

  const quality = criticConsensus
    ?? (e.communityRating ? communityToHundred(e.communityRating) : null);
  const qpr = quality !== null && priceUsd !== null ? qprRating(quality, priceUsd) : null;

  const communityNote = e.communityRating
    ? `${e.communityRating.value}/${e.communityRating.scale === "5star" ? "5" : "100"}` +
      (e.communityRating.count ? ` (${e.communityRating.count} reviews)` : "")
    : "";

  return {
    identity: e.identity,
    criticConsensus,
    criticCount: e.criticScores.length,
    communityNote,
    marketPrice,
    qpr,
    bottomLine: bottomLine(quality, qpr ? qpr.rating : null),
    tastingNotes: e.tastingNotes,
    drinkingWindow: e.drinkingWindow,
    dataConfidence: e.dataConfidence,
    sources: e.sources,
  };
}

function communityToHundred(c: WineEvidence["communityRating"]): number | null {
  if (!c) return null;
  return c.scale === "100pt" ? c.value : 80 + ((c.value - 1) / 4) * 20;
}

/** Honest one-word-ish bottom line. */
function bottomLine(quality: number | null, qpr: number | null): string {
  if (quality === null) return "depends — not enough data";
  if (qpr !== null && qpr <= 3) return "overpriced — skip unless you love the style";
  if (qpr !== null && qpr >= 7) return "take it — strong value";
  if (quality >= 90) return "take it — genuinely good";
  if (quality < 85) return "skip — unremarkable";
  return "depends — fine but not special";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/assess.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add 01_agents/alan/src/assess.ts 01_agents/alan/test/assess.test.ts
git commit -m "feat(alan): deterministic honest-verdict assembly"
```

---

### Task 7: Sommelier system prompt + JSON schemas

**Files:**
- Create: `01_agents/alan/src/sommelier-prompt.ts`

No automated test — this is content. It defines the honesty contract and the JSON schemas the `structure` call validates against.

- [ ] **Step 1: Create `src/sommelier-prompt.ts`**

```typescript
import type { Lang } from "./types.js";

/** System prompt for the RESEARCH call (with web search). Enforces the honest,
 *  realist sommelier voice and forbids fabrication. */
export function researchSystemPrompt(lang: Lang): string {
  const langLine = lang === "ru"
    ? "Отвечай по-русски."
    : "Respond in English.";
  return [
    "You are Алан, a blunt, honest sommelier. You tell the truth about a wine —",
    "not marketing. You are willing to say a wine is mediocre or overpriced.",
    "",
    "Your job: identify the wine (from the image and/or text), then research it",
    "using web search. Gather, with sources:",
    "- professional critic scores (Decanter, Wine Spectator, Wine Enthusiast,",
    "  James Suckling, Jancis Robinson, Vinous, etc.) WITH the scale used;",
    "- community sentiment (e.g. Vivino average + number of ratings) — label it",
    "  clearly as crowd opinion, which differs from critics;",
    "- typical market price (Wine-Searcher-style average) with currency;",
    "- tasting notes and drinking window if reliably reported.",
    "",
    "Rules of honesty:",
    "- Distinguish CRITIC scores from CROWD ratings explicitly.",
    "- If you cannot find reliable data, say so plainly. NEVER invent scores,",
    "  prices, or sources. Missing data is an acceptable, expected outcome.",
    "- State how confident you are in the identification and in the data.",
    "",
    "Write a concise factual brief of what you found, citing sources.",
    langLine,
  ].join("\n");
}

/** System prompt for the ANALOGUES research call. */
export function analoguesSystemPrompt(lang: Lang): string {
  const langLine = lang === "ru" ? "Отвечай по-русски." : "Respond in English.";
  return [
    "You are Алан, an honest sommelier. The user names a wine (image and/or text).",
    "Identify it, then propose 3–5 globally-available analogues — wines similar in",
    "STYLE, QUALITY LEVEL, and PRICE BAND. Not tied to any shop's stock.",
    "For each analogue give a one-line reason for the match and an approximate price.",
    "Use web search to ground your suggestions. Cite sources. If confidence is low,",
    "say so. NEVER invent wines that do not exist.",
    langLine,
  ].join("\n");
}

/** JSON schema for WineEvidence (the structure call). Mirrors types.ts::WineEvidence. */
export const EVIDENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    identity: {
      type: "object", additionalProperties: false,
      properties: {
        producer: { type: "string" }, name: { type: "string" },
        vintage: { type: "string" }, region: { type: "string" },
        grape: { type: "string" }, type: { type: "string" },
        idConfidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["producer", "name", "vintage", "region", "grape", "type", "idConfidence"],
    },
    criticScores: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          source: { type: "string" },
          rawScore: { type: "number" },
          scale: { type: "string", enum: ["100pt", "20pt", "5star"] },
        },
        required: ["source", "rawScore", "scale"],
      },
    },
    communityRating: {
      anyOf: [
        { type: "null" },
        {
          type: "object", additionalProperties: false,
          properties: {
            value: { type: "number" },
            scale: { type: "string", enum: ["5star", "100pt"] },
            count: { type: "number" },
          },
          required: ["value", "scale", "count"],
        },
      ],
    },
    priceObservations: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          amount: { type: "number" }, currency: { type: "string" }, context: { type: "string" },
        },
        required: ["amount", "currency", "context"],
      },
    },
    tastingNotes: { type: "string" },
    drinkingWindow: { type: "string" },
    dataConfidence: { type: "string", enum: ["high", "medium", "low"] },
    sources: { type: "array", items: { type: "string" } },
  },
  required: [
    "identity", "criticScores", "communityRating", "priceObservations",
    "tastingNotes", "drinkingWindow", "dataConfidence", "sources",
  ],
} as const;

/** JSON schema for AnaloguesResult. Mirrors types.ts::AnaloguesResult. */
export const ANALOGUES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    forWine: { type: "string" },
    analogues: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          name: { type: "string" }, why: { type: "string" }, approxPrice: { type: "string" },
        },
        required: ["name", "why", "approxPrice"],
      },
    },
    dataConfidence: { type: "string", enum: ["high", "medium", "low"] },
    sources: { type: "array", items: { type: "string" } },
  },
  required: ["forWine", "analogues", "dataConfidence", "sources"],
} as const;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add 01_agents/alan/src/sommelier-prompt.ts
git commit -m "feat(alan): sommelier system prompts + evidence/analogues JSON schemas"
```

---

### Task 8: WineDataSource seam + WebSearchSource (research)

**Files:**
- Create: `01_agents/alan/src/sources/types.ts`
- Create: `01_agents/alan/src/sources/websearch.ts`

The seam: `WineDataSource.research(input)` returns the model's free-form research brief + the resolved identity text. MVP impl uses one Claude Opus call with the server-side `web_search`/`web_fetch` tools. Handles `pause_turn`. No automated test (live API) — verified end-to-end in Task 15.

- [ ] **Step 1: Create `src/sources/types.ts`**

```typescript
import type { WineQuery } from "../types.js";

export interface ResearchInput {
  query: WineQuery;
  systemPrompt: string;
}

export interface ResearchResult {
  brief: string;     // model's factual research text (with inline source mentions)
}

/** The seam. MVP impl = WebSearchSource. Future: VivinoSource, LwinSource, LivexSource. */
export interface WineDataSource {
  research(input: ResearchInput): Promise<ResearchResult>;
}
```

- [ ] **Step 2: Create `src/sources/websearch.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, MODEL_MAIN } from "../config.js";
import type { WineDataSource, ResearchInput, ResearchResult } from "./types.js";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const WEB_TOOLS = [
  { type: "web_search_20260209", name: "web_search" },
  { type: "web_fetch_20260209", name: "web_fetch" },
] as const;

const MAX_CONTINUATIONS = 4;

function userContent(input: ResearchInput): Anthropic.MessageParam["content"] {
  const blocks: any[] = [];
  if (input.query.imageBase64) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: input.query.imageMediaType ?? "image/jpeg",
        data: input.query.imageBase64,
      },
    });
  }
  const text = input.query.text.trim();
  blocks.push({
    type: "text",
    text: text
      ? text
      : "Identify the wine in this photo and research it as instructed.",
  });
  return blocks;
}

export const webSearchSource: WineDataSource = {
  async research(input: ResearchInput): Promise<ResearchResult> {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: userContent(input) },
    ];

    let response = await anthropic.messages.create({
      model: MODEL_MAIN,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: input.systemPrompt,
      tools: WEB_TOOLS as any,
      messages,
    });

    // Resume the server-side tool loop if it paused.
    let continuations = 0;
    while (response.stop_reason === "pause_turn" && continuations < MAX_CONTINUATIONS) {
      messages.push({ role: "assistant", content: response.content });
      response = await anthropic.messages.create({
        model: MODEL_MAIN,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        system: input.systemPrompt,
        tools: WEB_TOOLS as any,
        messages,
      });
      continuations++;
    }

    const brief = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return { brief };
  },
};
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (The `as any` on `tools` is intentional — server-tool literal types vary by SDK version; the runtime shape is correct per the verified API spec.)

- [ ] **Step 4: Commit**

```bash
git add 01_agents/alan/src/sources/types.ts 01_agents/alan/src/sources/websearch.ts
git commit -m "feat(alan): WineDataSource seam + web-search research source"
```

---

### Task 9: Structure research into WineEvidence / Analogues

**Files:**
- Create: `01_agents/alan/src/structure.ts`

A second Claude call (no tools) converts the free-form research brief into validated JSON via `output_config.format`. No automated test (live API) — verified in Task 15.

- [ ] **Step 1: Create `src/structure.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, MODEL_MAIN } from "./config.js";
import { EVIDENCE_SCHEMA, ANALOGUES_SCHEMA } from "./sommelier-prompt.js";
import type { WineEvidence, AnaloguesResult } from "./types.js";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

async function structured<T>(brief: string, schema: unknown, instruction: string): Promise<T> {
  const response = await anthropic.messages.create({
    model: MODEL_MAIN,
    max_tokens: 4000,
    system: `${instruction}\nUse ONLY facts present in the research brief. Do not add data that is not in the brief. Empty/zero/"" for anything the brief does not establish.`,
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: brief }],
  } as any);

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text) as T;
}

export function structureEvidence(brief: string): Promise<WineEvidence> {
  return structured<WineEvidence>(
    brief, EVIDENCE_SCHEMA,
    "Extract structured wine evidence from this research brief.",
  );
}

export function structureAnalogues(brief: string): Promise<AnaloguesResult> {
  return structured<AnaloguesResult>(
    brief, ANALOGUES_SCHEMA,
    "Extract the analogue recommendations from this research brief.",
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add 01_agents/alan/src/structure.ts
git commit -m "feat(alan): structured-output extraction of evidence/analogues"
```

---

### Task 10: Pipeline orchestration

**Files:**
- Create: `01_agents/alan/src/pipeline.ts`

Wires research → structure → assess per intent. No automated test (orchestration over live calls) — verified in Task 15.

- [ ] **Step 1: Create `src/pipeline.ts`**

```typescript
import type { WineQuery, Verdict, AnaloguesResult } from "./types.js";
import { webSearchSource } from "./sources/websearch.js";
import type { WineDataSource } from "./sources/types.js";
import { researchSystemPrompt, analoguesSystemPrompt } from "./sommelier-prompt.js";
import { structureEvidence, structureAnalogues } from "./structure.js";
import { assembleVerdict } from "./assess.js";

/** Assess a wine: research → extract evidence → deterministic verdict. */
export async function assessWine(
  query: WineQuery,
  source: WineDataSource = webSearchSource,
): Promise<Verdict> {
  const { brief } = await source.research({
    query,
    systemPrompt: researchSystemPrompt(query.lang),
  });
  const evidence = await structureEvidence(brief);
  return assembleVerdict(evidence);
}

/** Find global analogues: research → extract analogues. */
export async function findAnalogues(
  query: WineQuery,
  source: WineDataSource = webSearchSource,
): Promise<AnaloguesResult> {
  const { brief } = await source.research({
    query,
    systemPrompt: analoguesSystemPrompt(query.lang),
  });
  return structureAnalogues(brief);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add 01_agents/alan/src/pipeline.ts
git commit -m "feat(alan): research→structure→assess pipeline"
```

---

### Task 11: Telegram formatting (short verdict + full card)

**Files:**
- Create: `01_agents/alan/src/format.ts`
- Test: `01_agents/alan/test/format.test.ts`

Pure functions: `Verdict` → short message (3–4 lines + bottom line) and full card; `AnaloguesResult` → message. Bilingual labels.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { shortVerdict, fullCard, analoguesMessage } from "../src/format.js";
import type { Verdict, AnaloguesResult } from "../src/types.js";

const verdict: Verdict = {
  identity: { producer: "Test", name: "Red", vintage: "2018", region: "Rioja", grape: "Tempranillo", type: "red", idConfidence: "high" },
  criticConsensus: 92, criticCount: 3,
  communityNote: "4.1/5 (1200 reviews)",
  marketPrice: { amount: 15, currency: "USD", context: "avg" },
  qpr: { rating: 8, label: "Excellent value" },
  bottomLine: "take it — strong value",
  tastingNotes: "dark fruit, soft tannins",
  drinkingWindow: "2024–2030",
  dataConfidence: "high",
  sources: ["https://a.com", "https://b.com"],
};

describe("shortVerdict", () => {
  it("includes name, bottom line, and is compact", () => {
    const s = shortVerdict(verdict, "en");
    expect(s).toContain("Test");
    expect(s).toContain("take it");
    expect(s.split("\n").length).toBeLessThanOrEqual(6);
  });
  it("does not show a critic score when consensus is null", () => {
    const s = shortVerdict({ ...verdict, criticConsensus: null, criticCount: 0 }, "en");
    expect(s).not.toMatch(/\b\d{2}\/100\b/);
  });
  it("renders Russian labels", () => {
    expect(shortVerdict(verdict, "ru")).toMatch(/[Ѐ-ӿ]/);
  });
});

describe("fullCard", () => {
  it("lists sources and tasting notes", () => {
    const c = fullCard(verdict, "en");
    expect(c).toContain("https://a.com");
    expect(c).toContain("dark fruit");
    expect(c).toContain("Excellent value");
  });
  it("states when data is thin instead of inventing", () => {
    const thin = fullCard({ ...verdict, criticConsensus: null, qpr: null, communityNote: "", sources: [], dataConfidence: "low" }, "en");
    expect(thin.toLowerCase()).toContain("limited");
  });
});

describe("analoguesMessage", () => {
  it("lists each analogue with its reason", () => {
    const a: AnaloguesResult = {
      forWine: "Test Red 2018",
      analogues: [
        { name: "Wine A", why: "same grape, similar price", approxPrice: "$14" },
        { name: "Wine B", why: "comparable body", approxPrice: "$17" },
      ],
      dataConfidence: "medium",
      sources: ["https://a.com"],
    };
    const m = analoguesMessage(a, "en");
    expect(m).toContain("Wine A");
    expect(m).toContain("same grape");
    expect(m).toContain("Wine B");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/format.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Write `src/format.ts`**

```typescript
import type { Verdict, AnaloguesResult, Lang } from "./types.js";

const T = {
  en: {
    critics: "Critics", crowd: "Crowd", price: "Price", value: "Value",
    notes: "Notes", drink: "Drink", sources: "Sources", confidence: "Confidence",
    limited: "Reliable data is limited — treat this with caution.",
    noCritics: "no critic scores found", analoguesFor: "Analogues for",
  },
  ru: {
    critics: "Критики", crowd: "Толпа", price: "Цена", value: "Цена/качество",
    notes: "Ноты", drink: "Пить", sources: "Источники", confidence: "Уверенность",
    limited: "Надёжных данных мало — относись осторожно.",
    noCritics: "оценок критиков не найдено", analoguesFor: "Аналоги для",
  },
} as const;

function title(v: Verdict): string {
  const i = v.identity;
  return [i.producer, i.name, i.vintage].filter(Boolean).join(" ").trim() || "Unknown wine";
}

function priceStr(v: Verdict): string {
  return v.marketPrice ? `${v.marketPrice.amount} ${v.marketPrice.currency}` : "—";
}

export function shortVerdict(v: Verdict, lang: Lang): string {
  const t = T[lang];
  const lines: string[] = [`🍷 ${title(v)}`];
  if (v.criticConsensus !== null) {
    lines.push(`${t.critics}: ${v.criticConsensus}/100 (${v.criticCount})`);
  } else {
    lines.push(`${t.critics}: ${t.noCritics}`);
  }
  if (v.qpr) lines.push(`${t.value}: ${v.qpr.rating}/10 — ${v.qpr.label} · ${priceStr(v)}`);
  else if (v.marketPrice) lines.push(`${t.price}: ${priceStr(v)}`);
  lines.push(`👉 ${v.bottomLine}`);
  return lines.join("\n");
}

export function fullCard(v: Verdict, lang: Lang): string {
  const t = T[lang];
  const lines: string[] = [`🍷 ${title(v)}`];
  if (v.identity.region || v.identity.grape) {
    lines.push([v.identity.grape, v.identity.region].filter(Boolean).join(", "));
  }
  lines.push("");
  lines.push(v.criticConsensus !== null
    ? `${t.critics}: ${v.criticConsensus}/100 (${v.criticCount})`
    : `${t.critics}: ${t.noCritics}`);
  if (v.communityNote) lines.push(`${t.crowd}: ${v.communityNote}`);
  lines.push(`${t.price}: ${priceStr(v)}`);
  if (v.qpr) lines.push(`${t.value}: ${v.qpr.rating}/10 — ${v.qpr.label}`);
  if (v.tastingNotes) lines.push(`${t.notes}: ${v.tastingNotes}`);
  if (v.drinkingWindow) lines.push(`${t.drink}: ${v.drinkingWindow}`);
  lines.push("");
  lines.push(`👉 ${v.bottomLine}`);
  lines.push(`${t.confidence}: ${v.dataConfidence}`);
  if (v.dataConfidence === "low") lines.push(t.limited);
  if (v.sources.length) lines.push(`${t.sources}:\n${v.sources.map((s) => `• ${s}`).join("\n")}`);
  return lines.join("\n");
}

export function analoguesMessage(a: AnaloguesResult, lang: Lang): string {
  const t = T[lang];
  const lines: string[] = [`🍷 ${t.analoguesFor}: ${a.forWine}`, ""];
  a.analogues.forEach((x, i) => {
    lines.push(`${i + 1}. ${x.name}${x.approxPrice ? ` (${x.approxPrice})` : ""}`);
    lines.push(`   ${x.why}`);
  });
  lines.push("");
  lines.push(`${t.confidence}: ${a.dataConfidence}`);
  if (a.dataConfidence === "low") lines.push(t.limited);
  if (a.sources.length) lines.push(`${t.sources}:\n${a.sources.map((s) => `• ${s}`).join("\n")}`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/format.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add 01_agents/alan/src/format.ts 01_agents/alan/test/format.test.ts
git commit -m "feat(alan): Telegram verdict/analogues formatting"
```

---

### Task 12: Voice transcription + input normalization

**Files:**
- Create: `01_agents/alan/src/voice.ts`
- Create: `01_agents/alan/src/input.ts`

`voice.ts` adapts barrymore's Whisper helper (no fixed language — multilingual). `input.ts` downloads a Telegram photo to base64 and builds a `WineQuery`. No automated test (live I/O).

- [ ] **Step 1: Create `src/voice.ts`** (adapted from `01_agents/barrymore/src/voice.ts`; language auto-detected by omitting `language`)

```typescript
import { File as NodeFile } from "node:buffer";
if (!globalThis.File) (globalThis as any).File = NodeFile;

import OpenAI, { toFile } from "openai";
import { OPENAI_API_KEY } from "./config.js";

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function downloadTelegramFile(botToken: string, fileId: string): Promise<Buffer> {
  const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  const info = (await infoRes.json()) as { ok: boolean; result: { file_path: string } };
  if (!info.ok) throw new Error("getFile failed");
  const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${info.result.file_path}`);
  return Buffer.from(await fileRes.arrayBuffer());
}

export async function transcribeVoice(botToken: string, fileId: string): Promise<string | null> {
  try {
    const audio = await downloadTelegramFile(botToken, fileId);
    const file = await toFile(audio, "voice.ogg", { type: "audio/ogg" });
    const tr = await openai.audio.transcriptions.create({ file, model: "whisper-1" });
    const text = tr.text?.trim() ?? "";
    return text.length ? text : null;
  } catch (err) {
    console.error("voice transcription failed:", err);
    return null;
  }
}

export { downloadTelegramFile };
```

- [ ] **Step 2: Create `src/input.ts`**

```typescript
import type { WineQuery, Intent, Lang } from "./types.js";
import { DEFAULT_LANG } from "./config.js";
import { detectLang } from "./lang.js";
import { downloadTelegramFile } from "./voice.js";

/** Choose intent from the user's words. Analogue triggers in ru/en, else assess. */
export function detectIntent(text: string): Intent {
  return /аналог|замен|похож|вместо|substitut|similar|alternative|instead/i.test(text)
    ? "analogues" : "assess";
}

export async function photoToBase64(
  botToken: string, fileId: string,
): Promise<{ data: string; mediaType: WineQuery["imageMediaType"] }> {
  const buf = await downloadTelegramFile(botToken, fileId);
  // Telegram photos are JPEG; declare jpeg.
  return { data: buf.toString("base64"), mediaType: "image/jpeg" };
}

export function buildQuery(opts: {
  text: string;
  imageBase64?: string;
  imageMediaType?: WineQuery["imageMediaType"];
}): WineQuery {
  const text = opts.text ?? "";
  const lang: Lang = detectLang(text, DEFAULT_LANG);
  return {
    text,
    imageBase64: opts.imageBase64,
    imageMediaType: opts.imageMediaType,
    lang,
    intent: detectIntent(text),
  };
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add 01_agents/alan/src/voice.ts 01_agents/alan/src/input.ts
git commit -m "feat(alan): voice transcription + input normalization"
```

---

### Task 13: In-memory session store with TTL

**Files:**
- Create: `01_agents/alan/src/session.ts`
- Test: `01_agents/alan/test/session.test.ts`

Stores the last `Verdict` per chat so the "Подробнее" button can render the full card without re-running the pipeline. TTL-expired entries are dropped.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { SessionStore } from "../src/session.js";
import type { Verdict } from "../src/types.js";

const v = { bottomLine: "x" } as Verdict;

describe("SessionStore", () => {
  it("stores and retrieves a verdict by chat id", () => {
    const s = new SessionStore(1000, () => 1000);
    s.setVerdict(42, v);
    expect(s.getVerdict(42)).toBe(v);
  });
  it("returns undefined after TTL expiry", () => {
    let now = 1000;
    const s = new SessionStore(500, () => now);
    s.setVerdict(42, v);
    now = 1600; // 600ms later > 500ms TTL
    expect(s.getVerdict(42)).toBeUndefined();
  });
  it("returns undefined for unknown chats", () => {
    const s = new SessionStore(1000, () => 1000);
    expect(s.getVerdict(99)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/session.test.ts`
Expected: FAIL — `SessionStore` not found.

- [ ] **Step 3: Write `src/session.ts`**

```typescript
import type { Verdict } from "./types.js";

interface Entry { verdict: Verdict; at: number; }

export class SessionStore {
  private map = new Map<number, Entry>();
  constructor(
    private ttlMs: number,
    private now: () => number = () => Date.now(),
  ) {}

  setVerdict(chatId: number, verdict: Verdict): void {
    this.map.set(chatId, { verdict, at: this.now() });
  }

  getVerdict(chatId: number): Verdict | undefined {
    const e = this.map.get(chatId);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) { this.map.delete(chatId); return undefined; }
    return e.verdict;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/session.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add 01_agents/alan/src/session.ts 01_agents/alan/test/session.test.ts
git commit -m "feat(alan): in-memory session store with TTL"
```

---

### Task 14: grammy bot wiring

**Files:**
- Create: `01_agents/alan/src/index.ts`

Wires it all: `/start`, photo/text/voice handlers, the "Подробнее" inline button, and graceful errors. No automated test — verified by the manual run in Task 15.

- [ ] **Step 1: Create `src/index.ts`**

```typescript
import { Bot, InlineKeyboard } from "grammy";
import { TELEGRAM_TOKEN, SESSION_TTL_MS, assertEnv } from "./config.js";
import { buildQuery, photoToBase64 } from "./input.js";
import { transcribeVoice } from "./voice.js";
import { assessWine, findAnalogues } from "./pipeline.js";
import { shortVerdict, fullCard, analoguesMessage } from "./format.js";
import { SessionStore } from "./session.js";
import { detectLang } from "./lang.js";
import { DEFAULT_LANG } from "./config.js";
import type { WineQuery } from "./types.js";

assertEnv();

const bot = new Bot(TELEGRAM_TOKEN);
const sessions = new SessionStore(SESSION_TTL_MS);

const WORKING = { ru: "Изучаю вино…", en: "Researching the wine…" } as const;
const FAIL = {
  ru: "Не удалось разобрать. Пришли фото этикетки чётче или напиши название текстом.",
  en: "Couldn't work that out. Send a clearer label photo or type the name.",
} as const;
const START = {
  ru: "Я Алан — винный помощник. Пришли фото этикетки, название текстом или голосом — расскажу честно: что за вино, что говорят критики и толпа, и стоит ли оно денег. Или попроси подобрать аналоги.",
  en: "I'm Алан, your wine assistant. Send a label photo, type a name, or send a voice note — I'll tell you honestly what it is, what critics and the crowd say, and whether it's worth the price. Or ask for analogues.",
} as const;

bot.command("start", (ctx) =>
  ctx.reply(START[detectLang(ctx.message?.text ?? "", DEFAULT_LANG)]));

async function handleQuery(ctx: any, query: WineQuery): Promise<void> {
  await ctx.reply(WORKING[query.lang]);
  try {
    if (query.intent === "analogues") {
      const result = await findAnalogues(query);
      await ctx.reply(analoguesMessage(result, query.lang));
      return;
    }
    const verdict = await assessWine(query);
    sessions.setVerdict(ctx.chat.id, verdict);
    const kb = new InlineKeyboard().text(
      query.lang === "ru" ? "Подробнее" : "Details", "details");
    await ctx.reply(shortVerdict(verdict, query.lang), { reply_markup: kb });
  } catch (err) {
    console.error("query failed:", err);
    await ctx.reply(FAIL[query.lang]);
  }
}

bot.on("message:photo", async (ctx) => {
  const photos = ctx.message.photo;
  const fileId = photos[photos.length - 1].file_id; // largest size
  const caption = ctx.message.caption ?? "";
  const { data, mediaType } = await photoToBase64(TELEGRAM_TOKEN, fileId);
  await handleQuery(ctx, buildQuery({ text: caption, imageBase64: data, imageMediaType: mediaType }));
});

bot.on("message:voice", async (ctx) => {
  const text = await transcribeVoice(TELEGRAM_TOKEN, ctx.message.voice.file_id);
  if (!text) { await ctx.reply(FAIL[DEFAULT_LANG]); return; }
  await handleQuery(ctx, buildQuery({ text }));
});

bot.on("message:text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return; // ignore unknown commands
  await handleQuery(ctx, buildQuery({ text: ctx.message.text }));
});

bot.callbackQuery("details", async (ctx) => {
  await ctx.answerCallbackQuery();
  const verdict = sessions.getVerdict(ctx.chat?.id ?? -1);
  const lang = detectLang(verdict?.tastingNotes ?? "", DEFAULT_LANG);
  if (!verdict) {
    await ctx.reply(lang === "ru" ? "Сессия истекла, пришли вино заново." : "Session expired, send the wine again.");
    return;
  }
  await ctx.reply(fullCard(verdict, lang));
});

bot.catch((err) => console.error("bot error:", err));

bot.start({ onStart: (i) => console.log(`Алан started as @${i.username}`) });
```

> Note on the "Подробнее" language: the verdict doesn't store the request language, so the callback re-detects from the verdict's tasting notes as a heuristic and falls back to `DEFAULT_LANG`. If this proves wrong in testing, add a `lang` field to `Verdict` in `types.ts` and set it in `assembleVerdict` from the query — but that couples assess to language, so the heuristic is the deliberate first choice.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Run the full unit suite (regression check)**

Run: `npx vitest run`
Expected: PASS — all suites green (lang, normalize, qpr, assess, format, session).

- [ ] **Step 4: Commit**

```bash
git add 01_agents/alan/src/index.ts
git commit -m "feat(alan): grammy bot wiring (photo/text/voice + details button)"
```

---

### Task 15: README, env, and manual end-to-end verification

**Files:**
- Create: `01_agents/alan/README.md`
- Modify: `config/secrets.example.env` (add `ALAN_BOT_TOKEN`)

- [ ] **Step 1: Create `src` env entry** — add `ALAN_BOT_TOKEN` to the repo's `config/secrets.example.env` (find the file; if it lists `TELEGRAM_BOT_TOKEN` and `BARRYMORE_BOT_TOKEN`, add the line below them):

```
# Алан — wine assistant bot (BotFather token)
ALAN_BOT_TOKEN=
```

- [ ] **Step 2: Create `01_agents/alan/README.md`**

```markdown
# Алан — Wine Assistant Bot

Standalone Telegram bot: a realist sommelier. Send a label photo, a typed name, or
a voice note → honest verdict (what it is, critics vs. crowd, value-for-money,
take/skip). Or ask for global analogues.

## How it works
Approach C (hybrid): `WineDataSource.research()` (Claude Opus 4.8 + server-side web
search) → structured-output extraction of `WineEvidence` → deterministic
normalization (100-pt) + QPR verdict. Honesty is enforced by the system prompt and
output contract — confidence and sources always shown, never fabricated.

## Env (root `.env.local` / Railway)
- `ALAN_BOT_TOKEN` — BotFather token (new bot)
- `ANTHROPIC_API_KEY` — Claude (shared)
- `OPENAI_API_KEY` — Whisper voice transcription (shared)

## Run
```bash
npm install
npm test       # unit suite
npm run dev    # local (long polling)
```

## Deploy
Railway service, root dir `01_agents/alan`, start `npm start`, deploys on push to `main`.

## Future sources (the seam)
`src/sources/` — add `VivinoSource` (price-service `/api/public/vivino/lookup`),
`LwinSource`, or paid `LivexSource` implementing `WineDataSource`; no pipeline rewrite.
```

- [ ] **Step 3: Create the bot in BotFather and set `ALAN_BOT_TOKEN`** in the root `.env.local` (manual, user action). Confirm `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` already exist there.

- [ ] **Step 4: Manual end-to-end smoke test**

Run: `npm run dev` (from `01_agents/alan/`)
Then, in Telegram, exercise each path and confirm:
1. **Text, English:** "Cloudy Bay Sauvignon Blanc 2022" → a short verdict with critic line, value line, bottom line, and a "Details" button. Tap it → full card with sources.
2. **Text, Russian:** "Шато Тамань Резерв" → reply is in Russian.
3. **Photo:** send a wine label photo (no caption) → identifies and assesses; reply defaults to Russian (DEFAULT_LANG).
4. **Voice:** record "what do you think of Whispering Angel rosé" → transcribes, assesses in English.
5. **Analogues:** "подбери аналоги к Whispering Angel" → list of 3–5 analogues with reasons, no "Details" button.
6. **Honesty / thin data:** send an obscure/unknown wine name → reply states confidence is low and does not invent scores or sources.

Expected: each path returns a sensible, honest reply within ~10–30s; the bottom line is blunt (not hype); low-data cases say so. If web search returns nothing, the bot still replies gracefully (low confidence), not an error.

- [ ] **Step 5: Commit**

```bash
git add 01_agents/alan/README.md config/secrets.example.env
git commit -m "docs(alan): README + env example; complete wine assistant bot MVP"
```

- [ ] **Step 6: Push**

```bash
git push origin main
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** photo/text/voice inputs (Tasks 12, 14) · auto language (Tasks 3, 12) · honest verdict with critic-vs-crowd split, confidence, sources (Tasks 6, 7, 11) · QPR value (Task 5) · analogues (Tasks 9–11) · WineDataSource seam (Task 8) · short-verdict + "Подробнее" full card (Tasks 11, 14) · in-memory TTL sessions (Task 13) · separate Railway bot (Tasks 1, 15). All design sections map to tasks.
- **Type consistency:** `WineEvidence`, `Verdict`, `AnaloguesResult`, `WineQuery`, `Lang`, `Intent` are defined once in `types.ts` (Task 2) and used unchanged downstream. The `EVIDENCE_SCHEMA`/`ANALOGUES_SCHEMA` JSON schemas (Task 7) mirror those types field-for-field.
- **Known follow-ups (out of MVP scope):** persist a `lang` on `Verdict` if the "Details"-button language heuristic misfires in testing; add `VivinoSource`/`LwinSource`/`LivexSource` behind the seam; tune the QPR multiplier and FX table against real cases.
```
